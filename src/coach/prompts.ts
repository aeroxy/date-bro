// Every request is ordered strictly slowest-changing first, because a cached
// prefix survives only if every byte before it is unchanged:
//
//   system   the coach itself - the belief sections of `mind.ts` this engine
//            is sent - plus its task, output rules and shape, and the user's
//            house rules  [cache]  - constant per engine, across every record
//   user[0]  name, stage, what the user wants   - changes on a profile edit
//   user[1]  the markdown profiles  [cache]     - rewritten only by a rebuild
//   user[2…] the transcript, one block per turn, [cache] on the last
//                                               - appended to constantly
//   user[n]  what the coach has learned, research notes, the time, what was
//            asked - the learned section lives down here, not in system,
//            because the coach itself rewrites it (see `learnedBlock`)
//
// Three of Anthropic's four breakpoints, one spare.
//
// The task used to sit *below* the transcript, so that all three engines shared
// one transcript entry. Measured against a real payload, that was the wrong
// trade by roughly 5x. The task and its knowledge base are the largest block in
// the request (~3.9k of ~7.7k tokens) and they never change; the transcript is
// the smallest of the three and changes every time a turn is added. With the
// task underneath, one new turn invalidated the entire knowledge base along with
// it, and a turn-then-run is by far the most common thing that happens here.
// Sharing the transcript across engines only paid when several engines ran
// without the transcript moving, which is much rarer.
//
// Hoisting the task into `system` goes one further: the entry is now identical
// for a given engine across *every* record and conversation, so a first call
// about a new person reads it rather than writing it. That is the layout a
// captured Claude Code request uses too - everything instructional above,
// everything that grows below.
//
// The transcript is one block per turn so an append leaves the earlier blocks
// byte-identical. As a single segment it was rewritten by every added turn.

import { layeredUser, type ChatMessage, type ContentSegment } from '@/lib/llm-client'
import { describeBirthday } from '@/lib/birthday'
import { formatTurn, numberTurns } from '@/lib/transcript'
import type { ChatEngine, DateRecord } from '@/types/date'
import {
  LEARNED_HEADING,
  learnedText,
  mindFor,
  mindInstructions,
  type Audience,
} from './mind'
import {
  CONSTRAINT_BULLET_CEILING,
  CONSTRAINT_SECTIONS,
  PERSON_SECTIONS,
  PROFILE_WORD_CEILING,
  SECTION_NOTES,
  SELF_SECTIONS,
} from './profile'
import { CHAT_SHAPE, PERSON_SHAPE, SELF_SHAPE, SUGGESTION_SHAPE } from './schemas'

const OUTPUT_RULES = `Output rules:
- Return a single JSON object matching the shape below. No prose, no code fence, no commentary.
- Every string is plain text the user will read directly. Write like a person, not a report:
  short sentences, concrete nouns, no consultant-speak, no bullet-point fragments as sentences.
- Never invent a fact about either person. If it isn't in the material, it goes in open_questions.
- Quote or closely paraphrase the transcript for evidence, and cite the turn number like [4].`

/**
 * Everything above the transcript that isn't the name, and the one place a
 * derived value sits above a cache mark.
 *
 * The birthday line changes daily while a birthday is within a month, and the
 * age once a year - both harmless here. The mark above the transcript holds an
 * ephemeral entry with a five-minute life, so anything that moves slower than
 * that is constant as far as the cache is concerned. `<right_now>` is in the
 * tail precisely because it isn't.
 */
function stageLine(record: DateRecord): string {
  const { meta } = record
  const born = meta.birthday ? describeBirthday(meta.birthday) : null
  const bits = [
    `Stage: ${record.stage}`,
    meta.since ? `Since: ${meta.since}` : null,
    meta.howWeMet ? `How they met: ${meta.howWeMet}` : null,
    born ? `Their birthday: ${born}` : null,
    // Only when no birthday has replaced it, and stamped with when it was
    // written down. A bare "28" recorded eighteen months ago reads as current
    // and isn't; saying when it was entered is the difference between a stale
    // fact and a misleading one.
    !born && meta.age
      ? `Their age: ${meta.age}, as recorded on ${new Date(record.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} - age it forward if that matters`
      : null,
    meta.pronouns ? `Their pronouns: ${meta.pronouns}` : null,
    meta.location ? `Location: ${meta.location}` : null,
  ].filter(Boolean)
  return bits.join('\n')
}

/**
 * The last of the standing blocks, and it has to stay there. This is the one
 * value that changes on every single request, so anywhere above a cache
 * breakpoint it would invalidate the whole prefix each time - the transcript
 * included. (A captured Claude Code request keeps its system prompt byte-stable
 * for exactly this reason and delivers time per-message instead.)
 *
 * The caveat is doing real work. `Turn.at` is free text the user may not have
 * filled in, and nothing else stamps a turn, so elapsed time is often genuinely
 * unknowable. Without saying so, a model handed "now" will happily infer that a
 * message was two days ago because that reads plausibly - the exact invention
 * `KB_EVIDENCE` forbids everywhere else.
 *
 * Day and date, not just a clock: half the set pieces in `KB_MOVES` are about
 * proposing a specific evening, and "it's Thursday" is what makes that concrete.
 */
function nowBlock(): string {
  const now = new Date()
  const stamp = now.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  return `<right_now>
${stamp}
</right_now>
The user's local time, as of this request. Use it for anything that turns on
timing - how long a silence has actually run, whether a plan is for tonight or
next week, which evening to suggest.

Only where the material supports it. Turn timestamps are optional free text the
user may never have entered, so unless a turn says when it happened, you do not
know how long ago it was. Say that instead of estimating. "How long since her
last message?" is a good open question; an invented interval is not.`
}

/**
 * The one section of the mind that rides below the transcript instead of in the
 * system block: the coach's own findings, which are also the exact thing a
 * next-move run is most likely to rewrite.
 *
 * Position is the whole point. The system block sits above the profile and the
 * entire transcript, so an amendment up there re-writes the whole prefix -
 * measured on a real record, one ~250-char learned-section
 * amendment between two next-move runs turned a would-be ~49k-token cache read
 * into 2k read and 47k re-written. Down here it costs only itself, on every
 * call, which for a section capped by "merge before you add" is the far
 * cheaper side of the trade.
 */
function learnedBlock(mind: string): string | null {
  const learned = learnedText(mind)
  if (!learned) return null
  return `<what_you_have_learned>
${learned}
</what_you_have_learned>
Findings you wrote down for yourself on earlier runs - the "${LEARNED_HEADING}"
section of your own mind. It arrives late in the request, but it is not lesser:
read it with the same authority as the rest of what you believe.`
}

/**
 * `consolidate` is the one run in a while that is allowed to rewrite this block
 * instead of adding to it. Only the suggestion engine ever passes true: it is the
 * only shape with a `research_notes` field, so it is the only engine that could
 * act on the instruction, and telling a rebuild to return one would be asking for
 * a field its schema doesn't have.
 */
function researchNotesBlock(record: DateRecord, consolidate: boolean): string | null {
  const notes = record.researchNotes?.trim()
  if (!notes) return null
  const ask = consolidate
    ? `

This list has grown long enough to be worth tidying, and this run is the one that does it: return the whole of it, rewritten, in "research_notes". This overrides the delta rule in the task above - on this run only, that field replaces the block rather than adding to it, so every fact above that is still true has to appear in what you return, including the ones you are not changing. Anything you leave out is gone. Merge the lines that say the same thing, fold each correction into the line it corrects and drop the version it corrected, and drop what has stopped mattering. Keep the facts, not the history of learning them - one line per thing that is true, written the way you'd want to read it next time.`
    : ''
  return `<research_notes>
${notes}
</research_notes>
Durable facts kept from earlier web research. Reuse them instead of re-searching - only search again if what you need isn't here or might have changed (an opening-hours note from months ago, for instance). Where two lines conflict, the later one is the correction.${ask}`
}

/**
 * What the user typed into the footer box when they asked. One-shot on all three
 * tabs, and the same tag on all three, because it is the same thing: a person
 * saying something to the engine they are looking at, right now.
 *
 * It used to be a standing per-engine thread - every note re-sent on every later
 * run of that engine, forever. Them and You lost theirs first, when amending a
 * profile became a one-shot instruction whose effect landed in the document.
 * `next` held on longer because "stop suggesting bars" genuinely is standing and
 * had nowhere else to go. It goes in the coach's own document now, which is a
 * better home than it ever had here: a preference like that is about the user, so
 * it should follow them to every person they're seeing rather than sit under one.
 *
 * The last two sentences are the whole reason this block has prose around it.
 * They are the authority on their own life; they are not the authority on what
 * the transcript shows.
 */
function fromUserBlock(message: string): string | null {
  const said = message.trim()
  if (!said) return null
  return `<from_the_user>
${said}
</from_the_user>
What the user typed when they asked - what is going on right now, direction about the answer, or both. Act on it: drop a framing they rejected, weight what they say matters, and take any fact they add about their own life as true; they were there and you weren't. What it cannot do is make the evidence say something it doesn't. If it asks for a conclusion the material won't carry, say so plainly in the honest note instead of manufacturing support for it.`
}

/**
 * Who is being discussed, and what the user is trying to get out of it. The
 * first record-specific thing in the request, sitting directly under the shared
 * system entry - small, and changed only by a profile edit.
 *
 * Nothing here describes either *person*. It used to: a `seedThem` / `seedMe`
 * blob sat in this slot, above the transcript, in the position the layering
 * reserves for the most authoritative material - while being the one input
 * nobody ever revised. What the user knows now enters as `context` turns in the
 * transcript, and what the engines make of it comes back as the rebuilt reads.
 * The goal survives because it isn't a claim about the world that the
 * conversation can outdate; it's what the coach is being asked to optimise for.
 */
function whoBlock(record: DateRecord): string {
  return `<the_person>
Name: ${record.name}
${stageLine(record)}
</the_person>

<the_user>
What the user says they want from this:
${record.goal.trim() || '(not stated)'}
</the_user>`
}

/**
 * The transcript, one segment per turn, with the breakpoint on the last of them.
 * The most volatile thing above the tail, so it sits last of the cached strata -
 * everything constant has already been marked by the time a new turn lands here.
 *
 * The breakpoint has to sit on the final *turn*, not after the closing tag:
 * caching reads by longest matching prefix, so what the next request needs is
 * for everything up to the mark to still be a prefix of it. Add a turn and the
 * new request reads `…[tₙ][tₙ₊₁]</transcript>` - the old entry ending at `[tₙ]`
 * still matches, and only the new turn is paid for. Put the mark after
 * `</transcript>` and the tag lands in the middle of the new request, matching
 * nothing.
 *
 * `<counts>` used to ride along here - turn, word and question tallies per side.
 * It is gone from the request entirely, not moved. It shipped with a caveat
 * saying the numbers were unreliable, because the user may only have entered
 * part of a conversation, and a disclaimer does not stop a model anchoring on a
 * number: what it produced was arithmetic about investment symmetry standing in
 * for reading the thread. The transcript is right there, and who is writing more
 * is visible in it. `transcriptStats` still backs the count in the UI header,
 * where the reader knows what they entered.
 */
function transcriptSegments(record: DateRecord): ContentSegment[] {
  // Through `numberTurns` rather than straight off the record, so `formatTurn`
  // gets turns that are numbered by type rather than by hope. Every path that
  // reaches here - a read, a save, an in-memory update - has already numbered
  // them, so this is the identity fast path in practice; what it buys is that the
  // one place a citation is rendered cannot be handed a turn without one.
  const numbered = numberTurns(record).turns
  const turns: ContentSegment[] = numbered.length
    ? numbered.map((turn) => ({ text: formatTurn(record, turn) }))
    : [{ text: '(no conversation recorded yet)' }]
  turns[turns.length - 1]!.cache = true

  const closing = ['</transcript>', contextEntryNote(record), coachEntryNote(record)]
    .filter(Boolean)
    .join('\n\n')
  return [{ text: '<transcript>' }, ...turns, { text: closing }]
}

/**
 * Only when there are any, so a record without them pays nothing and its
 * transcript entry is byte-identical to what it was before the feature existed.
 */
function contextEntryNote(record: DateRecord): string | null {
  if (!record.turns.some((t) => t.speaker === 'context')) return null
  return `Lines labelled NOTE are not messages. They are things the user wrote down about the connection - learned on a call, from a friend, in person, or simply remembered - placed where they were learned. Treat them as the user telling you something directly: true about their life, and citable like any other numbered line. They are not evidence about how either person writes.`
}

/**
 * The whole point of putting advice in the pool. Same gating rule as the note
 * above: absent until a record actually has one.
 *
 * This is the only feedback signal the coach has ever had. Everything else it
 * knows is what the user typed at it; this is what happened when its own advice
 * met the world, and it is free - nobody has to grade anything, because the
 * next turn either is the draft or isn't.
 *
 * The last paragraph is load-bearing in the other direction. A run that has
 * just read its own confident advice will treat it as established fact unless
 * told not to, and then cites itself as evidence about her.
 */
function coachEntryNote(record: DateRecord): string | null {
  if (!record.turns.some((t) => t.speaker === 'coach')) return null
  return `Lines labelled COACH are your own past advice to this user, at the point you gave it. What happened next is directly underneath.

Read the pair. If their next message is one of the drafts you offered, close to it, they took it - so what came back is evidence about whether it worked. If it is something else, they didn't, and that is worth as much: they saw the options and wrote their own, which tells you where your read of their voice was off. If nothing follows it yet, the advice is simply outstanding.

Say so when something you tried didn't land. Repeating a move that already failed in this same thread is the specific failure to avoid here.

Your own advice is not evidence about either person. It is what you said, not something that happened. Only their replies and the user's notes are material.`
}

/**
 * The tail - everything that can change between two runs of the same engine,
 * ordered by ascending change frequency so the cheapest thing to invalidate
 * sits lowest. Everything here is below every breakpoint, so none of it can
 * disturb the profile or the transcript above.
 */
function volatileBlock(
  record: DateRecord,
  mind: string,
  consolidateNotes: boolean,
  ...trailing: (string | null)[]
): string {
  // `nowBlock` sits last of the standing blocks - see its comment. It is the
  // most volatile thing in the request, so it belongs as late as possible, and
  // below every breakpoint including the profile one above.
  return [
    learnedBlock(mind),
    researchNotesBlock(record, consolidateNotes),
    nowBlock(),
    ...trailing,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The profile, injected whole, above the transcript and below the system entry.
 *
 * Reading is injection here, deliberately, and it is the one place this design
 * departs from the agent-with-a-filesystem shape it was drafted from. That shape
 * is earned by two properties: the artifact is large relative to the window, and
 * any one operation needs a small slice of it. Neither holds. A profile is
 * ~3–5k tokens against 200k, and *there is no useful slice* - writing one draft
 * needs her patterns and the open threads and the read of the user's voice all
 * at once. A `read` tool would return what is already in context, at the cost of
 * a round trip and a real chance of drafting from half a profile.
 *
 * What does survive from that shape: the stored document never goes into a
 * message history. It is injected fresh from storage on every call, so nothing
 * that happens inside a conversation can corrupt what's on disk.
 */
function profileBlock(
  record: DateRecord,
  engine: 'them' | 'me' | 'next',
  /**
   * Amend only. The headline is the one part of the judgment an amendment can
   * change, so it is the one part an amendment has to be able to see.
   *
   * It was invisible, and that was a real bug: the headline sits directly above
   * the prose in the UI, an amendment rewrote the prose to say the opposite of
   * it, and nothing in the request had ever shown the model the sentence it was
   * now contradicting. The rest of the judgment stays out - a rebuild
   * regenerates it wholesale, and showing it there would only anchor the new one
   * to the old.
   */
  withHeadline = false,
): string {
  const parts: string[] = []
  const them = record.themProfile?.markdown.trim()
  const me = record.meProfile?.markdown.trim()
  const headline =
    withHeadline
      ? (engine === 'them' ? record.themProfile : record.meProfile)?.judgment.headline.trim()
      : ''

  if (them && engine !== 'me') {
    parts.push(`<profile_of_them>
${them}
</profile_of_them>`)
  }
  if (me && engine !== 'them') {
    parts.push(`<profile_of_the_user>
${me}
</profile_of_the_user>`)
  }
  if (!parts.length) return ''

  if (headline) {
    parts.push(`<headline_now>\n${headline}\n</headline_now>`)
  }

  const framing =
    engine === 'next'
      ? `What is known about these two, accumulated across every rebuild so far. Work from it. The transcript above stays the source for exact wording, and for anything said after the profile was last updated - where they disagree, the transcript wins.

These are also the documents a proposed amendment aims at, when you have one to propose. Whichever you address, address it by the headings you can see here.`
      : `The profile as it stands, which you are about to amend. It was written from earlier versions of this same transcript. Where the newer turns contradict it, the transcript wins and the profile is what needs correcting.${
          headline
            ? `

<headline_now> is the two-line summary shown directly above this prose in the app. It was written by the last full rebuild and nothing has touched it since, so it can be older than what you are reading - and if your amendment leaves it describing a profile that no longer exists, it is the first thing the user reads and the first thing they see is wrong.`
            : ''
        }`

  return `${parts.join('\n\n')}\n\n${framing}`
}

/**
 * The suggestion engine's one channel into a profile, and deliberately a narrow
 * one.
 *
 * Not `updateInstructions`, though the ops are the same. That block is a
 * rebuild's whole job, thirty lines of doctrine about what a profile is for, and
 * pasting it here would put a second full task next to the one the user actually
 * asked for - competing for attention with the drafts, which are what they
 * opened the app to get. What this engine needs is the bar and the targeting.
 *
 * The bar is the load-bearing part. A rebuild reads the same transcript this
 * engine just read, so anything visible in it will be caught by the button next
 * to this one; proposing it here only means the same fact gets written twice, by
 * two engines, in two wordings. What a rebuild genuinely cannot see is what the
 * user typed into their note this run and what research turned up - so that is
 * what the bar is set to, and everything else is told to stay a `changed: false`.
 *
 * One slot per document, where there used to be one slot and a target. The old
 * shape made "I learned something about both of them" unrepresentable, and the
 * user reported hitting that often. Two slots cost one thing back: the single
 * slot enforced the bar by scarcity - a model with one offer to make spends it on
 * the best one - where two invite a weak second amendment for symmetry. The bar
 * is now stated per slot, and the reason is spelled out in the shape, because
 * that is the only thing left holding it.
 *
 * And the bar is higher than it was, because the amendment now lands rather than
 * waiting for a click. The user can undo it from the card, so nothing here is
 * unrecoverable - but an amendment nobody wanted is work for them either way,
 * and one they don't notice is in the document on every later call. Told
 * plainly, since a model that believes a human gates its writes will write more
 * of them.
 */
function proposalInstructions(): string {
  return `## Proposing an amendment to a profile

You may amend the person's profile, the user's, both, or neither. None is the answer on most runs - return changed: false, and that is a real answer.

- **What you write here is applied, not offered.** It goes into the document when this answer is stored. The user sees a line naming the section that changed and can undo it, so nothing here is permanent - but they undo it by noticing it first, and whatever they don't notice is in the profile, and in the prompt, on every later run. Write only what you would still defend a month from now.
- **Each slot is judged on its own.** "profile_them" and "profile_me" are two separate amendments, undone separately. Two are right only when you genuinely learned something about each; one written to fill the second slot is a document the user now has to correct. One real amendment and one changed: false is a better answer than two adequate ones.
- **Propose only what a rebuild would not find on its own.** The user has a Rebuild button for each of these documents, and it reads the same transcript you just read. Anything in the transcript is already covered. What is not: what the user told you in their note this run, what your research established about the person, and any correction they made to a read of yours. That is the list.
- **The smallest edit that says it.** Amend the one thing that is new or wrong. This is not the place to reorganise a document, consolidate it, or bring it up to date generally - a large amendment is one the user cannot check at a glance, and what they see names sections, not sentences.
- **Whose document is which.** "profile_them" is for something about the person, "profile_me" for something about the user in this connection. Nothing about *yourself* belongs in either - that is the mind amendment, and they are not interchangeable.
- **The personality sections are not yours to amend** - "Personality" and "Love languages", in either document. A type and a love language are judgments over the whole transcript, not something one exchange earns a nudge to, and the rebuilds are the only engines that read the thread with nothing else to produce. If this run turned up something that belongs there, put it in "read" where the user can see it and hit Rebuild. Every other heading is open to you, the facts in "Who they are" included.
- **Amend by heading, the same ops a rebuild uses.** A fact that turned out to be wrong is an "edit" quoting the text it replaces - never a new bullet correcting an old one, here least of all, where the user is reading one line about what changed and a correction-of-a-correction is what would be sitting behind it.`
}

/**
 * How a rebuild is told to amend the document. Rides in the system block with
 * the rest of the task, so it is constant per engine and caches with it.
 *
 * The heading list is a suggestion, not a validator: the model owns the
 * structure, extras are additive, and `applyProfileUpdate` creates anything it
 * doesn't recognise. Pinning them is purely about keeping `replace` aimed at the
 * section it means, since a heading reached for slightly differently each time
 * degenerates into create-new.
 */
function updateInstructions(sections: readonly string[]): string {
  return `The profile is a markdown document you maintain across rebuilds. It is above, under <profile_of_them> or <profile_of_the_user>, or absent if this is the first rebuild. You do not rewrite it. You return only what changed.

- Amend by heading. "replace" swaps a section's body, "append" adds to the end of one, "delete" removes it, "edit" rewrites one piece of text inside it. An unknown heading is created, so the first rebuild is just a list of "replace" ops that build the document.
- Return changed: false when nothing you read actually changes it. After one new turn that is usually the right answer, and it is a real answer, not a failure.
- Prefer "append" for a fact learned.
- **Something you already wrote turned out to be wrong: that is an "edit".** Put the text you are replacing in "old" - copied out of the section above, character for character, and enough of it that it appears there only once - and what it should say now in "content". Nothing else in the section moves, so a correction costs you nothing and there is never a reason to avoid making one.
- **Never write a bullet that corrects another bullet.** No "supersedes the above", no "actually, it's X now", no second version of a fact sitting next to the first for the reader to reconcile. If you are about to write one of those, what you actually have is an "edit" to the line you were going to correct.
- **An "edit" with "" for content removes the text you quoted.** That is how a line that has stopped being true leaves - and how you collapse a correction someone already wrote as a second bullet: edit the original to say the right thing, then edit the correction away. Neither costs the rest of the section.
- **A correction from the user outranks anything you inferred.** When their message says something in the profile is wrong, edit that text to say what they told you. Do not annotate it, and do not keep your version alongside theirs.
- Use "replace" when a whole section has gone stale enough that fixing it line by line is the wrong shape of job - and say what things are now, not what they used to be.
- Headings to work with, in this order. Add your own where the material genuinely needs one; don't rename these:
${sections.map((s) => `  - ${s}${SECTION_NOTES[s] ? ` - ${SECTION_NOTES[s]}` : ''}`).join('\n')}
- The profile is what you *know*. What you don't know goes in open_questions, and nowhere else - never as a section, and never folded into one. "Threads to pick back up" is the near miss to watch: that is for things they raised and the conversation left hanging, so it holds subjects, not gaps. If you find yourself writing "the user has never asked about X" into a section, X is an open question and belongs in that field.
- Write bullets, not paragraphs. Carry the confidence with the claim, in the body: "- Landscape architect, at a small studio (high)". Cite the turn where it came from when there is one: "[4]".
- Keep it under about ${PROFILE_WORD_CEILING} words. Past that, spend a rebuild consolidating - merge duplicates, drop what stopped mattering, delete a section that has emptied out.
- **${CONSTRAINT_SECTIONS.map((s) => `"${s}"`).join(' and ')} are live rules, not an archive.** Everything in them is read as an instruction on every run, so they do not cost what the descriptive sections cost: a long list of things not to do produces cautious, flat advice, and that price is paid on every answer rather than only on the one the rule was written for. Keep each to about ${CONSTRAINT_BULLET_CEILING} bullets. Check the count on **every** rebuild, not only the one adding something new - a section that is over the ceiling because of how it was written before stays over it forever if the only occasion for pruning is the next addition, and a rebuild with nothing new to add is still a rebuild. If either section is over the ceiling right now, bring it back under this turn, whether or not anything new is going in. There is almost always one to retire: - a rule about a specific moment that has passed - it happened, it was handled,   it is history and belongs in the descriptive sections if it belongs anywhere - a rule that has been followed for several exchanges without incident, which is   no longer telling anyone anything they are not already doing - two rules that say the same thing in different words, which merge What stays is what would change the next message: a standing fact about how this person reacts, and the one or two things that would actually do harm.
- "rewrite" replaces the whole document and is almost never right. Reach for it only when the structure itself has gone wrong and section edits can't fix it.`
}

/**
 * The whole instructional half of the request, and the largest single block in
 * it. Constant for a given engine across every record and every conversation -
 * which is the point of it being here rather than in a user turn. One entry per
 * engine gets written once and read by every call about every person, instead of
 * each record paying to cache its own copy of the same knowledge base.
 *
 * Nothing record-specific may enter this string. A name, a stage, a profile -
 * anything that varies per person - and the entry stops being shared and starts
 * being written once per record, which is the cost this layout exists to avoid.
 * The two variable inputs both vary per *user* rather than per record: the mind,
 * and `customPrompt`. Each costs one rewrite of this entry when it changes.
 *
 * `audiences` selects which sections of the mind this engine is sent, so a
 * rebuild never pays for the 2.4k tokens of the next-move playbook. See
 * `mind.ts` - the sections are addressable by heading precisely so the coach can
 * amend them, and sliceable by audience so nobody pays for the ones they don't
 * need. The learned section is never among them: the coach rewrites it, so it
 * rides in `volatileBlock`, and this entry stays cached across the runs that
 * amend it.
 */
function buildSystem(
  mind: string,
  audiences: Audience[],
  task: string,
  customPrompt: string,
): string {
  const system = `${mindFor(mind, audiences)}

${task}

The material follows in the message below - who these two people are, what is
already known about them, and what was actually said. Read it, then do what the
task above asks.`

  const extra = customPrompt.trim()
  if (!extra) return system
  return `${system}\n\n## The user's own standing instructions\nThese override the style preferences in the task above, but never the non-negotiables.\n${extra}`
}

// --- Engine 1: rebuild their context ----------------------------------------

export function buildPersonMessages(
  record: DateRecord,
  message: string,
  mind: string,
  customPrompt: string,
): ChatMessage[] {
  const task = `<task>
Update what is known about the person the user is seeing, from everything in the transcript - what was said, and what the user has noted down about them. Where a note and the messages disagree, the messages win: people describe their dates the way they wish they were.

Absorb what the user has written down into the profile so the raw text stops being needed. It reaches you two ways - as notes in the transcript, and in <from_the_user> when they typed something with this rebuild. Same material either way, and it may be long and unedited: a dating-app bio, a paragraph typed from memory. Keep what bears on this connection and drop the rest. This is the one place a fact with no support in the messages is still legitimate, because the user asserted it: mark it low confidence and say it came from them.
</task>

${updateInstructions(PERSON_SECTIONS)}

${OUTPUT_RULES}

Shape:
${PERSON_SHAPE}`

  return [
    { role: 'system', content: buildSystem(mind, ['all', 'them'], task, customPrompt) },
    layeredUser([
      { text: whoBlock(record) },
      { text: profileBlock(record, 'them'), cache: true },
      ...transcriptSegments(record),
      {
        text: volatileBlock(
          record,
          mind,
          false,
          fromUserBlock(message),
          `Update what you know about ${record.name}. Return the JSON object only, with all of headline, interest_read, flags, open_questions and profile.`,
        ),
      },
    ]),
  ]
}

// --- Engine 2: rebuild the user's context ------------------------------------

export function buildSelfMessages(
  record: DateRecord,
  message: string,
  mind: string,
  customPrompt: string,
): ChatMessage[] {
  const task = `<task>
Show the user themselves - how they are actually showing up in this specific connection, based on what they wrote and how the other person responded to it. This is the half they control, so it's the half worth being precise about.

Absorb what they have written down about themselves into the profile, so the raw text stops being needed. It reaches you two ways - as notes in the transcript, and in <from_the_user> when they typed it with this rebuild; same material either way. They may have pasted something long and unedited - a CV, a dating-app bio, a paragraph typed at 1am. Keep the part that bears on *this* connection and drop the rest: their hours, their situation, a constraint, something that explains how they behave here. A job title earns its place only if it changes something between these two people. This is the one place a fact with no support in the transcript is still legitimate, because the user asserted it - mark it low confidence and attribute it to their own note.

Where a note the user wrote about themselves and their actual messages disagree, the messages win. Self-descriptions get written to be read by someone - a bio, a CV, a version of themselves they'd like to be true - and this is a read of who they are in this conversation. "How you write" in particular comes only from their own turns: how they actually type, at whatever length they actually type it. Never take voice from a note.

Be generous and be straight. Name what's working as specifically as what isn't; people repeat what gets named. Don't moralise, don't flatter, and don't diagnose.
</task>

${updateInstructions(SELF_SECTIONS)}

${OUTPUT_RULES}
- Write "you" to address the user directly.

Shape:
${SELF_SHAPE}`

  return [
    { role: 'system', content: buildSystem(mind, ['all', 'me'], task, customPrompt) },
    layeredUser([
      { text: whoBlock(record) },
      { text: profileBlock(record, 'me'), cache: true },
      ...transcriptSegments(record),
      {
        text: volatileBlock(
          record,
          mind,
          false,
          fromUserBlock(message),
          'Update the read of the user in this connection. Return the JSON object only, with all of headline, goal_read, open_questions and profile.',
        ),
      },
    ]),
  ]
}

// --- Talking about a profile --------------------------------------------------

/**
 * One instruction to amend a profile. **Not a conversation** - nothing about the
 * exchange is kept.
 *
 *   [system ✂][who][profile ✂][turns… ✂][/transcript][research + now][the instruction]
 *
 * Structurally identical to the rebuild engines; only the task and the tail
 * differ. It briefly persisted a chat history, which cost a fourth breakpoint
 * and forced an awkward set of constraints - strict role alternation, a mark on
 * the last *stored* message rather than the new one, and a rule that a user turn
 * could only be written once its reply succeeded. All of that is gone, and so is
 * the open question about whether the profile belonged above or below the
 * history: there is no history to order it against.
 *
 * The reason it went is the rule this whole redesign runs on. The instruction's
 * entire effect lands in the profile, so keeping the instruction as well means
 * storing the same information twice and paying for the redundant copy on every
 * later request - exactly what the seed blobs did, and what a pasted CV sitting
 * in the transcript still does.
 */
export function buildChatMessages(
  record: DateRecord,
  engine: ChatEngine,
  message: string,
  mind: string,
  customPrompt: string,
): ChatMessage[] {
  // Not `record.name`, which is what this used to be. `buildSystem` is shared
  // across every record precisely because nothing person-specific enters it, and
  // a name here quietly turned one cached entry per engine into one per person -
  // the exact cost this layout exists to avoid. The name is directly below, in
  // `whoBlock`, where a per-record value belongs.
  const who = engine === 'them' ? 'the person the user is seeing' : 'the user'
  const sections = engine === 'them' ? PERSON_SECTIONS : SELF_SECTIONS

  const task = `<task>
The user is telling you to change what you know about ${who}. Do it, and say in a sentence or two what you did.
</task>

This is one instruction, not a conversation. Nothing you write here is kept except the profile itself, so put the substance in the amendment and keep the reply to a short confirmation the user reads once.

- A correction - take it. Change what you wrote, and don't defend the old read or apologise your way through it. Say what it now says instead.
- A fact you didn't have - that goes in the profile. They were there and you weren't, so their facts win.
- A question - answer it from the material and change nothing. If the answer isn't in the material, say so plainly; that's more useful than a guess, and it usually names what they should find out next.
- An instruction the evidence won't carry - say so rather than writing it in. Their facts win; their conclusions don't automatically.
- changed: false is a real answer. A question asked, a read explained, an instruction you had to decline - none of those touch the document.
- Check the headline last. If what you just wrote contradicts <headline_now>, replace it; that sentence sits above the prose in the app and the user reads it first. If your amendment doesn't touch what it says, leave it - "" - because a headline rewritten on every small correction drifts as badly as one never rewritten at all.

${updateInstructions(sections)}

${mindInstructions()}

This is the one engine the user speaks to directly, and that makes it the only place a durable finding about them can come from. A rebuild infers; here they tell you. When what they said is about *themselves* rather than about this one person - how they want to be written for, something they will not do, a correction to how you read them - it outlives this record, and "${LEARNED_HEADING}" is where it goes. What they tell you about the person in front of you is still just this profile.

${OUTPUT_RULES}
${engine === 'me' ? '- Write "you" to address the user directly.\n' : ''}
Shape:
${CHAT_SHAPE}`

  return [
    { role: 'system', content: buildSystem(mind, ['all', engine], task, customPrompt) },
    layeredUser([
      { text: whoBlock(record) },
      { text: profileBlock(record, engine, true), cache: true },
      ...transcriptSegments(record),
      {
        text: volatileBlock(record, mind, false, fromUserBlock(message)),
      },
    ]),
  ]
}

// --- Engine 3: what to say or do ---------------------------------------------

/**
 * What `research_notes` is for, for the calls that never hear it otherwise.
 *
 * "Using web research" is only sent when our tools are attached, and it is the
 * only place the coach is told what that output field means. Qwen is the case
 * that falls through: it gets no tool schemas because it researches natively,
 * server-side - so it does the research and is never asked to keep any of it,
 * and `research_notes` comes back `[]` on the backend most runs actually use.
 *
 * Here rather than in the mind, and deliberately. This is a fact about an output
 * field, not something the coach believes, so the task block is its home; and a
 * new `##` section would be absent from every document already forked from the
 * seed, which is exactly the installations that need the fix.
 *
 * Kept off the tool-bearing path so that one keeps sending the section it
 * already has, and each variant stays a single constant string.
 */
const KEEP_WHAT_YOU_LOOKED_UP = `- If you looked anything up while answering this - your own search, not ours - keep what will still be true next month in "research_notes": the fact, not the search. "Cafe Lumen closes 9pm Sundays", "the studio is real, four people". It is the only part of your research this app can keep, it comes back to you in <research_notes> on the next call, and anything you found today and leave out is something the next run pays to find again. Still [] when you looked nothing up, or when what you found only mattered to this answer.
`

/**
 * The rule that keeps the block from doubling every run, and the one both paths
 * need - so it is here rather than folded into either.
 *
 * `<research_notes>` persists on its own: the app keeps what is already stored
 * and adds what comes back. Without this said out loud the field reads as the
 * set of things to have next time, and the honest response to that is to restate
 * everything already visible - which is what a real record did, until one venue
 * was written out six times and four stale lines outnumbered the one correcting
 * them. `KEEP_WHAT_YOU_LOOKED_UP` above sharpens the same edge from the other
 * side: what is lost by omission is today's findings, not the block.
 *
 * The tool-bearing path hears the rest of this from `KB_RESEARCH`, in the mind -
 * but a mind the user has already forked keeps the paragraph it was forked with,
 * so the correction has to travel in the task block too, where it reaches every
 * installation on the next release.
 */
const NOTES_ARE_A_DELTA = `- "research_notes" is a delta, not the list. Whatever is in <research_notes> stays there whether or not you return it, so never write out a line that is already in that block. Return what is new - and when something you found supersedes a line that's there, the correction, as a line that stands on its own and says what it replaces. One exception, and <research_notes> says so itself when it applies: if that block asks you to consolidate, it wants the whole list back and this rule is off for that run.
`

export function buildSuggestionMessages(
  record: DateRecord,
  message: string,
  mind: string,
  customPrompt: string,
  hasTools: boolean,
  /** Ask this run to rewrite the notes rather than add to them - see `researchNotesBlock`. */
  consolidateNotes: boolean,
): ChatMessage[] {
  const task = `<task>
Tell the user what to do next, and give them something they can actually send.
</task>

Standards for the drafts:
- Write in the user's voice, using their vocabulary and their message length. If the read of their voice is available, match it. A draft that doesn't sound like them is worse than no draft.
- Use only facts that exist in the material. Never invent a shared memory, a plan, or a feeling they haven't shown.
- The draft has to be sayable *by them*. A true fact is not automatically theirs to assert: anything that claims expertise, taste, or a habit of theirs you have no evidence for will be cut or, worse, sent - and then they cannot answer the first follow-up question about it. If a line rests on something you looked up rather than something they know, either put the looking-up in the line ("just searched this") or give them the fact and let them decide what to do with it.
- Options must be genuinely different bets - different risk, different intent - not three rewordings of the same message.
- Options differ in direction, not only in risk. When the last exchange is resolved, or the thread has run on one subject for a while, at least one option opens something new instead of replying to the last message. Never invented - but the places to find one are wider than the thread queue, and the queue is the last of them rather than the first: - what they care about, and what the user is into. Those two sections exist for   exactly this and are the only source that works on a thread with no history. - something they said once that nobody picked up. - something true about the user they have not been told yet - the profile records   what they know, so what is missing from it is the list. - and only then "Threads to pick back up". It is a queue of errands, favours and   logistics; when it supplies the new subject several runs running, the advice   reads like a to-do list, because it is one. If it could have been the next instalment of the conversation they are already in, it is not the new one. A subject the profile records as spent stays spent - and so is one you can see yourself offering in a COACH turn above that the user did not send. They passed on it once; offering it again is not a new option.
- Say what to avoid, and why, in terms of this specific conversation.
- Backing off or letting go is an option only when the evidence in front of you actually supports it - a sustained pattern over a meaningful window, not a slow reply, a short answer, or a thread that is simply young. Do not include it for balance. Most conversations are not failing, and the default job here is to help this one work.
- Only when interest really is one-sided across such a window: stop producing cleverer lines. Give a direct low-drama check-in or a dignified exit, and say plainly which one you'd pick.

${mindInstructions()}

${proposalInstructions()}

${OUTPUT_RULES}
- Every "draft" is verbatim sendable text (for a message) or a concrete, scheduled action (for an action). Never a description of what to say.
${hasTools ? '' : KEEP_WHAT_YOU_LOOKED_UP}${NOTES_ARE_A_DELTA}
Shape:
${SUGGESTION_SHAPE}`

  return [
    // `hasTools` flips the research section in and out, so this engine has two
    // possible system blocks rather than one. Both are still constant across
    // records, so each caches on its own and neither disturbs the other.
    {
      role: 'system',
      content: buildSystem(
        mind,
        hasTools ? ['all', 'next', 'research'] : ['all', 'next'],
        task,
        customPrompt,
      ),
    },
    layeredUser([
      { text: whoBlock(record) },
      { text: profileBlock(record, 'next'), cache: true },
      ...transcriptSegments(record),
      {
        text: volatileBlock(
          record,
          mind,
          consolidateNotes,
          fromUserBlock(message),
          'What should the user say or do next? Return the JSON object only.',
        ),
      },
    ]),
  ]
}
