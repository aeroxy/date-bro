import type { Suggestion } from '@/types/coach'
import type { DateRecord, NumberedRecord, NumberedTurn, Speaker, Turn } from '@/types/date'

/** How a turn is labelled everywhere — prompts, UI, pasted logs. */
export function speakerLabel(record: Pick<DateRecord, 'name'>, speaker: Speaker): string {
  if (speaker === 'me') return 'ME'
  if (speaker === 'context') return 'NOTE'
  if (speaker === 'coach') return 'COACH'
  return record.name.trim().toUpperCase() || 'THEM'
}

/**
 * A suggestion, as the line that goes in the transcript.
 *
 * Two lines out of a generation that runs to four hundred words, and derived
 * here rather than asked of the model — there is no output field to get wrong,
 * no tokens spent, and the same suggestion always renders the same way. The
 * whole thing still rides along in `advice` for the panel; this is only what
 * later requests pay for.
 *
 * What it keeps is what a later run can actually learn from: the thesis, and
 * the menu it was chosen from. Whether the user took any of it is not recorded
 * here and doesn't need to be — it is written in the turns underneath, either
 * as a draft sent verbatim or as something else entirely.
 *
 * The turn takes the suggestion's own id. One thing, one identity: the panel
 * can key on either and they can't drift apart.
 */
export function adviceTurn(suggestion: Suggestion): Turn {
  const labels = suggestion.options.map((o) => o.label.trim()).filter(Boolean)
  const text = [
    suggestion.priority.trim(),
    labels.length ? `Offered: ${labels.join(' · ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  return { id: suggestion.id, speaker: 'coach', text, advice: suggestion }
}

/**
 * Give every turn a citation number and remember the next one to hand out.
 *
 * Pure, total and idempotent, like the migrations in `db.ts`: a record read a
 * hundred times before it is next saved comes out the same each time, and a
 * record that already has its numbers comes back by identity rather than as a
 * fresh object that would churn React below it.
 *
 * Two sources for "the next number", and the counter is allowed to win. The
 * turns can only say what survives; the counter says what has ever been handed
 * out. That is exactly the case deletion breaks — see `nextTurnNumber`.
 *
 * A record with no numbers at all is one written before this existed, and it gets
 * 1…n in array order. That is not an arbitrary starting point: it is what the old
 * positional rendering already showed, so every `[4]` sitting in a stored profile
 * keeps pointing at the turn it was written about. Any other assignment would
 * silently re-aim prose nobody is going to re-read.
 *
 * Uniqueness of numbers already present is assumed, not enforced — see
 * `Turn.number` for why repairing a duplicate is worse than carrying it. What is
 * enforced is that nothing *new* collides: the counter is raised past every
 * number any turn holds, duplicate or not, so a third copy can't be issued.
 */
export function numberTurns(record: DateRecord): NumberedRecord {
  let next = Math.max(record.nextTurnNumber ?? 1, ...record.turns.map((t) => (t.number ?? 0) + 1), 1)
  const before = next
  // The cast is the check on the line above it: a turn keeping its own number
  // has one, which is all `NumberedTurn` claims.
  const turns = record.turns.map((turn): NumberedTurn =>
    turn.number === undefined ? { ...turn, number: next++ } : (turn as NumberedTurn),
  )
  // Same reasoning one level up. `next === before` means nothing was assigned, so
  // every turn already carried a number, and the counter is defined because it
  // equals `next`. Returning `record` itself keeps the identity fast path.
  return next === before && record.nextTurnNumber === next
    ? (record as NumberedRecord)
    : { ...record, turns, nextTurnNumber: next }
}

/**
 * One turn as the model sees it. Numbered so the model can cite a specific one
 * as evidence instead of paraphrasing vaguely — `context` entries included,
 * since a fact the user recorded is as citable as a message. What a `NOTE:`
 * line means is spelled out in `transcriptSegments`.
 *
 * A pure function of `(turn, name)` now that the number rides on the turn, which
 * is what makes the prefix cache work: the prompt sends one block per turn, so
 * appending turn n+1 leaves the first n blocks byte-identical and the previously
 * cached prefix still matches. Anything that made an earlier turn's text depend
 * on a later one would quietly undo that. Dropping the positional dependency
 * strengthens this rather than threatening it: inserting a turn mid-transcript
 * used to renumber and so rewrite every block below it, invalidating the cache
 * from that point down for a change that was one line long.
 *
 * It takes a `NumberedTurn` rather than a `Turn` and an index. There is no
 * fallback for an unnumbered turn on purpose — see `NumberedTurn`.
 */
export function formatTurn(record: Pick<DateRecord, 'name'>, turn: NumberedTurn): string {
  // The question rides in the label rather than above the answer, so a one-line
  // entry stays one line and the pairing can't be misread as two.
  const meta = [
    turn.at,
    turn.channel && turn.channel !== 'text' ? turn.channel : null,
    turn.asked?.trim() ? `asked: ${turn.asked.trim()}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  const head = `[${turn.number}] ${speakerLabel(record, turn.speaker)}${meta ? ` (${meta})` : ''}:`
  const note = turn.note?.trim() ? `\n    (user's note: ${turn.note.trim()})` : ''
  return `${head} ${turn.text.trim()}${note}`
}

// There is deliberately no `formatTranscript` joining these into one string. The
// prompt is the only consumer and it needs them as separate blocks; a
// convenience wrapper would be a second rendering of the same thing, free to
// drift from the one that actually ships.

const ME_PREFIXES = ['me', 'i', 'self', 'you', 'user']
const THEM_PREFIXES = ['them', 'they', 'her', 'him', 'she', 'he', 'date', 'match']

// `Speaker [timestamp]: text` — the timestamp is the same free-form string the
// manual composer's "when" field takes ("Tue 9pm", "next morning", whatever),
// just bracketed so the parser can tell it apart from the label. Optional:
// `Speaker: text` still works exactly as before.
const LINE_PATTERN = /^([^:\n[]{1,30}?)\s*(?:\[([^\]]*)\])?\s*:\s*(.*)$/

// One normalisation, used for both the labels we recognise and the label read
// off a line, so the two can't drift apart. Three deliberate rules:
//   - accents fold, so a profile saying "María" still matches a log that says
//     "Maria:";
//   - apostrophes close up rather than split, keeping "O'Brien" one part;
//   - every other separator becomes a space, so "Mary-Jane" is two parts.
// `\p{L}` rather than `a-z`: a name in any script has to survive this, or a
// log labelled with it parses as zero turns.
const asLabel = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Parse a pasted chat log into turns. Handles `Name: text` lines with the
 * common label variants plus the date's own name, and an optional bracketed
 * timestamp right after the label (`Name [Tue 9pm]: text`). Unprefixed lines
 * continue the previous turn, so multi-line texts survive. Anything before
 * the first recognised label is dropped.
 */
export function parsePastedLog(raw: string, theirName: string): Turn[] {
  // Both the whole name and each of its parts, so "Jane Doe:", "Jane:" and
  // "Doe:" all resolve to them — the UI tells the user to label lines with the
  // full name, so that has to be the one form that definitely works.
  const fullName = asLabel(theirName)
  const theirs = new Set([
    ...THEM_PREFIXES,
    ...(fullName ? [fullName, ...fullName.split(/\s+/)] : []),
  ])
  const mine = new Set(ME_PREFIXES)

  const turns: Turn[] = []
  let current: Turn | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = trimmed.match(LINE_PATTERN)
    const label = match?.[1] ? asLabel(match[1]) : undefined

    let speaker: Speaker | null = null
    if (label) {
      if (mine.has(label)) speaker = 'me'
      else if (theirs.has(label)) speaker = 'them'
    }

    if (speaker) {
      const at = match![2]?.trim()
      current = { id: crypto.randomUUID(), speaker, text: match![3]!.trim(), at: at || undefined }
      turns.push(current)
    } else if (current) {
      current.text = `${current.text}\n${trimmed}`.trim()
    }
  }

  return turns.filter((t) => t.text.length > 0)
}

/**
 * Counts the UI shows and the prompts lean on for investment symmetry. Built by
 * selecting `them` and `me` rather than by excluding the rest, so anything that
 * isn't one of the two people showing up in the conversation stays out by
 * construction — a `context` entry is the user writing something down, and a
 * `coach` entry is this app talking to itself. Neither is a turn either of them
 * took, and that includes `total`, which gates whether the counts appear at all.
 */
export function transcriptStats(record: DateRecord) {
  const them = record.turns.filter((t) => t.speaker === 'them')
  const me = record.turns.filter((t) => t.speaker === 'me')
  const words = (turns: Turn[]) =>
    turns.reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0)
  const questions = (turns: Turn[]) => turns.filter((t) => t.text.includes('?')).length
  return {
    total: them.length + me.length,
    themTurns: them.length,
    myTurns: me.length,
    themWords: words(them),
    myWords: words(me),
    themQuestions: questions(them),
    myQuestions: questions(me),
  }
}
