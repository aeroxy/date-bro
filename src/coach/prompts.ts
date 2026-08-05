// Every engine sends the same five strata, ordered slowest-changing first, so a
// prefix cache stays valid for as long as the material allows:
//
//   system   L0  identity + non-negotiables + inference discipline + the user's
//                standing instructions        — constant across engines and records
//   user[0]  L1  who these two people are     — changes when the profile is edited
//   user[1]  L2  transcript + counts  [cache] — append-only
//   user[2]  L3  this engine's job, its knowledge, output rules, shape  [cache]
//                                            — constant per engine, forever
//   user[3]  L4  research notes, prior reads, feedback, the question
//
// L3 sits *after* the transcript deliberately. It is the whole reason the three
// engines can read one another's L2 entry rather than each writing its own copy
// of the transcript — and instructions-last is the better layout for a long
// input anyway. The invariant that matters: nothing above a [cache] mark may
// change more often than the mark itself, or the entry is written and never
// read. That is why research notes are down in L4 despite reading like material:
// a single researched suggestion rewrites them.

import { layeredUser, type ChatMessage } from '@/lib/llm-client'
import { formatTranscript, transcriptStats } from '@/lib/transcript'
import type { DateRecord } from '@/types/date'
import type { PersonContext, SelfContext } from '@/types/coach'
import { KB_ETHICS, KB_EVIDENCE, KB_MOVES, KB_READ_ME, KB_READ_THEM, KB_RESEARCH } from './knowledge'
import { PERSON_SHAPE, SELF_SHAPE, SUGGESTION_SHAPE } from './schemas'

const IDENTITY = `You are the analyst behind Date Bro — a dating coach that works from evidence, not vibes.

You are not a hype man and not a pickup artist. You are the friend who has read the
research, who notices what actually happened, and who will tell someone the truth
about where they stand even when it costs them the fantasy. You are warm about it.
You are never cruel, and never coy.`.trim()

const OUTPUT_RULES = `Output rules:
- Return a single JSON object matching the shape below. No prose, no code fence, no commentary.
- Every string is plain text the user will read directly. Write like a person, not a report:
  short sentences, concrete nouns, no consultant-speak, no bullet-point fragments as sentences.
- Never invent a fact about either person. If it isn't in the material, it goes in open_questions.
- Quote or closely paraphrase the transcript for evidence, and cite the turn number like [4].`

function stageLine(record: DateRecord): string {
  const bits = [
    `Stage: ${record.stage}`,
    record.meta.since ? `Since: ${record.meta.since}` : null,
    record.meta.howWeMet ? `How they met: ${record.meta.howWeMet}` : null,
    record.meta.age ? `Their age: ${record.meta.age}` : null,
    record.meta.pronouns ? `Their pronouns: ${record.meta.pronouns}` : null,
    record.meta.location ? `Location: ${record.meta.location}` : null,
  ].filter(Boolean)
  return bits.join('\n')
}

function statsBlock(record: DateRecord): string {
  const s = transcriptStats(record)
  if (s.total === 0) return ''
  return `<counts>
Turns — them ${s.themTurns}, user ${s.myTurns}
Words — them ${s.themWords}, user ${s.myWords}
Turns containing a question — them ${s.themQuestions}, user ${s.myQuestions}
</counts>
These are raw counts of what the user chose to enter. They are a starting point for
reading investment symmetry, not a verdict — the user may have entered only part of
the conversation, and one long message is not the same as sustained interest.`
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
 * The user talking back to an engine. They are the authority on their own life;
 * they are not the authority on what the transcript shows — hence the last two
 * sentences, which are the whole reason this block has prose around it.
 */
function feedbackBlock(notes: string[]): string | null {
  const kept = notes.map((n) => n.trim()).filter(Boolean)
  if (!kept.length) return null
  return `<notes_from_the_user>
${kept.map((n, i) => `${i + 1}. ${n}`).join('\n')}
</notes_from_the_user>
Things the user wrote after reading earlier versions of this output, oldest first;
where two conflict, the later one wins. Act on them: drop a framing they rejected,
weight what they say matters, and take any fact they add about their own life as true
— they were there and you weren't. What a note cannot do is make the evidence say
something it doesn't. If one asks for a conclusion the material won't carry, say so
plainly in the honest note or open questions instead of manufacturing support for it.`
}

/** L1 — the two people. Moves only when the user edits the profile. */
function whoBlock(record: DateRecord): string {
  return `<the_person>
Name: ${record.name}
${stageLine(record)}

What the user knows about them:
${record.seedThem.trim() || '(nothing written yet)'}
</the_person>

<the_user>
Who the user is, in relation to this person:
${record.seedMe.trim() || '(nothing written yet)'}

What the user says they want from this:
${record.goal.trim() || '(not stated)'}
</the_user>`
}

/**
 * L2 — the bulk of every request, and the only stratum big enough to be worth
 * caching. Append-only in normal use. `<counts>` rides along because it is a
 * pure function of the transcript: it changes exactly when the transcript does,
 * never independently, so it costs the prefix nothing.
 */
function transcriptBlock(record: DateRecord): string {
  return [`<transcript>\n${formatTranscript(record)}\n</transcript>`, statsBlock(record)]
    .filter(Boolean)
    .join('\n\n')
}

/** L4 — everything that can change between two runs of the same engine. */
function volatileBlock(record: DateRecord, feedback: string[], ...trailing: (string | null)[]): string {
  return [researchNotesBlock(record), priorContext(record), feedbackBlock(feedback), ...trailing]
    .filter(Boolean)
    .join('\n\n')
}

function priorContext(record: DateRecord): string {
  const parts: string[] = []
  if (record.themContext) {
    parts.push(`<previous_read_of_them>
${summarisePerson(record.themContext)}
</previous_read_of_them>
This was generated from an earlier version of the transcript. Treat it as a prior,
not as fact — if the newer turns contradict it, the transcript wins.`)
  }
  if (record.meContext) {
    parts.push(`<previous_read_of_the_user>
${summariseSelf(record.meContext)}
</previous_read_of_the_user>`)
  }
  return parts.join('\n\n')
}

function summarisePerson(ctx: PersonContext): string {
  const claims = (list: { claim: string; confidence: string }[]) =>
    list.map((c) => `- ${c.claim} (${c.confidence})`).join('\n')
  return [
    ctx.headline,
    '',
    'Who they are:',
    claims(ctx.who_they_are),
    'What they care about:',
    claims(ctx.what_they_care_about),
    'Right now:',
    claims(ctx.current_situation),
    '',
    `Communication: ${ctx.communication_style.summary}`,
    `Attachment hypothesis: ${ctx.communication_style.attachment_hypothesis.pattern} (${ctx.communication_style.attachment_hypothesis.confidence}) — ${ctx.communication_style.attachment_hypothesis.evidence}`,
    `Interest: ${ctx.interest_read.level} (${ctx.interest_read.confidence}). ${ctx.interest_read.honest_note}`,
    ctx.flags.length ? `Flags: ${ctx.flags.map((f) => `[${f.kind}] ${f.label}`).join('; ')}` : '',
    ctx.sensitivities.length ? `Handle with care: ${ctx.sensitivities.join('; ')}` : '',
    ctx.open_threads.length ? `Open threads: ${ctx.open_threads.join('; ')}` : '',
    ctx.open_questions.length ? `Unknown: ${ctx.open_questions.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function summariseSelf(ctx: SelfContext): string {
  return [
    ctx.headline,
    '',
    'How they come across:',
    ctx.how_you_come_across.map((c) => `- ${c.claim} (${c.confidence})`).join('\n'),
    '',
    `Their voice: ${ctx.your_voice.summary}`,
    ctx.your_voice.markers.length ? `Voice markers: ${ctx.your_voice.markers.join('; ')}` : '',
    ctx.patterns.length
      ? `Patterns:\n${ctx.patterns.map((p) => `- ${p.pattern} → ${p.effect}`).join('\n')}`
      : '',
    ctx.working.length ? `Working: ${ctx.working.join('; ')}` : '',
    ctx.costing_you.length ? `Costing them: ${ctx.costing_you.join('; ')}` : '',
    ctx.you_have_revealed.length ? `Already disclosed: ${ctx.you_have_revealed.join('; ')}` : '',
    `Goal — stated: ${ctx.goal_read.stated}; revealed: ${ctx.goal_read.revealed}${ctx.goal_read.tension ? `; tension: ${ctx.goal_read.tension}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * L0 — identical for all three engines and every record, so the transcript that
 * follows it caches once and is read by all of them. The engine's actual job
 * arrives in L3, after the material; this says so, because a model shouldn't
 * read a 20k-token transcript wondering what it's for.
 */
function sharedSystem(customPrompt: string): string {
  const system = `${IDENTITY}

You will be given the material first — who these two people are, and what was
actually said — and then, at the end, the specific task and the exact shape of
the answer. Read the material, then do what the task asks.

${KB_ETHICS}

${KB_EVIDENCE}`

  const extra = customPrompt.trim()
  if (!extra) return system
  return `${system}\n\n## The user's own standing instructions\nThese override the style preferences in the task that follows, but never the non-negotiables above.\n${extra}`
}

// --- Engine 1: rebuild their context ----------------------------------------

export function buildPersonMessages(record: DateRecord, customPrompt: string): ChatMessage[] {
  const task = `<task>
Rebuild the picture of the person the user is seeing, from the seed context plus
everything that has been said since. Where the seed and the transcript disagree,
the transcript wins — people describe their dates the way they wish they were.
</task>

${KB_READ_THEM}

${OUTPUT_RULES}

Shape:
${PERSON_SHAPE}`

  return [
    { role: 'system', content: sharedSystem(customPrompt) },
    layeredUser([
      { text: whoBlock(record) },
      { text: transcriptBlock(record), cache: true },
      { text: task, cache: true },
      {
        text: volatileBlock(
          record,
          record.feedback.them,
          `Rebuild the picture of ${record.name}. Return the JSON object only.`,
        ),
      },
    ]),
  ]
}

// --- Engine 2: rebuild the user's context ------------------------------------

export function buildSelfMessages(record: DateRecord, customPrompt: string): ChatMessage[] {
  const task = `<task>
Show the user themselves — how they are actually showing up in this specific
connection, based on what they wrote and how the other person responded to it.
This is the half they control, so it's the half worth being precise about.

Be generous and be straight. Name what's working as specifically as what isn't;
people repeat what gets named. Don't moralise, don't flatter, and don't diagnose.
</task>

${KB_READ_ME}

${OUTPUT_RULES}
- Write "you" to address the user directly.

Shape:
${SELF_SHAPE}`

  return [
    { role: 'system', content: sharedSystem(customPrompt) },
    layeredUser([
      { text: whoBlock(record) },
      { text: transcriptBlock(record), cache: true },
      { text: task, cache: true },
      {
        text: volatileBlock(
          record,
          record.feedback.me,
          'Rebuild the read of the user in this connection. Return the JSON object only.',
        ),
      },
    ]),
  ]
}

// --- Engine 3: what to say or do ---------------------------------------------

export function buildSuggestionMessages(
  record: DateRecord,
  question: string,
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
  three rewordings of the same message. If one of the honest options is "do nothing
  for now" or "let this one go", make it one of them.
- Say what to avoid, and why, in terms of this specific conversation.
- If interest is clearly one-sided, do not produce a cleverer line. Produce a direct
  low-drama check-in, or a dignified exit, and say plainly which one you'd pick.

${KB_MOVES}
${hasTools ? `\n${KB_RESEARCH}\n` : ''}
${OUTPUT_RULES}
- Every "draft" is verbatim sendable text (for a message) or a concrete, scheduled
  action (for an action). Never a description of what to say.

Shape:
${SUGGESTION_SHAPE}`

  const ask = question.trim()

  return [
    { role: 'system', content: sharedSystem(customPrompt) },
    layeredUser([
      { text: whoBlock(record) },
      { text: transcriptBlock(record), cache: true },
      // `hasTools` flips KB_RESEARCH in and out, so this block has two possible
      // values per engine rather than one. Both still sit after the transcript,
      // so neither disturbs the entry above.
      { text: task, cache: true },
      {
        text: volatileBlock(
          record,
          record.feedback.next,
          ask ? `<the_situation>\n${ask}\n</the_situation>` : null,
          'What should the user say or do next? Return the JSON object only.',
        ),
      },
    ]),
  ]
}
