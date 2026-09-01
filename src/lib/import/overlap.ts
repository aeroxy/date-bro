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
 * The text of a rendered log line, without its `Me [when]:` label.
 *
 * The colon that ends the label is *not* the first colon on the line — the
 * timestamp has one, so `Them [Sat Aug 8, 9:10pm]: hi` split on the first colon
 * leaves `10pm]: hi` behind, and a fragment like that turns an exact match into
 * a near one. The bracket is matched as a unit instead.
 */
function body(line: string): string {
  return line.replace(/^[^[\]:]{0,40}(\[[^\]]*\]\s*)?:\s*/, '')
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
  if (line.includes(turn) || turn.includes(line)) return 0.95
  const words = new Set(line.split(' '))
  const wanted = turn.split(' ')
  const shared = wanted.filter((w) => words.has(w)).length
  return shared / Math.max(words.size, wanted.length)
}

/** Below this, a "match" is two messages that happen to share a few words. */
const FLOOR = 0.6

/**
 * A recorded turn shorter than this is skipped: "ok" and "haha" match half a
 * conversation, and the seam they point at would be somewhere arbitrary.
 */
const TOO_SHORT = 6

export function findOverlap(log: string, turns: Turn[]): Overlap | null {
  const lines = log.split('\n')
  if (!log.trim() || lines.length < 2) return null

  // Only what two people actually said: a NOTE is something nobody typed into
  // the conversation, and a COACH line is this app talking about it, so neither
  // can appear in a log fetched from the source.
  const said = turns.filter((t) => t.speaker === 'me' || t.speaker === 'them')
  // Newest first, and only the tail. Walking the whole history would let an
  // early "where are you from" win over the actual seam.
  const recent = said.slice(-8).reverse()

  const shaped = lines.map((l) => shape(body(l)))

  for (const [back, turn] of recent.entries()) {
    const wanted = shape(turn.text)
    if (wanted.length < TOO_SHORT) continue
    let bestLine = -1
    let best = 0
    // Last wins a tie: the same thing said twice is most usefully anchored at
    // its later occurrence, which is the one nearer the seam.
    shaped.forEach((line, i) => {
      const s = score(line, wanted)
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
      fresh: lines.length - bestLine - 1,
      score: best,
      back,
    }
  }
  return null
}
