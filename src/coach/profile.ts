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
// only what changed. See `refs/redo-arch.md` for the reasoning, including what
// was rejected — in particular a virtual filesystem with read/grep tools, which
// buys nothing here because the whole profile is injected anyway.

import type {
  PersonContext,
  PersonJudgment,
  SelfContext,
  SelfJudgment,
} from '@/types/coach'

/**
 * One amendment, addressed by heading rather than by byte range.
 *
 * `old_string` → `new_string` is the primitive coding agents use, and it works
 * there because code is near-unique and the agent has just read the exact bytes.
 * Prose is the opposite: a profile repeats phrasing constantly (her name, "she
 * mentioned", "he said"), so a uniqueness failure is the common case rather than
 * the rare one — and markdown whitespace is exactly what a model reproduces
 * imprecisely. Addressing by heading sidesteps both, and it pushes the document
 * toward staying organised, which is the only lever we have against bloat.
 *
 * `append` is the mode that matters most: most updates are a fact *added*, and
 * string replacement handles that worst of all.
 */
export interface SectionUpdate {
  heading: string
  mode: 'replace' | 'append' | 'delete'
  /** Required unless deleting. Markdown — bullets, mostly. */
  content?: string
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

export const SELF_SECTIONS = [
  'Who you are',
  'How you come across',
  'How you write',
  'Patterns',
  'Working',
  'Costing you',
  'What they know about you',
] as const

/** ~1,500 words, quoted to the model as the point to consolidate at. */
export const PROFILE_WORD_CEILING = 1500

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
 * Ops apply in order, so a model can delete a section and recreate it in one
 * update. Both misses are forgiving on purpose: `replace`/`append` against an
 * unknown heading creates it at the end, and `delete` on one is a no-op rather
 * than an error. Failing a whole rebuild because a heading was renamed three
 * turns ago would lose the other four amendments in the same payload.
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

const MODES = new Set(['replace', 'append', 'delete'])

/**
 * The backstop for every backend. Qwen gets no schema enforcement at all, and
 * even the strict paths can return a well-typed update that means nothing —
 * `changed: true` with neither sections nor a rewrite — so the complaint has to
 * be specific enough for the model to fix on retry.
 */
export function validateProfileUpdate(value: unknown, field = 'profile'): string | null {
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

  for (const [i, op] of sections.entries()) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      return `"${field}.sections[${i}]" must be an object`
    }
    if (typeof op.heading !== 'string' || !op.heading.trim()) {
      return `"${field}.sections[${i}].heading" must be a non-empty string`
    }
    if (!MODES.has(op.mode)) {
      return `"${field}.sections[${i}].mode" must be "replace", "append" or "delete"`
    }
    if (op.mode !== 'delete' && (typeof op.content !== 'string' || !op.content.trim())) {
      return `"${field}.sections[${i}].content" is required unless mode is "delete"`
    }
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
