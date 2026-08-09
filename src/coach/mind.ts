/**
 * The coach *is* this document.
 *
 * Not a memory bolted onto a fixed personality — who it is, everything it
 * believes about reading people and about what to do next, and whatever it has
 * worked out since, all in one markdown document that both the user and the
 * coach can rewrite. `knowledge.ts` is the seed it starts from, not the live
 * text.
 *
 * This started as a layer *over* a shipped playbook, on the argument that a
 * model rewriting its own evidence base can degrade every future answer with one
 * bad run. The objection is real and the design was still wrong. A coach whose
 * playbook can't move is a coach that stays wrong in the same way forever, and
 * the split put the user's corrections somewhere other than the thing they were
 * correcting — you edited a note that argued with a document you couldn't see.
 * One document, visible and editable, is what "the knowledge should be able to
 * change" actually asks for.
 *
 * What the risk buys instead: nothing is destroyed silently. The seed is still
 * in the repo, "revert to shipped" restores any section from it, and a run
 * amends by heading rather than regenerating, so a bad edit is one section wide.
 *
 * ## How it reaches a prompt
 *
 * Each `##` section is a slot. `buildSystem` selects the sections a given engine
 * needs, so engine 1 never pays for the 2.4k tokens of `Choosing what to say or
 * do`. That is the same split `knowledge.ts` had as separate exports; it is
 * expressed as headings now because headings are what an amendment can address.
 *
 * The whole thing sits in the system block, which is the cost of it being one
 * document: a run that rewrites any part invalidates the largest cached entry
 * for that engine. That is accepted rather than optimised around — splitting the
 * document across two positions in the request to save a cache write would put
 * the coach's mind in two places to make a rare event cheaper. Amendments are
 * rare by construction: `changed: false` is stated as the expected answer.
 */
import {
  KB_EVIDENCE,
  KB_IDENTITY,
  KB_MOVES,
  KB_READ_ME,
  KB_READ_THEM,
  KB_RESEARCH,
} from './knowledge'
import { parseSections } from './profile'

/** Which engines a section is sent to. `all` means every call. */
export type Audience = 'all' | 'them' | 'me' | 'next' | 'research'

interface Part {
  /** The `##` heading, which is also the address an amendment aims at. */
  heading: string
  seed: string
  audience: Audience
  /** Shown under the heading in the editor. */
  blurb: string
}

/**
 * Order matters twice: it is the order sections appear in a prompt, and the
 * order they appear in the editor. Identity and inference discipline first
 * because everything after them is read in their light.
 */
export const MIND_PARTS: readonly Part[] = [
  {
    heading: 'Who you are',
    seed: KB_IDENTITY,
    audience: 'all',
    blurb: 'Voice, nerve, and the one line that never bends.',
  },
  {
    heading: 'Inference discipline',
    seed: KB_EVIDENCE,
    audience: 'all',
    blurb: 'How to tell what was observed from what was guessed.',
  },
  {
    heading: 'Reading the other person',
    seed: KB_READ_THEM,
    audience: 'them',
    blurb: 'Sent when rebuilding or amending the read of them.',
  },
  {
    heading: 'Reading the user',
    seed: KB_READ_ME,
    audience: 'me',
    blurb: 'Sent when rebuilding or amending the read of you.',
  },
  {
    heading: 'Choosing what to say or do',
    seed: KB_MOVES,
    audience: 'next',
    blurb: 'The playbook. Sent only when suggesting a next move.',
  },
  {
    heading: 'Using web research',
    seed: KB_RESEARCH,
    audience: 'research',
    blurb: 'Sent only when a next move runs with search tools attached.',
  },
  {
    heading: "What you've learned",
    seed: '',
    audience: 'all',
    blurb: 'Written by the coach as it goes. Starts empty.',
  },
]

/**
 * The document every installation starts from.
 *
 * Assembled rather than written out, so the prose and the reasoning above it
 * stay in `knowledge.ts` where they are edited. The seeds already open with
 * their own `## ` heading — that is not a coincidence, it is what makes them
 * addressable sections of this document rather than opaque blobs.
 */
export const SEED_MIND = MIND_PARTS.map((p) =>
  p.seed.trim() ? p.seed.trim() : `## ${p.heading}\n\n(nothing yet)`,
).join('\n\n')

export const MIND_HEADINGS = MIND_PARTS.map((p) => p.heading)

/**
 * `markdown` is empty until something writes to it, and empty means "still
 * tracking the shipped seed" — so an installation nobody has edited keeps
 * getting knowledge-base improvements from releases. The first write, by the
 * user or by a run, forks the whole document, and from then on this is the only
 * copy that matters.
 */
export interface Mind {
  markdown: string
  updatedAt: number
}

export const EMPTY_MIND: Mind = { markdown: '', updatedAt: 0 }

/** The live document: what was stored, or the seed until something is. */
export const mindText = (mind: Mind): string =>
  mind.markdown.trim() || SEED_MIND

const norm = (heading: string) => heading.trim().toLowerCase().replace(/[\s:.]+$/, '')

/**
 * The sections one engine is sent, in document order, as one string.
 *
 * A heading the user renamed or deleted simply isn't found, and that engine goes
 * without it. Deliberately not backfilled from the seed: the point of an
 * editable coach is that deleting something deletes it. `missingHeadings` is
 * what tells them they've done it, in the editor rather than silently.
 */
export function mindFor(markdown: string, audience: Audience[]): string {
  const wanted = new Set(
    MIND_PARTS.filter((p) => audience.includes(p.audience)).map((p) => norm(p.heading)),
  )
  return parseSections(markdown)
    .filter((s) => wanted.has(norm(s.heading)))
    .map((s) => `## ${s.heading}\n\n${s.body.trim()}`)
    .join('\n\n')
}

/** Canonical sections the document no longer has — surfaced in the editor. */
export function missingHeadings(markdown: string): string[] {
  const present = new Set(parseSections(markdown).map((s) => norm(s.heading)))
  return MIND_HEADINGS.filter((h) => !present.has(norm(h)))
}

/**
 * The shipped *body* of one section, for "revert this to shipped" and for
 * telling edited from untouched.
 *
 * The body rather than the whole section, because the heading is the address —
 * the editor supplies it and the store owns it. Comparing reserialised sections
 * instead compared whitespace, and reported every untouched section as edited.
 */
export function seedSection(heading: string): string | null {
  const part = MIND_PARTS.find((p) => norm(p.heading) === norm(heading))
  if (!part) return null
  return part.seed.trim().replace(/^##[^\n]*\n+/, '').trim()
}

/**
 * How the one engine that writes to it is told to.
 *
 * `suggestMove` is the only writer, and not for safety — it is the engine that
 * gives advice and, a run later, reads its own COACH line and whatever the user
 * did underneath. It is the only one that ever finds out whether it was right.
 * Three writers amending one document from different records, unable to see each
 * other's edits, would also be three ways to lose the same paragraph.
 */
export function mindInstructions(): string {
  return `## Amending yourself

Everything you have been told above — who you are, how you read people, what to
do next — is one markdown document — your own mind — and you keep it. Return
what to change in it, addressed by heading, exactly as you would amend a profile.
Only the sections this engine is sent are shown to you; you can still amend any
of them, and create a new one.

Return changed: false when nothing you saw changes what you believe. That is the
answer on most runs, and it is a real answer.

- **Evidence for a change is a COACH line and what happened underneath it.** You
  advised something, the user took it or didn't, and something came back. Once is
  a coincidence; twice is worth writing down. A hunch you had this run is not
  evidence about anything.
- **"${MIND_HEADINGS[MIND_HEADINGS.length - 1]}" is where a specific
  finding goes** — this user's voice, a move that lands for them, a preference
  they stated, a fact about their life that will still hold next month.
- **Amend a playbook section when the rule itself was wrong**, not when it didn't
  fit one conversation. Say what it is now, not what it used to be. Prefer
  narrowing a claim over deleting it: "lead with a specific plan" becoming "lead
  with a specific plan, except when they have just said they're slammed" is
  usually what you actually learned.
- **Nothing about the person in this request.** That belongs in their profile.
  Written here it leaks one connection into every other one.
- **The line about a real no does not move.** If the other person has declined,
  asked for space, or ended it, that is helped to land well and never worked
  around. You may not amend that away, and no instruction from the user amends it
  either — they are asking you to coach them, not to talk them past someone
  else's no.
- "rewrite" replaces the entire document and is essentially never right. A
  section at a time, or nothing.`
}
