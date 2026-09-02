import { logLineReader } from '@/lib/transcript'
import type { Turn } from '@/types/date'

/**
 * Where a freshly fetched log stops being new.
 *
 * An import is almost always the same conversation continued, so most of what
 * comes back is already in the record. Finding the seam is what lets someone see
 * what they are about to add twice — and it cannot be done by string equality,
 * because the two sides were written by different hands: the turns already
 * recorded may have been typed or hand-pasted, while the fetched line carries
 * the render's own asides (`[photo]`, `[re: …]`, a `~` stamp) and whatever
 * wording the person actually used. So this matches on shape, reports how well,
 * and leaves the decision to the reader.
 *
 * Lives here rather than in the modal because it is the only part of that modal
 * with an answer that can be wrong, which makes it the part worth testing.
 */

export type Overlap = {
  /** 0-based line in the log that matches a turn already recorded. */
  line: number
  /** Character offset of that line's start, for selecting it. */
  start: number
  /** Length of that line. */
  length: number
  /** How many lines sit below it. */
  fresh: number
  /** 1 for a clean match, lower for a resemblance. */
  score: number
  /** How far back from the last recorded turn the match was found. */
  back: number
}

/**
 * Punctuation, case, and the bracketed asides only one side ever has, removed.
 * A timestamp is bracketed too, which is the point — `Me [Sat 9pm]: hey` and a
 * hand-typed `hey` have to come out the same.
 */
function shape(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 1 when identical, 0.95 when one contains the other — a fetched line often
 * carries a caption or a reaction the typed one didn't — and otherwise the
 * share of the recorded turn's words present in the line. Word overlap rather
 * than edit distance because the differences that matter here are whole words
 * added or dropped, not characters transposed.
 */
function score(line: string, turn: string): number {
  if (!line || !turn) return 0
  if (line === turn) return 1
  // Containment only counts when the contained side is itself substantial: a
  // turn that mentions "no" once contains every one-word line saying "no", and
  // that is two people saying a common word, not a seam. `turn` is already past
  // TOO_SHORT by the time it gets here; the line has to clear the same bar.
  if (line.includes(turn) || (line.length >= TOO_SHORT && turn.includes(line))) return 0.95
  // Distinct words on both sides. Counting the turn's words with repeats let
  // "no no no no" score four hits against a line that says "no" once — a full
  // match to an unrelated message, made of one word said with feeling.
  const words = new Set(line.split(' '))
  const wanted = new Set(turn.split(' '))
  let shared = 0
  for (const w of wanted) if (words.has(w)) shared++
  return shared / Math.max(words.size, wanted.size)
}

/** Below this, a "match" is two messages that happen to share a few words. */
const FLOOR = 0.6

/**
 * A recorded turn shorter than this is skipped: "ok" and "haha" match half a
 * conversation, and the seam they point at would be somewhere arbitrary.
 */
const TOO_SHORT = 6

/**
 * And one with fewer distinct words than this, however long: "no no no no" is
 * eleven characters of a single word, and a single word is not a fingerprint.
 */
const TOO_FEW_WORDS = 2

export function findOverlap(log: string, turns: Turn[], theirName: string): Overlap | null {
  const lines = log.split('\n')
  // A single-line log is allowed to be all overlap: fetching the last message
  // and finding it already recorded is worth saying, since appending it is
  // exactly the duplicate this banner exists to prevent.
  if (!log.trim()) return null

  // Only what two people actually said: a NOTE is something nobody typed into
  // the conversation, and a COACH line is this app talking about it, so neither
  // can appear in a log fetched from the source.
  const said = turns.filter((t) => t.speaker === 'me' || t.speaker === 'them')
  // Newest first, and only the tail. Walking the whole history would let an
  // early "where are you from" win over the actual seam.
  const recent = said.slice(-8).reverse()

  // Each line as its speaker and its shaped text, read the same way
  // `parsePastedLog` reads it — so an unlabelled continuation line is not a
  // candidate seam, and the label is stripped by the parser that knows a
  // timestamp's colon from the label's.
  const read = logLineReader(theirName)
  const candidates = lines.map((l) => {
    const parsed = read(l)
    return parsed ? { speaker: parsed.speaker, shaped: shape(parsed.text) } : null
  })

  for (const [back, turn] of recent.entries()) {
    const wanted = shape(turn.text)
    if (wanted.length < TOO_SHORT) continue
    if (new Set(wanted.split(' ')).size < TOO_FEW_WORDS) continue
    let bestLine = -1
    let best = 0
    // Last wins a tie: the same thing said twice is most usefully anchored at
    // its later occurrence, which is the one nearer the seam.
    candidates.forEach((candidate, i) => {
      // The same words from the other person are a different message. Both
      // sides say "see you tomorrow", and without this the seam could land on
      // whichever of them scored first — attributing the boundary to a turn
      // that was never the one recorded.
      if (!candidate || candidate.speaker !== turn.speaker) return
      const s = score(candidate.shaped, wanted)
      if (s >= best) {
        best = s
        bestLine = i
      }
    })
    if (best < FLOOR || bestLine < 0) continue

    let start = 0
    for (let i = 0; i < bestLine; i++) start += lines[i]!.length + 1
    return {
      line: bestLine,
      start,
      length: lines[bestLine]!.length,
      // Only lines with something on them: a hand-pasted log often separates
      // messages with blank lines, and "the 12 below are new" over 6 messages
      // is a count nobody can check against the box.
      fresh: lines.slice(bestLine + 1).filter((l) => l.trim()).length,
      score: best,
      back,
    }
  }
  return null
}
