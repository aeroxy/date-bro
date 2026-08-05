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

/**
 * Parse a pasted chat log into turns. Handles `Name: text` lines with the
 * common label variants plus the date's own name, and an optional bracketed
 * timestamp right after the label (`Name [Tue 9pm]: text`). Unprefixed lines
 * continue the previous turn, so multi-line texts survive. Anything before
 * the first recognised label is dropped.
 */
export function parsePastedLog(raw: string, theirName: string): Turn[] {
  const theirs = new Set([
    ...THEM_PREFIXES,
    ...theirName
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  ])
  const mine = new Set(ME_PREFIXES)

  const turns: Turn[] = []
  let current: Turn | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = trimmed.match(LINE_PATTERN)
    const label = match?.[1]?.trim().toLowerCase().replace(/[^a-z\s]/g, '').trim()

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
