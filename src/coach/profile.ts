// The memory of a person, as markdown amended by section.
//
// What this replaces: a fixed JSON schema regenerated from scratch on every
// rebuild. Two things were wrong with that. A schema holds only what somebody
// anticipated — a pasted résumé had nowhere to land until `who_you_are` was
// added by hand, and the next unanticipated fact would have hit the same wall.
// And regeneration is the wrong lifecycle for memory: nobody rewrites what they
// know about a person from zero each time they think about them, and any detail
// that didn't fit a field was dropped for good.
//
// So the profile is prose the model owns the structure of, and a rebuild emits
// only what changed. Rejected on the way here: a virtual filesystem with
// read/grep tools, which buys nothing because the whole profile is injected
// anyway.

import type {
  PersonContext,
  PersonJudgment,
  SelfContext,
  SelfJudgment,
} from '@/types/coach'

/**
 * One amendment, addressed by heading — and, for `edit`, by a quoted fragment
 * inside that heading's body.
 *
 * The outer address stays the heading, for the reason it always was: a profile
 * repeats phrasing constantly (her name, "she mentioned", "he said"), so a
 * document-wide string match has a uniqueness problem that the same primitive
 * doesn't have over code, and heading addressing pushes the document toward
 * staying organised, which is the only lever we have against bloat. `append` is
 * still the mode that carries most traffic, because most updates are a fact
 * *added*.
 *
 * `edit` is the correction mode, and it exists because not having it was making
 * the documents worse. Fixing one wrong bullet used to mean `replace` on its
 * whole section: regenerating a dozen bullets from memory, where anything not
 * re-emitted was destroyed silently and without warning. Faced with that, the
 * model reliably took the lossless option instead and appended a bullet
 * correcting the earlier one — then, later, a third correcting the second. Real
 * profiles grew chains of "**Supersedes the bullet above.**", which is bloat and
 * also a document you have to read in order, holding earlier lines in your head
 * as provisional. Scoping the quote to one section is what makes it workable:
 * the ambiguity that sinks string matching across a whole document is rare
 * inside a few hundred words, and `validateProfileUpdate` turns what's left into
 * a complaint the model can act on rather than a silent hit on the wrong line.
 */
export interface SectionUpdate {
  heading: string
  mode: 'replace' | 'append' | 'delete' | 'edit'
  /**
   * Required unless deleting. Markdown — bullets, mostly. For `edit`, the text
   * that replaces `old`, or `""` to remove it.
   */
  content?: string
  /**
   * `edit` only: the exact text within the section that `content` replaces.
   * Empty for every other mode.
   */
  old?: string
}

/**
 * What a rebuild emits instead of a whole document.
 *
 * Deliberately not a discriminated union, though the semantics are one:
 * `{changed: false} | {sections} | {rewrite}`. OpenAI's strict `json_schema`
 * wants every property required and `additionalProperties: false`, which an
 * `anyOf` of three object shapes expresses badly, and Qwen sees only the prose
 * sketch anyway. So the wire shape is flat and `validateProfileUpdate` enforces
 * the exclusivity — which it would have to do regardless, since two of the three
 * backends can return anything at all.
 *
 * `{changed: false}` is a first-class answer. A rebuild after one new turn
 * usually should not touch the profile.
 */
export interface ProfileUpdate {
  changed: boolean
  sections?: SectionUpdate[]
  /** Full reorganisation. Rare, and discouraged in the prompt. */
  rewrite?: string
}

/**
 * The headings a rebuild is told to prefer. Not enforced anywhere — the model
 * owns the structure and extras are additive — but pinned so `replace` keeps
 * finding its target instead of degenerating into create-new every time the
 * model reaches for a slightly different phrasing.
 */
// "Threads to pick back up", not "Open threads". The old name sat one synonym
// away from the judgment's `open_questions`, and the model duly filled the
// section with things the *user* should find out — then, having said them,
// dropped `open_questions` from the response entirely and failed validation
// twice. These two were adjacent fields of one flat schema before phase 2, with
// contrasting descriptions to hold them apart; splitting them across a markdown
// section and a JSON field removed everything that kept them distinct. A
// section is what *she* raised and he could return to. A question is a gap in
// what he knows.
export const PERSON_SECTIONS = [
  'Who they are',
  'What they care about',
  'Right now',
  'How they talk',
  'Handle with care',
  'Threads to pick back up',
] as const

// "What you're into" is additive rather than a rename, so records written before
// it simply don't have it until their next rebuild — the same shape as any part
// added to the mind. It exists because it is the one conversational supply that
// works before a thread has any history: the next-move engine is told to open a
// new subject when an exchange has resolved, and on a young record the profile's
// open threads are empty, so without this the instruction has nothing to draw on
// but the loop already running. It is also the only material here that cannot be
// researched — what the user is mid-obsession with this month is not on a page
// anywhere.
export const SELF_SECTIONS = [
  'Who you are',
  'How you come across',
  'How you write',
  "What you're into",
  'Patterns',
  'Working',
  'Costing you',
  'What they know about you',
] as const

/** ~1,500 words, quoted to the model as the point to consolidate at. */
export const PROFILE_WORD_CEILING = 1500

/**
 * The sections that are lists of things *not* to do, and a ceiling on how many
 * rules each may hold.
 *
 * They need one and the word ceiling isn't it. A profile can sit comfortably
 * under 1,500 words while a third of it is prohibitions, and prohibitions do not
 * cost what other prose costs: every one of them is read as a live instruction on
 * every run, so they accumulate into a posture rather than into a description.
 * Measured on a real record, these two sections reached 34 bullets between them
 * and the advice went flat and errand-shaped — the model had more ways to be
 * wrong than things to say.
 *
 * Nothing enforces the number. It is quoted to the rebuild engines as the point
 * to start retiring rules at, in the same way the word ceiling is quoted as the
 * point to start consolidating.
 */
export const CONSTRAINT_SECTIONS = ['Handle with care', 'Costing you'] as const
export const CONSTRAINT_BULLET_CEILING = 8

// --- Parse and serialise ------------------------------------------------------

export interface Section {
  heading: string
  body: string
}

const HEADING = /^##\s+(.+?)\s*$/

/**
 * Case, spacing and stray punctuation fold, so "Work and Schedule", "work and
 * schedule" and "Work and schedule:" are one heading. That is the churn worth
 * defending against — a model reaching for a slightly different capitalisation
 * of a heading it wrote last time. A section genuinely *renamed* gets a new
 * section, which is the honest outcome rather than a fuzzy match onto the
 * wrong target.
 *
 * Exported for `coach/mind.ts`, which addresses the same shape of document by
 * heading and had its own near-copy of this. The two differed on punctuation,
 * so `What you've learned` and `What you’ve learned` were one section to an
 * amendment and two to the engine reading it.
 */
export const key = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Split on `## ` headings. Also used by `coach/mind.ts`, which is the same shape
 * of document — markdown a model amends by heading — so it gets the same
 * splitter rather than a second one free to drift from this.
 */
export function parseSections(markdown: string): Section[] {
  return parse(markdown).sections
}

function parse(markdown: string): { preamble: string; sections: Section[] } {
  const preamble: string[] = []
  const sections: Section[] = []
  let current: { heading: string; body: string[] } | null = null

  const close = () => {
    if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() })
  }

  for (const line of markdown.split('\n')) {
    const match = line.match(HEADING)
    if (match) {
      close()
      current = { heading: match[1]!, body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      preamble.push(line)
    }
  }
  close()
  return { preamble: preamble.join('\n').trim(), sections }
}

function serialise(preamble: string, sections: Section[]): string {
  return [preamble, ...sections.map((s) => `## ${s.heading}\n\n${s.body}`.trim())]
    .filter(Boolean)
    .join('\n\n')
}

// --- Apply --------------------------------------------------------------------

/**
 * Where `old` sits inside a section body, or why it doesn't sit there exactly
 * once.
 *
 * Exact match first. The single fallback compares line by line with each line's
 * outer whitespace ignored, which covers the one difference a model reliably
 * introduces when quoting markdown back — indentation it normalised on the way
 * through. Nothing else is attempted on purpose. Every other way a quote can be
 * wrong (a changed word, a dropped clause, a summarised bullet) is a quote of
 * text that isn't there, and guessing which nearby line was probably meant is
 * how the wrong bullet gets rewritten.
 */
type Located = { start: number; end: number } | 'missing' | 'ambiguous'

function locate(body: string, old: string): Located {
  const first = body.indexOf(old)
  if (first >= 0) {
    return body.indexOf(old, first + old.length) >= 0
      ? 'ambiguous'
      : { start: first, end: first + old.length }
  }

  const lines = body.split('\n')
  const needle = old.split('\n').map((line) => line.trim())
  while (needle.length && !needle[needle.length - 1]) needle.pop()
  while (needle.length && !needle[0]) needle.shift()
  if (!needle.length) return 'missing'

  // Start offset of every line, so a matched window of lines maps back onto the
  // body it was found in.
  const offsets: number[] = []
  let at = 0
  for (const line of lines) {
    offsets.push(at)
    at += line.length + 1
  }

  let hit: { start: number; end: number } | null = null
  for (let i = 0; i + needle.length <= lines.length; i++) {
    if (needle.some((want, j) => lines[i + j]!.trim() !== want)) continue
    if (hit) return 'ambiguous'
    const last = i + needle.length - 1
    hit = { start: offsets[i]!, end: offsets[last]! + lines[last]!.length }
  }
  return hit ?? 'missing'
}

/**
 * Ops apply in order, so a model can delete a section and recreate it in one
 * update. Every miss is forgiving on purpose: `replace`/`append` against an
 * unknown heading creates it at the end, `delete` on one is a no-op rather than
 * an error, and an `edit` whose quote no longer fits is dropped on its own.
 * Failing a whole rebuild because a heading was renamed three turns ago would
 * lose the other four amendments in the same payload.
 */
export function applyProfileUpdate(markdown: string, update: ProfileUpdate): string {
  if (!update.changed) return markdown
  const rewrite = update.rewrite?.trim()
  if (rewrite) return rewrite

  const { preamble, sections } = parse(markdown)
  for (const op of update.sections ?? []) {
    const at = sections.findIndex((s) => key(s.heading) === key(op.heading))

    if (op.mode === 'delete') {
      if (at >= 0) sections.splice(at, 1)
      continue
    }

    if (op.mode === 'edit') {
      // An empty `content` is a real answer here: it removes the text quoted in
      // `old`. That is the other half of collapsing a correction — one edit
      // fixes the bullet that was wrong, a second drops the bullet that was
      // added to correct it — and without it the only way to shed a line is
      // `replace` on its whole section, which is the lossy op this mode exists
      // to avoid. An *absent* content field is not the same answer, and is
      // skipped rather than read as a deletion.
      if (typeof op.content !== 'string') continue

      // A quote that no longer fits is dropped rather than repaired. It should
      // be unreachable from a rebuild, where `validateProfileUpdate` checked the
      // quote against this exact document — but the other writers apply to a
      // document they didn't validate against. The coach's own amendment lands
      // on a fresh read of the mind taken after the run. Losing the one op that
      // stopped fitting beats losing the payload it arrived in, and beats
      // rewriting whichever text happened to be nearest.
      const existing = at >= 0 ? sections[at]! : null
      if (!existing) continue
      const found = locate(existing.body, op.old ?? '')
      if (typeof found === 'string') continue

      const replacement = op.content.trim()
      let { start, end } = found
      // A quote of whole lines plausibly carries the newline that ends the last
      // one — the model is asked to copy the text exactly, and that is what
      // exact looks like. Matched, it was spliced over, and since `content` is
      // trimmed the replacement welded itself onto the following line:
      // `- One\n- Two\n` → `- Merged` left `- Merged- Three`. Shrink the match
      // back to the text it quoted and let the document's own separators stand.
      // The line-by-line fallback already ends its match at the last line's
      // last character, so this only ever bites an exact hit.
      while (end > start && existing.body[end - 1] === '\n') end -= 1
      while (start < end && existing.body[start] === '\n') start += 1
      // A removed line takes its newline with it, or the document grows a blank
      // line everywhere a bullet was dropped.
      if (!replacement) {
        if (existing.body[end] === '\n') end += 1
        else if (start > 0 && existing.body[start - 1] === '\n') start -= 1
      }
      // The document's indentation, not the quote's. `content` is trimmed and a
      // whole-line match starts where the line starts, so editing a sub-bullet
      // wrote the new text back at the top level and quietly promoted it — the
      // fallback normalises indentation away, and an exact quote that carries
      // its own indent loses it to the trim. Only when the match opens a line: a
      // quote starting mid-line leaves the indent to the left of the splice,
      // where re-adding it would double it. The first line of a multi-line
      // replacement is the one that inherits it; the rest are the model's own.
      const lineStart = start > 0 ? existing.body.lastIndexOf('\n', start - 1) + 1 : 0
      const indent =
        replacement && start === lineStart ? /^[ \t]*/.exec(existing.body.slice(lineStart))![0] : ''
      existing.body = (
        existing.body.slice(0, start) +
        indent +
        replacement +
        existing.body.slice(end)
      ).trim()
      continue
    }

    const content = op.content?.trim()
    if (!content) continue
    if (at < 0) {
      sections.push({ heading: op.heading.trim(), body: content })
      continue
    }

    const existing = sections[at]!
    if (op.mode === 'append' && existing.body) {
      // A bullet joins the list it's extending; a paragraph starts its own.
      const gap = content.startsWith('-') || content.startsWith('*') ? '\n' : '\n\n'
      existing.body = `${existing.body}${gap}${content}`
    } else {
      existing.body = content
    }
  }
  return serialise(preamble, sections)
}

// --- Validate -----------------------------------------------------------------

const MODES = new Set(['replace', 'append', 'delete', 'edit'])

/**
 * An `edit` is the one op that can be wrong in a way the document itself knows
 * about, so it is the one op worth checking against the document.
 *
 * Every complaint is phrased as an instruction rather than a diagnosis, because
 * `completeJSON` sends it back for exactly one retry: whatever it says has to be
 * repairable on first reading, and it has to leave a way out that isn't another
 * edit. The escape hatch matters more than it looks — a model that cannot get
 * the quote right twice would otherwise fail the whole rebuild, so the
 * not-found complaint names `append`/`replace` as alternatives.
 *
 * `base` is absent where the caller has no document to check against, which is
 * every structural-only test and any caller validating an update before it knows
 * what it will be applied to. The quote is then taken on trust, and
 * `applyProfileUpdate` drops it if it turns out not to fit.
 */
function validateEdit(op: SectionUpdate, base: string | undefined, at: string): string | null {
  const old = typeof op.old === 'string' ? op.old : ''
  if (!old.trim()) {
    return `"${at}.old" is required when mode is "edit" — the exact text you are replacing, quoted from that section`
  }
  if (base === undefined) return null

  const section = parse(base).sections.find((s) => key(s.heading) === key(op.heading))
  if (!section) {
    return `"${at}" edits "${op.heading}", which is not a section of the document — use "replace" to create it`
  }
  const found = locate(section.body, old)
  if (found === 'missing') {
    return `"${at}.old" is not in "${section.heading}" — quote the text you are replacing exactly as it appears there, character for character, or use "append"/"replace" instead`
  }
  if (found === 'ambiguous') {
    return `"${at}.old" appears more than once in "${section.heading}" — extend it with the surrounding text that makes it unique`
  }
  return null
}

/**
 * The backstop for every backend. Qwen gets no schema enforcement at all, and
 * even the strict paths can return a well-typed update that means nothing —
 * `changed: true` with neither sections nor a rewrite — so the complaint has to
 * be specific enough for the model to fix on retry.
 *
 * `base` is the document this update is about to be applied to, when the caller
 * has it. It buys the `edit` checks and nothing else.
 */
export function validateProfileUpdate(
  value: unknown,
  field = 'profile',
  base?: string,
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `"${field}" must be an object`
  }
  const update = value as ProfileUpdate
  if (typeof update.changed !== 'boolean') return `"${field}.changed" must be true or false`
  if (!update.changed) return null

  const sections = update.sections ?? []
  if (!Array.isArray(sections)) return `"${field}.sections" must be an array`
  const rewrite = typeof update.rewrite === 'string' ? update.rewrite.trim() : ''

  if (sections.length && rewrite) {
    return `"${field}" must carry either sections or a rewrite, not both`
  }
  if (!sections.length && !rewrite) {
    return `"${field}.changed" is true but nothing was sent — return sections, a rewrite, or changed: false`
  }

  // Ops apply in order and each one sees what the ones before it did, so the
  // checks have to walk the same document `applyProfileUpdate` will. Checking
  // every quote against the base rejected `replace` then `edit` on one section —
  // a payload that applies perfectly — which burns `completeJSON`'s single retry
  // and can throw the whole rebuild; and it passed `delete` then `edit`, which
  // then vanished on apply with nothing said to the model about why.
  let doc = base

  for (const [i, op] of sections.entries()) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      return `"${field}.sections[${i}]" must be an object`
    }
    if (typeof op.heading !== 'string' || !op.heading.trim()) {
      return `"${field}.sections[${i}].heading" must be a non-empty string`
    }
    if (!MODES.has(op.mode)) {
      // Every mode, `edit` included. Naming three of the four steered a retry
      // away from the one op that can fix a line without rewriting its section.
      return `"${field}.sections[${i}].mode" must be "replace", "append", "edit" or "delete"`
    }
    if (op.mode === 'edit') {
      // Empty is allowed and means "remove what I quoted"; absent is not, so a
      // dropped field can't read as a deletion.
      if (typeof op.content !== 'string') {
        return `"${field}.sections[${i}].content" must be a string when mode is "edit" — the replacement text, or "" to remove the text you quoted`
      }
      const err = validateEdit(op, doc, `${field}.sections[${i}]`)
      if (err) return err
    } else if (op.mode !== 'delete' && (typeof op.content !== 'string' || !op.content.trim())) {
      return `"${field}.sections[${i}].content" is required unless mode is "delete"`
    }
    if (doc !== undefined) doc = applyProfileUpdate(doc, { changed: true, sections: [op] })
  }
  return null
}

export function profileWords(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Headings renamed after profiles were already written with the old name.
 *
 * Without this the rename is not a rename at all: `applyProfileUpdate` matches
 * by heading, so an amendment aimed at the new name creates a second section and
 * the old one sits there forever holding half the content. Deterministic and
 * idempotent — a document with no legacy heading comes back byte-identical, so
 * it can run on every read next to the other migrations in `lib/db.ts`.
 */
const RENAMED: Record<string, string> = {
  'open threads': 'Threads to pick back up',
}

export function renameLegacySections(markdown: string): string {
  if (!markdown.includes('## ')) return markdown
  return markdown
    .split('\n')
    .map((line) => {
      const match = line.match(HEADING)
      const renamed = match && RENAMED[key(match[1]!)]
      return renamed ? `## ${renamed}` : line
    })
    .join('\n')
}

// --- Migration ----------------------------------------------------------------
//
// The old `PersonContext` / `SelfContext` records flatten to exactly the section
// layout above — every field had a home, which is unsurprising given the
// headings were derived from them. Rendered on read in `lib/db.ts`, so nothing
// has to be rewritten ahead of time and a record that never gets opened again
// costs nothing.

// The evidence rides along. It is the citation the new format asks for, it was
// already in the record, and a migration is the one moment it can be lost for
// good — the old shape is gone the next time the record is saved.
const claims = (list: { claim: string; confidence: string; evidence?: string }[] | undefined) =>
  (list ?? [])
    .map((c) => {
      const evidence = c.evidence?.trim()
      return `- ${c.claim} (${c.confidence})${evidence ? ` — ${evidence}` : ''}`
    })
    .join('\n')

const bullets = (list: string[] | undefined) => (list ?? []).map((s) => `- ${s}`).join('\n')

function section(heading: string, body: string): string | null {
  return body.trim() ? `## ${heading}\n\n${body.trim()}` : null
}

export function personToMarkdown(ctx: PersonContext): string {
  const style = ctx.communication_style
  const talk = [
    style?.summary,
    style?.attachment_hypothesis
      ? `Attachment — a guess, not a label: ${style.attachment_hypothesis.pattern} (${style.attachment_hypothesis.confidence}). ${style.attachment_hypothesis.evidence}`
      : '',
    style?.bids?.length ? `Bids they made:\n${bullets(style.bids)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return [
    section('Who they are', claims(ctx.who_they_are)),
    section('What they care about', claims(ctx.what_they_care_about)),
    section('Right now', claims(ctx.current_situation)),
    section('How they talk', talk),
    section('Handle with care', bullets(ctx.sensitivities)),
    section('Threads to pick back up', bullets(ctx.open_threads)),
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Every field is defaulted, because every field can be missing: these records
// were written by schemas that have since changed, and the judgment they migrate
// into is what the UI reads straight out — `interest_read.level` renders into a
// chip. A blank read is a fair description of a record this old; a thrown
// TypeError inside `listDates` takes the whole app down with it.
export function personJudgment(ctx: PersonContext): PersonJudgment {
  return {
    headline: ctx.headline ?? '',
    interest_read: ctx.interest_read ?? {
      level: 'ambiguous',
      confidence: 'low',
      signals_for: [],
      signals_against: [],
      honest_note: '',
    },
    flags: ctx.flags ?? [],
    open_questions: ctx.open_questions ?? [],
  }
}

export function selfToMarkdown(ctx: SelfContext): string {
  const voice = [
    ctx.your_voice?.summary,
    ctx.your_voice?.markers?.length ? `Markers:\n${bullets(ctx.your_voice.markers)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const patterns = (ctx.patterns ?? [])
    .map((p) => `- **${p.pattern}** — ${p.evidence} Effect: ${p.effect}`)
    .join('\n')

  return [
    section('Who you are', claims(ctx.who_you_are)),
    section('How you come across', claims(ctx.how_you_come_across)),
    section('How you write', voice),
    section('Patterns', patterns),
    section('Working', bullets(ctx.working)),
    section('Costing you', bullets(ctx.costing_you)),
    section('What they know about you', bullets(ctx.you_have_revealed)),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function selfJudgment(ctx: SelfContext): SelfJudgment {
  return {
    headline: ctx.headline ?? '',
    goal_read: ctx.goal_read ?? { stated: '', revealed: '', tension: '' },
    open_questions: ctx.open_questions ?? [],
  }
}
