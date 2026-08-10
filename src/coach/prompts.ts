// Every request is ordered strictly slowest-changing first, because a cached
// prefix survives only if every byte before it is unchanged:
//
//   system   the coach itself — the sections of `mind.ts` this engine is sent —
//            plus its task, output rules and shape, and the user's house
//            rules  [cache]        — constant per engine, across every record
//   user[0]  name, stage, what the user wants   — changes on a profile edit
//   user[1]  the markdown profiles  [cache]     — rewritten only by a rebuild
//   user[2…] the transcript, one block per turn, [cache] on the last
//                                               — appended to constantly
//   user[n]  research notes, the time, what was asked
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
// about a new person reads it rather than writing it. That is the layout the
// Claude Code capture in `refs/api.anthropic.com_request_body` uses too —
// everything instructional above, everything that grows below.
//
// The transcript is one block per turn so an append leaves the earlier blocks
// byte-identical. As a single segment it was rewritten by every added turn.

import { layeredUser, type ChatMessage, type ContentSegment } from '@/lib/llm-client'
import { describeBirthday } from '@/lib/birthday'
import { formatTurn } from '@/lib/transcript'
import type { ChatEngine, DateRecord } from '@/types/date'
import { mindFor, mindInstructions, type Audience } from './mind'
import { PERSON_SECTIONS, PROFILE_WORD_CEILING, SELF_SECTIONS } from './profile'
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
 * age once a year — both harmless here. The mark above the transcript holds an
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
      ? `Their age: ${meta.age}, as recorded on ${new Date(record.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} — age it forward if that matters`
      : null,
    meta.pronouns ? `Their pronouns: ${meta.pronouns}` : null,
    meta.location ? `Location: ${meta.location}` : null,
  ].filter(Boolean)
  return bits.join('\n')
}

/**
 * The last of the standing blocks, and it has to stay there. This is the one
 * value that changes on every single request, so anywhere above a cache
 * breakpoint it would invalidate the whole prefix each time — the transcript
 * included. (The Claude Code capture in
 * `refs/api.anthropic.com_request_body` keeps its system prompt byte-stable for
 * exactly this reason and delivers time per-message instead.)
 *
 * The caveat is doing real work. `Turn.at` is free text the user may not have
 * filled in, and nothing else stamps a turn, so elapsed time is often genuinely
 * unknowable. Without saying so, a model handed "now" will happily infer that a
 * message was two days ago because that reads plausibly — the exact invention
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
timing — how long a silence has actually run, whether a plan is for tonight or
next week, which evening to suggest.

Only where the material supports it. Turn timestamps are optional free text the
user may never have entered, so unless a turn says when it happened, you do not
know how long ago it was. Say that instead of estimating. "How long since her
last message?" is a good open question; an invented interval is not.`
}

function researchNotesBlock(record: DateRecord): string | null {
  const notes = record.researchNotes?.trim()
  if (!notes) return null
  return `<research_notes>
${notes}
</research_notes>
Durable facts kept from earlier web research. Reuse them instead of re-searching — only search
again if what you need isn't here or might have changed (an opening-hours note from months ago,
for instance).`
}

/**
 * What the user typed into the footer box when they asked. One-shot on all three
 * tabs, and the same tag on all three, because it is the same thing: a person
 * saying something to the engine they are looking at, right now.
 *
 * It used to be a standing per-engine thread — every note re-sent on every later
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
What the user typed when they asked — what is going on right now, direction about
the answer, or both. Act on it: drop a framing they rejected, weight what they say
matters, and take any fact they add about their own life as true; they were there
and you weren't. What it cannot do is make the evidence say something it doesn't.
If it asks for a conclusion the material won't carry, say so plainly in the honest
note instead of manufacturing support for it.`
}

/**
 * Who is being discussed, and what the user is trying to get out of it. The
 * first record-specific thing in the request, sitting directly under the shared
 * system entry — small, and changed only by a profile edit.
 *
 * Nothing here describes either *person*. It used to: a `seedThem` / `seedMe`
 * blob sat in this slot, above the transcript, in the position the layering
 * reserves for the most authoritative material — while being the one input
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
 * The most volatile thing above the tail, so it sits last of the cached strata —
 * everything constant has already been marked by the time a new turn lands here.
 *
 * The breakpoint has to sit on the final *turn*, not after the closing tag:
 * caching reads by longest matching prefix, so what the next request needs is
 * for everything up to the mark to still be a prefix of it. Add a turn and the
 * new request reads `…[tₙ][tₙ₊₁]</transcript>` — the old entry ending at `[tₙ]`
 * still matches, and only the new turn is paid for. Put the mark after
 * `</transcript>` and the tag lands in the middle of the new request, matching
 * nothing.
 *
 * `<counts>` used to ride along here — turn, word and question tallies per side.
 * It is gone from the request entirely, not moved. It shipped with a caveat
 * saying the numbers were unreliable, because the user may only have entered
 * part of a conversation, and a disclaimer does not stop a model anchoring on a
 * number: what it produced was arithmetic about investment symmetry standing in
 * for reading the thread. The transcript is right there, and who is writing more
 * is visible in it. `transcriptStats` still backs the count in the UI header,
 * where the reader knows what they entered.
 */
function transcriptSegments(record: DateRecord): ContentSegment[] {
  const turns: ContentSegment[] = record.turns.length
    ? record.turns.map((turn, i) => ({ text: formatTurn(record, turn, i) }))
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
  return `Lines labelled NOTE are not messages. They are things the user wrote down about the
connection — learned on a call, from a friend, in person, or simply remembered —
placed where they were learned. Treat them as the user telling you something
directly: true about their life, and citable like any other numbered line. They
are not evidence about how either person writes.`
}

/**
 * The whole point of putting advice in the pool. Same gating rule as the note
 * above: absent until a record actually has one.
 *
 * This is the only feedback signal the coach has ever had. Everything else it
 * knows is what the user typed at it; this is what happened when its own advice
 * met the world, and it is free — nobody has to grade anything, because the
 * next turn either is the draft or isn't.
 *
 * The last paragraph is load-bearing in the other direction. A run that has
 * just read its own confident advice will treat it as established fact unless
 * told not to, and then cites itself as evidence about her.
 */
function coachEntryNote(record: DateRecord): string | null {
  if (!record.turns.some((t) => t.speaker === 'coach')) return null
  return `Lines labelled COACH are your own past advice to this user, at the point you
gave it. What happened next is directly underneath.

Read the pair. If their next message is one of the drafts you offered, close to
it, they took it — so what came back is evidence about whether it worked. If it
is something else, they didn't, and that is worth as much: they saw the options
and wrote their own, which tells you where your read of their voice was off. If
nothing follows it yet, the advice is simply outstanding.

Say so when something you tried didn't land. Repeating a move that already
failed in this same thread is the specific failure to avoid here.

Your own advice is not evidence about either person. It is what you said, not
something that happened. Only their replies and the user's notes are material.`
}

/**
 * The tail — everything that can change between two runs of the same engine,
 * ordered by ascending change frequency so the cheapest thing to invalidate
 * sits lowest. Everything here is below every breakpoint, so none of it can
 * disturb the profile or the transcript above.
 */
function volatileBlock(record: DateRecord, ...trailing: (string | null)[]): string {
  // `nowBlock` sits last of the standing blocks — see its comment. It is the
  // most volatile thing in the request, so it belongs as late as possible, and
  // below every breakpoint including the profile one above.
  return [researchNotesBlock(record), nowBlock(), ...trailing]
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
 * ~3–5k tokens against 200k, and *there is no useful slice* — writing one draft
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
   * now contradicting. The rest of the judgment stays out — a rebuild
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
      ? `What is known about these two, accumulated across every rebuild so far. Work
from it. The transcript above stays the source for exact wording, and for
anything said after the profile was last updated — where they disagree, the
transcript wins.`
      : `The profile as it stands, which you are about to amend. It was written from
earlier versions of this same transcript. Where the newer turns contradict it,
the transcript wins and the profile is what needs correcting.${
          headline
            ? `

<headline_now> is the two-line summary shown directly above this prose in the
app. It was written by the last full rebuild and nothing has touched it since, so
it can be older than what you are reading — and if your amendment leaves it
describing a profile that no longer exists, it is the first thing the user reads
and the first thing they see is wrong.`
            : ''
        }`

  return `${parts.join('\n\n')}\n\n${framing}`
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
  return `The profile is a markdown document you maintain across rebuilds. It is above,
under <profile_of_them> or <profile_of_the_user>, or absent if this is the first
rebuild. You do not rewrite it. You return only what changed.

- Amend by heading. "replace" swaps a section's body, "append" adds to the end of
  one, "delete" removes it. An unknown heading is created, so the first rebuild is
  just a list of "replace" ops that build the document.
- Return changed: false when nothing you read actually changes it. After one new
  turn that is usually the right answer, and it is a real answer, not a failure.
- Prefer "append" for a fact learned. Use "replace" when something you already
  wrote turned out to be wrong or has moved on — and say what it is now, not what
  it used to be.
- Headings to work with, in this order. Add your own where the material genuinely
  needs one; don't rename these:
${sections.map((s) => `  - ${s}`).join('\n')}
- The profile is what you *know*. What you don't know goes in open_questions, and
  nowhere else — never as a section, and never folded into one. "Threads to pick
  back up" is the near miss to watch: that is for things they raised and the
  conversation left hanging, so it holds subjects, not gaps. If you find yourself
  writing "the user has never asked about X" into a section, X is an open
  question and belongs in that field.
- Write bullets, not paragraphs. Carry the confidence with the claim, in the
  body: "- Landscape architect, at a small studio (high)". Cite the turn where it
  came from when there is one: "[4]".
- Keep it under about ${PROFILE_WORD_CEILING} words. Past that, spend a rebuild
  consolidating — merge duplicates, drop what stopped mattering, delete a section
  that has emptied out.
- "rewrite" replaces the whole document and is almost never right. Reach for it
  only when the structure itself has gone wrong and section edits can't fix it.`
}

/**
 * The whole instructional half of the request, and the largest single block in
 * it. Constant for a given engine across every record and every conversation —
 * which is the point of it being here rather than in a user turn. One entry per
 * engine gets written once and read by every call about every person, instead of
 * each record paying to cache its own copy of the same knowledge base.
 *
 * Nothing record-specific may enter this string. A name, a stage, a profile —
 * anything that varies per person — and the entry stops being shared and starts
 * being written once per record, which is the cost this layout exists to avoid.
 * The two variable inputs both vary per *user* rather than per record: the mind,
 * and `customPrompt`. Each costs one rewrite of this entry when it changes.
 *
 * `audiences` selects which sections of the mind this engine is sent, so a
 * rebuild never pays for the 2.4k tokens of the next-move playbook. See
 * `mind.ts` — the sections are addressable by heading precisely so the coach can
 * amend them, and sliceable by audience so nobody pays for the ones they don't
 * need.
 */
function buildSystem(
  mind: string,
  audiences: Audience[],
  task: string,
  customPrompt: string,
): string {
  const system = `${mindFor(mind, audiences)}

${task}

The material follows in the message below — who these two people are, what is
already known about them, and what was actually said. Read it, then do what the
task above asks.`

  const extra = customPrompt.trim()
  if (!extra) return system
  return `${system}\n\n## The user's own standing instructions\nThese override the style preferences in the task above, but never the non-negotiables.\n${extra}`
}

// --- Engine 1: rebuild their context ----------------------------------------

export function buildPersonMessages(
  record: DateRecord,
  mind: string,
  customPrompt: string,
): ChatMessage[] {
  const task = `<task>
Update what is known about the person the user is seeing, from everything in the
transcript — what was said, and what the user has noted down about them. Where a
note and the messages disagree, the messages win: people describe their dates the
way they wish they were.

Absorb the notes into the profile so the raw note stops being needed. A note may
be long and unedited — a bio, a paragraph typed from memory. Keep what bears on
this connection and drop the rest. This is the one place a fact with no support
in the messages is still legitimate, because the user asserted it: mark it low
confidence and say it came from their note.
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
          `Update what you know about ${record.name}. Return the JSON object only, with all of headline, interest_read, flags, open_questions and profile.`,
        ),
      },
    ]),
  ]
}

// --- Engine 2: rebuild the user's context ------------------------------------

export function buildSelfMessages(
  record: DateRecord,
  mind: string,
  customPrompt: string,
): ChatMessage[] {
  const task = `<task>
Show the user themselves — how they are actually showing up in this specific
connection, based on what they wrote and how the other person responded to it.
This is the half they control, so it's the half worth being precise about.

Absorb what they have written down about themselves into the profile, so the raw
note stops being needed. They may have pasted something long and unedited — a CV,
a dating-app bio, a paragraph typed at 1am. Keep the part that bears on *this*
connection and drop the rest: their hours, their situation, a constraint,
something that explains how they behave here. A job title earns its place only
if it changes something between these two people. This is the one place a fact
with no support in the transcript is still legitimate, because the user asserted
it — mark it low confidence and attribute it to their own note.

Where a note the user wrote about themselves and their actual messages disagree,
the messages win. Self-descriptions get written to be read by someone — a bio, a
CV, a version of themselves they'd like to be true — and this is a read of who
they are in this conversation. "How you write" in particular comes only from
their own turns: how they actually type, at whatever length they actually type
it. Never take voice from a note.

Be generous and be straight. Name what's working as specifically as what isn't;
people repeat what gets named. Don't moralise, don't flatter, and don't diagnose.
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
          'Update the read of the user in this connection. Return the JSON object only, with all of headline, goal_read, open_questions and profile.',
        ),
      },
    ]),
  ]
}

// --- Talking about a profile --------------------------------------------------

/**
 * One instruction to amend a profile. **Not a conversation** — nothing about the
 * exchange is kept.
 *
 *   [system ✂][who][profile ✂][turns… ✂][/transcript][research + now][the instruction]
 *
 * Structurally identical to the rebuild engines; only the task and the tail
 * differ. It briefly persisted a chat history, which cost a fourth breakpoint
 * and forced an awkward set of constraints — strict role alternation, a mark on
 * the last *stored* message rather than the new one, and a rule that a user turn
 * could only be written once its reply succeeded. All of that is gone, and so is
 * the open question about whether the profile belonged above or below the
 * history: there is no history to order it against.
 *
 * The reason it went is the rule this whole redesign runs on. The instruction's
 * entire effect lands in the profile, so keeping the instruction as well means
 * storing the same information twice and paying for the redundant copy on every
 * later request — exactly what the seed blobs did, and what a pasted CV sitting
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
  // a name here quietly turned one cached entry per engine into one per person —
  // the exact cost this layout exists to avoid. The name is directly below, in
  // `whoBlock`, where a per-record value belongs.
  const who = engine === 'them' ? 'the person the user is seeing' : 'the user'
  const sections = engine === 'them' ? PERSON_SECTIONS : SELF_SECTIONS

  const task = `<task>
The user is telling you to change what you know about ${who}. Do it, and say in
a sentence or two what you did.
</task>

This is one instruction, not a conversation. Nothing you write here is kept
except the profile itself, so put the substance in the amendment and keep the
reply to a short confirmation the user reads once.

- A correction — take it. Change what you wrote, and don't defend the old read or
  apologise your way through it. Say what it now says instead.
- A fact you didn't have — that goes in the profile. They were there and you
  weren't, so their facts win.
- A question — answer it from the material and change nothing. If the answer
  isn't in the material, say so plainly; that's more useful than a guess, and it
  usually names what they should find out next.
- An instruction the evidence won't carry — say so rather than writing it in.
  Their facts win; their conclusions don't automatically.
- changed: false is a real answer. A question asked, a read explained, an
  instruction you had to decline — none of those touch the document.
- Check the headline last. If what you just wrote contradicts <headline_now>,
  replace it; that sentence sits above the prose in the app and the user reads it
  first. If your amendment doesn't touch what it says, leave it — "" — because a
  headline rewritten on every small correction drifts as badly as one never
  rewritten at all.

${updateInstructions(sections)}

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
        text: volatileBlock(record, fromUserBlock(message)),
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
 * server-side — so it does the research and is never asked to keep any of it,
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
const KEEP_WHAT_YOU_LOOKED_UP = `- If you looked anything up while answering this — your own search, not ours —
  keep what will still be true next month in "research_notes": the fact, not the
  search. "Cafe Lumen closes 9pm Sundays", "the studio is real, four people".
  It is the only part of your research this app can keep, it comes back to you
  in <research_notes> on the next call, and anything you leave out is something
  the next run pays to find again. Still [] when you looked nothing up, or when
  what you found only mattered to this answer.
`

export function buildSuggestionMessages(
  record: DateRecord,
  message: string,
  mind: string,
  customPrompt: string,
  hasTools: boolean,
): ChatMessage[] {
  const task = `<task>
Tell the user what to do next, and give them something they can actually send.
</task>

Standards for the drafts:
- Write in the user's voice, using their vocabulary and their message length. If the
  read of their voice is available, match it. A draft that doesn't sound like them is
  worse than no draft.
- Use only facts that exist in the material. Never invent a shared memory, a plan, or
  a feeling they haven't shown.
- Options must be genuinely different bets — different risk, different intent — not
  three rewordings of the same message.
- Say what to avoid, and why, in terms of this specific conversation.
- Backing off or letting go is an option only when the evidence in front of you
  actually supports it — a sustained pattern over a meaningful window, not a slow
  reply, a short answer, or a thread that is simply young. Do not include it for
  balance. Most conversations are not failing, and the default job here is to help
  this one work.
- Only when interest really is one-sided across such a window: stop producing
  cleverer lines. Give a direct low-drama check-in or a dignified exit, and say
  plainly which one you'd pick.

${mindInstructions()}

${OUTPUT_RULES}
- Every "draft" is verbatim sendable text (for a message) or a concrete, scheduled
  action (for an action). Never a description of what to say.
${hasTools ? '' : KEEP_WHAT_YOU_LOOKED_UP}
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
          fromUserBlock(message),
          'What should the user say or do next? Return the JSON object only.',
        ),
      },
    ]),
  ]
}
