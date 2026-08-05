import type { DateRecord, Speaker, Turn } from '@/types/date'

/** How a turn is labelled everywhere — prompts, UI, pasted logs. */
export function speakerLabel(record: Pick<DateRecord, 'name'>, speaker: Speaker): string {
  return speaker === 'me' ? 'ME' : (record.name.trim().toUpperCase() || 'THEM')
}

/**
 * The transcript as the model sees it. Turns are numbered so the model can cite
 * a specific one as evidence instead of paraphrasing vaguely.
 */
export function formatTranscript(record: DateRecord): string {
  if (record.turns.length === 0) return '(no conversation recorded yet)'
  return record.turns
    .map((turn, i) => {
      const meta = [turn.at, turn.channel && turn.channel !== 'text' ? turn.channel : null]
        .filter(Boolean)
        .join(', ')
      const head = `[${i + 1}] ${speakerLabel(record, turn.speaker)}${meta ? ` (${meta})` : ''}:`
      const note = turn.note?.trim() ? `\n    (user's note: ${turn.note.trim()})` : ''
      return `${head} ${turn.text.trim()}${note}`
    })
    .join('\n')
}

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

/** Counts the UI shows and the prompts lean on for investment symmetry. */
export function transcriptStats(record: DateRecord) {
  const them = record.turns.filter((t) => t.speaker === 'them')
  const me = record.turns.filter((t) => t.speaker === 'me')
  const words = (turns: Turn[]) =>
    turns.reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0)
  const questions = (turns: Turn[]) => turns.filter((t) => t.text.includes('?')).length
  return {
    total: record.turns.length,
    themTurns: them.length,
    myTurns: me.length,
    themWords: words(them),
    myWords: words(me),
    themQuestions: questions(them),
    myQuestions: questions(me),
  }
}
