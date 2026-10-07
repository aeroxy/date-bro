import type { DateRecord, Turn } from '@/types/date'

/**
 * A string with one stretch of it marked, already cut for display — so the rail
 * renders three strings and never handles an offset.
 */
export interface Marked {
  before: string
  match: string
  after: string
}

/** One person the rail's search turned up, and why. */
export interface SearchHit {
  record: DateRecord
  /** Their name with the query marked, when that's where it is. */
  name?: Marked
  /**
   * When the conversation has it: the newest turn that does, cut to one line for
   * the row, and how many turns do. Newest because "the one who mentioned the gig"
   * nearly always means lately, and because this is the turn a click opens the
   * conversation at.
   */
  turn?: { id: string; line: Marked; count: number }
}

/**
 * Case and accents fold, so "jose" finds "José": nobody types the accent into a
 * search box, and a name is where it goes missing most. `asLabel` in
 * `transcript.ts` folds a log's speaker labels the same way, for the same reason.
 *
 * The sigma is the one letter `toLowerCase` maps by context — a capital at the end
 * of a word becomes `ς`, anywhere else `σ` — so a whole string and the same string
 * folded a character at a time, which is how `locate` has to do it, would disagree
 * about whether "ΟΔΟΣ" contains "οδος". Both engines that run this (V8 in the
 * extension, JavaScriptCore under `bun test`) do it.
 */
const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ς/g, 'σ')

/**
 * The parts of a turn the conversation shows as words: what was said, the user's
 * own note on it, and the question a NOTE answers.
 */
const wordsOf = (t: Turn) => [t.text, t.note, t.asked]

/**
 * Where `needle` (already folded) first falls in `text`, as offsets into `text`.
 *
 * Folding changes lengths — an "é" typed as one code point folds from one unit,
 * typed as "e" plus a combining accent from two, and a Hangul syllable decomposes
 * into three — so an index into the folded copy is not an index into the
 * original, and a mark cut with one lands on the wrong letters. Each folded unit
 * remembers the character it came from instead.
 */
function locate(text: string, needle: string): { start: number; end: number } | null {
  let folded = ''
  const from: number[] = []
  const to: number[] = []
  let i = 0
  for (const ch of text) {
    const f = fold(ch)
    // A combining mark on its own folds to nothing. It belongs to the letter
    // before it, so a match ending on that letter takes the accent with it.
    if (!f && to.length) to[to.length - 1] = i + ch.length
    for (let k = 0; k < f.length; k++) {
      from.push(i)
      to.push(i + ch.length)
    }
    folded += f
    i += ch.length
  }
  const at = folded.indexOf(needle)
  return at < 0 ? null : { start: from[at], end: to[at + needle.length - 1] }
}

/** How much of a line is kept ahead of the match, in Latin letters — see `cut`. */
const LEAD = 12

/**
 * Characters about twice as wide as a Latin letter, which spend the lead twice as
 * fast. RED conversations are mostly Chinese, and twelve characters of one ahead
 * of a match pushed the match to the edge of the row.
 */
const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}　-〿！-｠]/u

/**
 * A line cut around its match for a row that truncates on the right. Everything
 * far ahead of the match pushes it out of view, so only a little leads into it —
 * from the start of a word, when the lead has one — and what follows is left for
 * the row to cut. Walked by character rather than code unit, so the cut can't
 * split an emoji in half.
 */
function cut(text: string, { start, end }: { start: number; end: number }): Marked {
  const lead = Array.from(text.slice(0, start))
  let from = lead.length
  for (let width = 0; from > 0; from--) {
    width += WIDE.test(lead[from - 1]) ? 2 : 1
    if (width > LEAD) break
  }
  let before = lead.slice(from).join('')
  if (from > 0) {
    const word = before.search(/\s\S/)
    before = '…' + (word < 0 ? before : before.slice(word + 1))
  }
  // More than any row shows; the rest would only be DOM to lay out and hide.
  return { before, match: text.slice(start, end), after: text.slice(end, end + 200) }
}

/**
 * Everyone whose name or conversation contains `query`, in the order given — the
 * rail's newest-updated-first, which a search has no reason to reshuffle. A
 * phrase, not a set of words, as in the browser's own find. A blank query
 * matches no one: the rail shows everyone without asking.
 */
export function searchDates(dates: DateRecord[], query: string): SearchHit[] {
  const needle = fold(query.trim())
  if (!needle) return []
  const has = (s: string | undefined) => !!s && fold(s).includes(needle)
  const hits: SearchHit[] = []
  for (const record of dates) {
    const inName = locate(record.name, needle)
    const turns = record.turns.filter((t) => wordsOf(t).some(has))
    if (!inName && !turns.length) continue
    const newest = turns.at(-1)
    const words = newest && wordsOf(newest).find(has)
    const at = words ? locate(words, needle) : null
    hits.push({
      record,
      name: inName ? cut(record.name, inName) : undefined,
      turn: newest && words && at ? { id: newest.id, line: cut(words, at), count: turns.length } : undefined,
    })
  }
  return hits
}
