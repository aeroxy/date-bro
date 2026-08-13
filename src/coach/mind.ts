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
 * The section is the unit of divergence too, not just of damage. Forking used to
 * be per document — the first write anywhere froze all six sections against
 * every future release, so picking up one improved paragraph meant discarding
 * everything the user and the coach had written. `Mind.forked` narrows that to
 * the headings actually rewritten; `mindText` refreshes the rest from the seed
 * on every read. Editing "Reading the user" says nothing about the research
 * section, and now it no longer freezes it.
 *
 * ## How it reaches a prompt
 *
 * Each `##` section is a slot. `buildSystem` selects the sections a given engine
 * needs, so engine 1 never pays for the 2.4k tokens of `Choosing what to say or
 * do`. That is the same split `knowledge.ts` had as separate exports; it is
 * expressed as headings now because headings are what an amendment can address.
 *
 * The belief sections sit in the system block. "What you've learned" rides below
 * the transcript instead (`audience: 'tail'`) — a reversal this comment used to
 * argue against, on the grounds that splitting the document across two positions
 * put the coach's mind in two places to make a rare event cheaper. Measurement
 * won the argument (refs/raw1 → raw2): the learned section is where amendments
 * land *by design*, the system block sits above the profile and the whole
 * transcript, and one ~250-char amendment between two next-move runs re-wrote
 * ~47k of ~49k cached tokens. The belief sections stay above because amending
 * one means a rule actually changed — rare, `changed: false` is stated as the
 * expected answer — and that price keeps everything the engines *reason from*
 * in one place.
 */
import {
  KB_EVIDENCE,
  KB_IDENTITY,
  KB_MOVES,
  KB_READ_ME,
  KB_READ_THEM,
  KB_RESEARCH,
} from './knowledge'
import { key, parseSections } from './profile'

/**
 * Which engines a section is sent to. `all` means every call. `tail` also means
 * every call, but delivered below the transcript rather than in the system
 * block — the slot for the section the coach itself rewrites, so amending it
 * leaves the cached strata above byte-identical. `learnedText` is how it
 * travels.
 *
 * `mindFor` drops 'tail' parts outright rather than trusting that no engine asks
 * for one. Asking is a single word in an audience list, it type-checks, and what
 * it buys is the ~47k-token regression the split exists to prevent — silently,
 * since the only visible effect is the bill.
 */
export type Audience = 'all' | 'them' | 'me' | 'next' | 'research' | 'tail'

interface Part {
  /**
   * The `##` heading, which is also the address an amendment aims at — in the
   * seed *and* in every document already forked from it. So renaming one here
   * doesn't rename anything: the engines stop finding their section in the
   * documents that still say the old name, and `missingHeadings` reports it
   * deleted. There is no rename table for this document the way `profile.ts`
   * keeps one for profiles. Treat a shipped heading as fixed; add a part instead.
   */
  heading: string
  seed: string
  audience: Audience
  /** Shown under the heading in the editor. */
  blurb: string
}

/**
 * Where a finding about this particular user goes. Named rather than read off
 * the end of `MIND_HEADINGS`, which is how `mindInstructions` used to address it
 * — appending a part below this one silently re-aimed the instruction at
 * whatever had landed last.
 */
export const LEARNED_HEADING = "What you've learned"

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
    blurb: 'Voice, nerve, and the one line that never bends. Sent on every call.',
  },
  {
    heading: 'Inference discipline',
    seed: KB_EVIDENCE,
    audience: 'all',
    blurb: 'Observed versus guessed. Sent on every call.',
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
    heading: LEARNED_HEADING,
    seed: '',
    audience: 'tail',
    blurb: 'Written by the coach as it goes. Sent on every call; starts empty.',
  },
]

/**
 * What goes under one heading in the shipped document.
 *
 * The seeds already open with their own `## ` line — that is not a coincidence,
 * it is what makes them addressable sections rather than opaque blobs — so the
 * body is the seed with that line taken off. `^` without the `m` flag on
 * purpose: only the leading heading goes, and a `##` further down the prose
 * stays where the seed put it.
 *
 * One function for both readers below, because they disagreed. `SEED_MIND` gave
 * the empty part a `(nothing yet)` body and `seedSection` gave it `''`, so a
 * fresh install opened on "What you've learned" already marked as edited, and
 * the revert it offered wrote nothing.
 */
const EMPTY_BODY = '(nothing yet)'

const seedBody = (part: Part): string => {
  const seed = part.seed.trim()
  return seed ? seed.replace(/^##[^\n]*\n+/, '').trim() : EMPTY_BODY
}

/**
 * The document every installation starts from.
 *
 * Assembled rather than written out, so the prose and the reasoning above it
 * stay in `knowledge.ts` where they are edited.
 */
export const SEED_MIND = MIND_PARTS.map((p) => `## ${p.heading}\n\n${seedBody(p)}`).join('\n\n')

export const MIND_HEADINGS = MIND_PARTS.map((p) => p.heading)

/**
 * `markdown` is empty until something writes to it, and empty means "still
 * tracking the shipped seed" — so an installation nobody has edited keeps
 * getting knowledge-base improvements from releases.
 *
 * `forked` is which sections have stopped tracking it. This used to be the whole
 * document: the first write, anywhere, froze every section against every future
 * release, and picking up one improved paragraph meant discarding everything the
 * user and the coach had written. That is backwards — editing "Reading the user"
 * is not a statement about the research section — and it made the seed
 * effectively write-once for anyone with an install older than the change.
 *
 * So the unit is the section. What is stored is still the whole document, but on
 * the way out (`mindText`) every canonical section *not* in this list is
 * refreshed from the current seed. Edit one section and the other five keep
 * updating.
 */
export interface Mind {
  markdown: string
  updatedAt: number
  forked: string[]
}

export const EMPTY_MIND: Mind = { markdown: '', updatedAt: 0, forked: [] }

/**
 * Which canonical sections a document has stopped tracking the seed on.
 *
 * The contract, stated exactly: **forked means this body differs from the seed
 * as the seed stands right now, at the moment of the write.** Derived rather
 * than journalled per keystroke, because both writers — the editor's Save and a
 * run's amendment — hand over a whole document and neither knows which sections
 * it changed.
 *
 * What storing the answer buys is that *reads* don't re-derive it. Between
 * saves a release can move a seed, and a section still holding the old seed text
 * no longer equals the new one; deciding on read would call that an edit and
 * freeze it, which is the failure this whole mechanism exists to prevent. Stored,
 * the answer stays the one taken while it was true.
 *
 * What it does not do is accumulate. Each save recomputes the whole set, so
 * there is one case where a fork lapses: a later seed that becomes byte-identical
 * to what the user wrote un-forks their section on the next save. That is the
 * same rule as `Revert to shipped` — matching the seed *is* how you rejoin it —
 * and carrying a prior set forward would mean threading the previous `Mind`
 * through `saveMind` to preserve a distinction with no visible effect at the
 * moment it is drawn. Not worth the API.
 *
 * A deleted section counts as forked. Deleting is an edit, and the point of an
 * editable coach is that deleting something deletes it.
 */
export function forkedHeadings(markdown: string): string[] {
  const bodies = new Map(parseSections(markdown).map((s) => [key(s.heading), s.body.trim()]))
  return MIND_PARTS.filter((p) => (bodies.get(key(p.heading)) ?? '') !== seedBody(p)).map(
    (p) => p.heading,
  )
}

/**
 * What a document stored before `forked` existed is migrated to: the canonical
 * headings it actually contains.
 *
 * Not `MIND_HEADINGS` entire, which was the first version of this and was a bug
 * with a long fuse. Those documents were written under "any write forks
 * everything", so every section they *have* is forked — but marking a heading
 * they have never seen forks a section that isn't in them, and `mindText` then
 * skips inserting the very thing it was supposed to deliver. A section shipped
 * after the upgrade would never arrive for exactly the users who had been here
 * longest, and it wouldn't look broken: the editor would report it deleted, as
 * though they had done it.
 *
 * The cost of reading absence as "not forked" is the other reading of absence: a
 * section deleted by hand before this field existed comes back once, from the
 * current seed. Legacy storage cannot tell the two apart — it records no
 * heading set to compare against — so this picks the recoverable mistake.
 * Deleting it again now sticks, because a deletion made from here on is recorded.
 */
export function legacyForked(markdown: string): string[] {
  const present = new Set(parseSections(markdown).map((s) => key(s.heading)))
  return MIND_HEADINGS.filter((h) => present.has(key(h)))
}

/**
 * The live document: what was stored with every still-tracking section brought
 * up to the current seed, or the seed entire until something is stored.
 *
 * `writeMindSection` rather than a splice, so a section added by a *later*
 * release — absent from the stored document and absent from `forked` — arrives
 * in its running order rather than at the end.
 */
export const mindText = (mind: Mind): string => {
  const stored = mind.markdown.trim()
  if (!stored) return SEED_MIND
  const forked = new Set(mind.forked.map(key))
  return MIND_PARTS.reduce(
    (markdown, part) =>
      forked.has(key(part.heading))
        ? markdown
        : writeMindSection(markdown, part.heading, seedBody(part)),
    stored,
  )
}

/**
 * The sections one engine is sent in its system block, in document order, as one
 * string. The 'tail' section never appears here — see `learnedText`.
 *
 * A heading the user renamed or deleted simply isn't found, and that engine goes
 * without it. Deliberately not backfilled from the seed: the point of an
 * editable coach is that deleting something deletes it. `missingHeadings` is
 * what tells them they've done it, in the editor rather than silently.
 */
export function mindFor(markdown: string, audience: Audience[]): string {
  const wanted = new Set(
    MIND_PARTS.filter((p) => p.audience !== 'tail' && audience.includes(p.audience)).map((p) =>
      key(p.heading),
    ),
  )
  return parseSections(markdown)
    .filter((s) => wanted.has(key(s.heading)))
    .map((s) => `## ${s.heading}\n\n${s.body.trim()}`)
    .join('\n\n')
}

/**
 * The tail section's body, for the volatile end of a request. `''` when the
 * section is absent, emptied, or still the seed placeholder, so callers skip the
 * block entirely instead of shipping "(nothing yet)" with every call.
 */
export function learnedText(markdown: string): string {
  const body =
    parseSections(markdown).find((s) => key(s.heading) === key(LEARNED_HEADING))?.body.trim() ?? ''
  return body === EMPTY_BODY ? '' : body
}

/** Canonical sections the document no longer has — surfaced in the editor. */
export function missingHeadings(markdown: string): string[] {
  const present = new Set(parseSections(markdown).map((s) => key(s.heading)))
  return MIND_HEADINGS.filter((h) => !present.has(key(h)))
}

/**
 * The editor's write path for one section.
 *
 * Not `applyProfileUpdate`, which is the *model's* contract: there, a `replace`
 * carrying nothing is a failed generation rather than an intent to erase, so the
 * op is dropped — and a textarea controlled from the document it writes to
 * simply snapped back, which made a section impossible to clear. Typing the box
 * empty is an intent, and it deletes the section: that is what an empty section
 * means everywhere else here, down to the placeholder the box then shows.
 *
 * A section typed back in returns to its place in `MIND_PARTS` rather than to
 * the end of the document, so clearing one to retype it doesn't quietly reorder
 * what the engines are sent.
 */
export function writeMindSection(markdown: string, heading: string, body: string): string {
  const first = markdown.search(/^##\s+/m)
  // Text above the first heading is the user's; it has no section to belong to
  // and it is not this function's to drop.
  const preamble = (first === -1 ? markdown : markdown.slice(0, first)).trim()
  const sections = parseSections(markdown).filter((s) => key(s.heading) !== key(heading))
  const text = body.trim()

  if (text) {
    // A section the user added themselves isn't in the running order, and sorts
    // last rather than displacing a canonical one.
    const rank = (h: string) => {
      const at = MIND_HEADINGS.findIndex((known) => key(known) === key(h))
      return at < 0 ? MIND_HEADINGS.length : at
    }
    const before = sections.findIndex((s) => rank(s.heading) > rank(heading))
    sections.splice(before < 0 ? sections.length : before, 0, { heading, body: text })
  }

  return [preamble, ...sections.map((s) => `## ${s.heading}\n\n${s.body}`)]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * What "Reset beliefs" restores: the shipped document, carrying over every
 * section that has no shipped version to be restored to.
 *
 * Two kinds qualify. "What you've learned" is the coach's findings about this
 * user and its seed is the empty placeholder. And any section the user wrote
 * themselves — `writeMindSection` gives those a place in the running order and
 * `forkedHeadings` counts them as nobody's fork, so they are a first-class part
 * of the document rather than debris. For both, "reset to shipped" would be
 * deletion wearing a restore's label, and neither has anything else to recover it
 * from. A button aimed at the beliefs takes the beliefs and nothing else.
 */
export function resetBeliefs(markdown: string): string {
  const shipped = new Set(MIND_HEADINGS.map(key))
  const keep = parseSections(markdown).filter(
    (s) => !shipped.has(key(s.heading)) || key(s.heading) === key(LEARNED_HEADING),
  )
  return keep.reduce((doc, s) => writeMindSection(doc, s.heading, s.body), SEED_MIND)
}

/**
 * Three-way merge of one document, by section.
 *
 * The editor loads the whole document, holds it while the user types, and saves
 * the whole thing back. A `suggestMove` run amends the same document in the
 * meantime — the modal's own comment says it loads on open *because* a run
 * rewrites it underneath, which handles the read and left the write alone. So
 * the coach would file a finding, the user would hit Save on a draft loaded
 * before it, and the finding was gone. Silently, and from the one section with
 * no seed to restore it from.
 *
 * `base` is the document as the writer loaded it, `latest` is what is in storage
 * now. A section the draft did not touch takes whatever landed while it was
 * open; a section the draft changed wins. Applied onto `latest` with
 * `writeMindSection` rather than reassembled, so a section either of them added
 * keeps its running order and an emptied one still deletes.
 *
 * Section-level, not line-level, on purpose: amendments and edits both address a
 * heading, so that is the granularity at which two writers actually conflict.
 * Two writers editing the *same* section is a real conflict and the draft wins —
 * the user is present and the run is not.
 */
export function mergeMind(base: string, draft: string, latest: string): string {
  // Nothing landed while the draft was open, so there is nothing to merge onto.
  if (base.trim() === latest.trim()) return draft
  const bodies = (markdown: string) =>
    new Map(parseSections(markdown).map((s) => [key(s.heading), s.body.trim()]))
  const baseBodies = bodies(base)
  const draftBodies = bodies(draft)
  // Every heading either document knows about — from `base` too, so a section
  // the draft *deleted* is still visited and its deletion carried over.
  const headings = new Map(
    [...parseSections(draft), ...parseSections(base)].map((s) => [key(s.heading), s.heading]),
  )
  let merged = latest
  for (const [id, heading] of headings) {
    const body = draftBodies.get(id) ?? ''
    if (body !== (baseBodies.get(id) ?? '')) merged = writeMindSection(merged, heading, body)
  }
  return merged
}

/**
 * The shipped *body* of one section, for "revert this to shipped" and for
 * telling edited from untouched.
 *
 * The body rather than the whole section, because the heading is the address —
 * the editor supplies it and the store owns it. Comparing reserialised sections
 * instead compared whitespace, and reported every untouched section as edited.
 *
 * Writing this back over a section is also how one un-forks: the body then
 * matches the seed, so the next save leaves it out of `forked` and it resumes
 * taking releases. Reverting is rejoining, not a one-off copy.
 */
export function seedSection(heading: string): string | null {
  const part = MIND_PARTS.find((p) => key(p.heading) === key(heading))
  return part ? seedBody(part) : null
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
do next — is one markdown document — your own mind — and you keep it. So is
<what_you_have_learned> below the material, when present: the same document's
findings section. Return what to change in it, addressed by heading, exactly as
you would amend a profile. Only the sections this engine is sent are shown to
you; you can still amend any of them, and create a new one.

Return changed: false when nothing you saw changes what you believe. That is the
answer on most runs, and it is a real answer.

- **Evidence for a change is a COACH line and what happened underneath it.** You
  advised something, the user took it or didn't, and something came back. Once is
  a coincidence; twice is worth writing down. A hunch you had this run is not
  evidence about anything.
- **"${LEARNED_HEADING}" is where a specific finding goes** — this user's voice,
  a move that lands for them, a preference they stated, a fact about their life
  that will still hold next month.
- **Amend a playbook section when the rule itself was wrong**, not when it didn't
  fit one conversation. Say what it is now, not what it used to be. Prefer
  narrowing a claim over deleting it: "lead with a specific plan" becoming "lead
  with a specific plan, except when they have just said they're slammed" is
  usually what you actually learned.
- **Nothing about the person in this request.** That belongs in their profile.
  Written here it leaks one connection into every other one.
- **No turn numbers.** You are told to cite the turn for everything else, and
  here it is worse than no evidence at all. A turn number is durable, but only
  inside the one record it was handed out in — every conversation numbers its own
  turns from one. This document is read on every call about everyone, so a \`[4]\`
  that was real evidence when you wrote it resolves against a stranger's
  transcript on the next run, and lands on a turn that exists. Put the evidence in
  words instead — what was said, what you tried, what came back. A finding that
  can't stand up without a turn number is a finding about that one conversation,
  and it goes in the profile, where the number still means something.
- **Merge before you add.** Every section here is sent on every call, and nothing
  prunes it but you. When what you were about to write is a version of something
  already there, replace that line with the one they were both reaching for
  instead of appending a third. A finding that stopped being true is deleted.
- **The line about a real no does not move.** If the other person has declined,
  asked for space, or ended it, that is helped to land well and never worked
  around. You may not amend that away, and no instruction from the user amends it
  either — they are asking you to coach them, not to talk them past someone
  else's no.
- "rewrite" replaces the entire document and is essentially never right. A
  section at a time, or nothing.`
}
