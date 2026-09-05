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
 * Shaped text, and its distinct words once anything has asked for them.
 *
 * `score` is called once per (line, turn) pair, so building the word sets in
 * there rebuilt each line's set once per candidate turn — and the turn's own
 * set once per *line*, which was the larger waste of the two. Hanging them off
 * the shaped text instead makes each one at most once.
 *
 * Cached on demand rather than eagerly, because most pairs never reach the word
 * path: an exact or containment match answers first, and on a log fetched from
 * the source the seam is usually the very first turn tried. Building 40k sets
 * up front to serve the rare fallback measured slower than the code this
 * replaced.
 */
type Shaped = { text: string; words?: Set<string> }

/**
 * `split(' ')` is a Latin assumption. Chinese, Japanese and Thai are written
 * without spaces between words, so a message in one of them was a single "word"
 * however long it ran — and the distinct-word gate below then threw out every
 * turn in a Chinese conversation *except* those that happened to contain a
 * comma, since `shape` turns punctuation into a space. That made the gate a
 * test of punctuation rather than of content, and left the seam anchored on
 * whichever older turn had one. `Intl.Segmenter` knows where words actually
 * begin; the split stays as the fallback for a runtime without it.
 */
const SEGMENTER =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

const wordsOf = (s: Shaped): Set<string> =>
  (s.words ??= new Set(
    SEGMENTER
      ? Array.from(SEGMENTER.segment(s.text))
          .filter((part) => part.isWordLike)
          .map((part) => part.segment)
      : s.text.split(' ').filter(Boolean),
  ))

/**
 * Punctuation, case, and the bracketed asides only one side ever has, removed.
 * A timestamp is bracketed too, which is the point — `Me [Sat 9pm]: hey` and a
 * hand-typed `hey` have to come out the same.
 */
function shape(text: string): Shaped {
  return {
    text: text
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }
}

/**
 * 1 when identical, 0.95 when one contains the other — a fetched line often
 * carries a caption or a reaction the typed one didn't — and otherwise the
 * share of the recorded turn's words present in the line. Word overlap rather
 * than edit distance because the differences that matter here are whole words
 * added or dropped, not characters transposed.
 */
function score(line: Shaped, turn: Shaped): number {
  if (!line.text || !turn.text) return 0
  if (line.text === turn.text) return 1
  // Containment only counts when the contained side is itself substantial: a
  // turn that mentions "no" once contains every one-word line saying "no", and
  // that is two people saying a common word, not a seam. `turn` is already past
  // TOO_SHORT by the time it gets here; the line has to clear the same bar.
  if (line.text.includes(turn.text) || (line.text.length >= TOO_SHORT && turn.text.includes(line.text)))
    return 0.95
  // Distinct words on both sides. Counting the turn's words with repeats let
  // "no no no no" score four hits against a line that says "no" once — a full
  // match to an unrelated message, made of one word said with feeling.
  const words = wordsOf(line)
  const wanted = wordsOf(turn)
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

/**
 * How many candidate lines past an anchored one to search for the next turn's
 * confirmation. Two people's messages interleave, and a log can carry a message
 * the record never got, so this is deliberately more than one — and small, for
 * the reason in the walk below.
 */
const CONFIRM_WINDOW = 4

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
    if (wanted.text.length < TOO_SHORT) continue
    if (wordsOf(wanted).size < TOO_FEW_WORDS) continue
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

    // Position is evidence that the text alone can't supply. The gates above
    // exist to stop a weak turn *anchoring* the seam — but once an anchor
    // holds, the turns after it can be checked against the lines after it, and
    // a trailing "因为", far too short and too common to anchor anything, is
    // recognised as recorded because it sits exactly where the record says.
    // Without this the seam stopped at the newest turn that could carry itself,
    // marking everything since as new: on a real Chinese thread that was five
    // turns and six lines early.
    let seam = bestLine
    let worst = best
    let reached = back
    for (let k = back - 1; k >= 0; k--) {
      const next = recent[k]!
      const wantedNext = shape(next.text)
      if (!wantedNext.text) break
      let hit = -1
      let hitScore = 0
      // A small window, not the rest of the log: the record and the log run in
      // the same order, so the turn after an anchored one is a line or two
      // below it. Searching further would let an unrelated later line pass for
      // a confirmation and drag the seam past messages that really are new.
      let looked = 0
      for (let i = seam + 1; i < candidates.length && looked < CONFIRM_WINDOW; i++) {
        const candidate = candidates[i]
        if (!candidate) continue
        looked++
        if (candidate.speaker !== next.speaker) continue
        const s = score(candidate.shaped, wantedNext)
        if (s >= FLOOR) {
          hit = i
          hitScore = s
          break
        }
      }
      if (hit < 0) break
      seam = hit
      // The weakest link decides how the banner is worded: one fuzzy step makes
      // the whole run a resemblance rather than a fact.
      worst = Math.min(worst, hitScore)
      reached = k
    }

    let start = 0
    for (let i = 0; i < seam; i++) start += lines[i]!.length + 1
    return {
      line: seam,
      start,
      length: lines[seam]!.length,
      // Only lines with something on them: a hand-pasted log often separates
      // messages with blank lines, and "the 12 below are new" over 6 messages
      // is a count nobody can check against the box.
      fresh: lines.slice(seam + 1).filter((l) => l.trim()).length,
      score: worst,
      back: reached,
    }
  }
  return null
}
