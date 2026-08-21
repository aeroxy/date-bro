import type { PersonProfile, SelfProfile } from '@/types/coach'
import { STAGES, type DateRecord, type NumberedRecord, type NumberedTurn } from '@/types/date'
import { describeBirthday } from './birthday'
import { numberTurns, speakerLabel, transcriptStats } from './transcript'

/**
 * One record as a document — everything the app holds about one person, in the
 * order the panels show it.
 *
 * Absolute dates throughout, never `ago()`. A relative stamp is only true at the
 * moment it is rendered, and this is the one thing here that leaves the app: a
 * file saying "rebuilt 2d ago" is wrong the day after it is written and there is
 * nothing left to correct it.
 *
 * Deliberately its own rendering of a turn rather than `formatTurn`. That one is
 * shaped by the prompt: byte-stable for the prefix cache, labelled for a model
 * that has to cite it. This one is shaped for a reader, so a message is a
 * blockquote and a note is prose. The two share `speakerLabel`, which is the
 * part that must not drift — who a turn is from reads the same in the panel, in
 * the prompt and here.
 */
export function recordToMarkdown(record: DateRecord, now = new Date()): string {
  const them = record.name.trim() || 'Them'
  return (
    [
      `# ${them}`,
      `_Everything this app has about ${them}, exported ${day(now)}._`,
      facts(record, now),
      section('What you want from this', record.goal.trim() || '_Not stated._'),
      record.themProfile ? personSection(them, record.themProfile) : null,
      record.meProfile ? selfSection(record.meProfile) : null,
      conversation(numberTurns(record)),
      section('Research notes', record.researchNotes?.trim()),
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  )
}

/**
 * `mira-2026-08-13.md`. Built from the local calendar rather than
 * `toISOString()`, which is UTC and so names a file after yesterday for anyone
 * far enough west.
 */
export function exportFilename(record: DateRecord, now = new Date()): string {
  const slug = record.name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${slug || 'date'}-${date}.md`
}

const day = (when: number | Date) =>
  new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

const at = (ts: number) =>
  new Date(ts).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** A `##` section, or nothing when there is no body to put under it. */
function section(heading: string, body?: string | null): string | null {
  return body?.trim() ? `## ${heading}\n\n${body.trim()}` : null
}

const bullets = (items?: string[]): string | null =>
  items?.length ? items.map((i) => `- ${i.trim()}`).join('\n') : null

/** A bold label with its list underneath — a judgment field, not a section. */
function labelled(label: string, items?: string[]): string | null {
  const list = bullets(items)
  return list && `**${label}:**\n\n${list}`
}

/** A `###` subsection with a list underneath. */
function subsection(heading: string, items?: string[]): string | null {
  const list = bullets(items)
  return list && `### ${heading}\n\n${list}`
}

/**
 * Message text as a blockquote. It is the one rendering that keeps a multi-line
 * message together in a renderer — bare lines would collapse into the label
 * above them — while still reading as a quoted message raw. A blank line inside
 * becomes a bare `>`, so the quote doesn't split into two.
 */
const quote = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')

/**
 * The prose owns `##` for its own sections (see `coach/profile.ts`), and here it
 * sits *under* one — so every heading in it drops a level and the document keeps
 * one outline. Capped at five, because nothing renders a seventh level.
 */
const nest = (markdown: string) => markdown.trim().replace(/^(#{1,5}) /gm, '$1# ')

/**
 * The standing facts. Same rule as `prompts.ts`: the retired free-text age is
 * shown only when no birthday has replaced it, and stamped with the day it was
 * entered — a bare "28" from eighteen months ago reads as current and isn't.
 */
function facts(record: DateRecord, now: Date): string {
  const { meta } = record
  // `now` rather than the function's own default, so the age in the document and
  // the date at the top of it are read off the same clock.
  const born = meta.birthday ? describeBirthday(meta.birthday, now) : null
  return [
    `- **Stage:** ${STAGES.find((s) => s.value === record.stage)?.label ?? record.stage}`,
    meta.since ? `- **Talking since:** ${meta.since}` : null,
    meta.howWeMet ? `- **How you met:** ${meta.howWeMet}` : null,
    born ? `- **Birthday:** ${born}` : null,
    !born && meta.age ? `- **Age:** ${meta.age}, as recorded on ${day(record.createdAt)}` : null,
    meta.pronouns ? `- **Pronouns:** ${meta.pronouns}` : null,
    meta.location ? `- **Location:** ${meta.location}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Both halves of a profile's age, for the same reason the panel shows both: a
 * chat amendment rewrites the prose and leaves the judgment alone, so one date
 * would have to misdate one of them.
 */
const freshness = (profile: { generatedAt: number; amendedAt?: number }) =>
  `_Rebuilt ${at(profile.generatedAt)}${
    profile.amendedAt ? ` · prose amended ${at(profile.amendedAt)}` : ''
  }_`

function personSection(name: string, profile: PersonProfile): string {
  const { headline, interest_read: read, flags, open_questions } = profile.judgment
  return [
    `## ${name}`,
    freshness(profile),
    headline.trim() ? quote(headline) : null,
    `**Where they stand:** ${read.level.replace('-', ' ')}${
      read.toward?.length ? ` · toward ${read.toward.join(', ')}` : ''
    } (confidence: ${read.confidence})`,
    labelled('Pointing yes', read.signals_for),
    labelled('Pointing no', read.signals_against),
    read.honest_note.trim() ? `**Straight with you:** ${read.honest_note.trim()}` : null,
    flags?.length
      ? `### Flags\n\n${flags.map((f) => `- **${f.kind} · ${f.label}** — ${f.evidence}`).join('\n')}`
      : null,
    profile.markdown.trim() ? nest(profile.markdown) : null,
    subsection(`What you still don't know about ${name}`, open_questions),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function selfSection(profile: SelfProfile): string {
  const { headline, goal_read: goal, open_questions } = profile.judgment
  const stated = goal?.stated?.trim()
  const revealed = goal?.revealed?.trim()
  return [
    '## You',
    freshness(profile),
    headline.trim() ? quote(headline) : null,
    profile.markdown.trim() ? nest(profile.markdown) : null,
    stated || revealed
      ? `### What you're actually after\n\n- **You said:** ${stated || '—'}\n- **Your messages say:** ${revealed || '—'}`
      : null,
    goal?.tension?.trim() ? `**Straight with you:** ${goal.tension.trim()}` : null,
    subsection('Worth getting clear on', open_questions),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function conversation(record: NumberedRecord): string {
  const stats = transcriptStats(record)
  const them = record.name.trim() || 'them'
  return [
    '## Conversation',
    // `turnsUpdatedAt` is 0 on records migrated from before it existed, and a
    // stamp is worse than no stamp when it reads "1 January 1970".
    stats.total
      ? `_${stats.total} turns — ${stats.themTurns} from ${them}, ${stats.myTurns} from you${
          record.turnsUpdatedAt > 0 ? ` · last edited ${day(record.turnsUpdatedAt)}` : ''
        }_`
      : null,
    record.turns.length
      ? record.turns.map((turn) => turnBlock(record, turn)).join('\n\n')
      : '_Nothing entered yet._',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function turnBlock(record: DateRecord, turn: NumberedTurn): string {
  const meta = [turn.at, turn.channel && turn.channel !== 'text' ? turn.channel : null]
    .filter(Boolean)
    .join(' · ')
  return [
    `**[${turn.number}] ${speakerLabel(record, turn.speaker)}**${meta ? ` · ${meta}` : ''}`,
    turn.asked?.trim() ? `_Answering: ${turn.asked.trim()}_` : null,
    quote(turn.text),
    turn.note?.trim() ? `_Your note: ${turn.note.trim()}_` : null,
    drafts(turn),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * A coach turn's `text` is a two-line summary of a four-hundred-word generation
 * — the thesis and the labels it was chosen from, which is all a later run is
 * ever shown. The drafts are the one part of the rest worth keeping in a
 * document: they are the actual words that were offered, and nothing else
 * records them. The read, the reasoning and the timing stay out — they are panel
 * furniture, and inlining them would bury the conversation they sit inside.
 */
function drafts(turn: NumberedTurn): string | null {
  const options = turn.advice?.options
  if (!options?.length) return null
  return options
    .map(
      (o) =>
        `- **${o.label}** (${o.kind}, ${o.risk} risk): ${o.draft.trim().split('\n').join('\n  ')}`,
    )
    .join('\n')
}
