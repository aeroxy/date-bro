/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import {
  LEARNED_HEADING,
  MIND_HEADINGS,
  SEED_MIND,
  forkedHeadings,
  learnedText,
  legacyForked,
  mergeMind,
  mindFor,
  mindText,
  resetBeliefs,
  missingHeadings,
  seedSection,
  writeMindSection,
} from './mind'
import { parseSections } from './profile'

const DOC = `## Who you are

You are direct.

## Inference discipline

Say what you saw.

## What you've learned

- He writes short.`

describe('writeMindSection', () => {
  test('replaces a body in place', () => {
    const out = writeMindSection(DOC, 'Inference discipline', 'Cite the turn.')
    expect(parseSections(out).map((s) => s.heading)).toEqual([
      'Who you are',
      'Inference discipline',
      "What you've learned",
    ])
    expect(out).toContain('## Inference discipline\n\nCite the turn.')
  })

  // The bug: this went through `applyProfileUpdate`, which drops a replace whose
  // content is empty — so the textarea it fed snapped back and a section could
  // not be cleared at all.
  test('an emptied section is deleted, not left standing', () => {
    const out = writeMindSection(DOC, LEARNED_HEADING, '   \n  ')
    expect(missingHeadings(out)).toContain(LEARNED_HEADING)
    expect(out).not.toContain("What you've learned")
  })

  test('a section typed back in returns to its place, not to the end', () => {
    const cleared = writeMindSection(DOC, 'Inference discipline', '')
    const back = writeMindSection(cleared, 'Inference discipline', 'Rewritten.')
    expect(parseSections(back).map((s) => s.heading)).toEqual([
      'Who you are',
      'Inference discipline',
      "What you've learned",
    ])
  })

  test("a section the user invented sorts after the ones that ship", () => {
    const out = writeMindSection(DOC, 'My own rules', '- No bars.')
    expect(parseSections(out).at(-1)?.heading).toBe('My own rules')
  })

  test('text above the first heading is not ours to drop', () => {
    const out = writeMindSection(`Scratch note.\n\n${DOC}`, 'Who you are', 'You are warm.')
    expect(out.startsWith('Scratch note.')).toBe(true)
  })

  test('matches a heading the model punctuated differently', () => {
    const curly = DOC.replace("What you've learned", 'What you’ve learned')
    const out = writeMindSection(curly, LEARNED_HEADING, '- He writes long.')
    expect(out.match(/^## /gm)).toHaveLength(3)
    expect(out).toContain('- He writes long.')
  })
})

describe('seedSection', () => {
  // These disagreed: the assembled document gave the empty part a "(nothing
  // yet)" body and this gave it '', so a fresh install opened on "What you've
  // learned" already marked edited, and the revert it offered wrote nothing.
  test('agrees with the shipped document, section for section', () => {
    for (const section of parseSections(SEED_MIND)) {
      expect(seedSection(section.heading)).toBe(section.body)
    }
  })

  test('every canonical heading is in the shipped document', () => {
    expect(missingHeadings(SEED_MIND)).toEqual([])
  })

  test('is null for a heading that never shipped', () => {
    expect(seedSection('Something else')).toBeNull()
  })
})

describe('the heading the instructions address', () => {
  // `mindInstructions` used to read this off the end of MIND_HEADINGS, so
  // appending a part re-aimed the instruction at whatever landed last.
  test('is one of the sections that ships', () => {
    expect(MIND_HEADINGS).toContain(LEARNED_HEADING)
  })
})

describe('the learned section rides the tail, not the system block', () => {
  // The coach rewrites this section on next-move runs, and the system block sits
  // above the profile and the whole transcript — refs/raw1 → raw2 measured one
  // amendment re-writing ~47k cached tokens. `mindFor` feeds system; the tail
  // reads it through `learnedText`.
  test('mindFor never returns it', () => {
    const all = mindFor(DOC, ['all'])
    expect(all).toContain('## Who you are')
    expect(all).not.toContain(LEARNED_HEADING)
  })

  // Not reachable from any engine today, which is exactly why it's pinned: the
  // ask is one word in an audience list, it type-checks, and the only symptom of
  // getting it wrong is a cache bill nobody reads.
  test('asking for it by name gets nothing, not the section', () => {
    expect(mindFor(DOC, ['tail'])).toBe('')
  })

  test('learnedText returns the bare body', () => {
    expect(learnedText(DOC)).toBe('- He writes short.')
  })

  test('the seed placeholder reads as empty, so a fresh install sends no block', () => {
    expect(learnedText(SEED_MIND)).toBe('')
  })

  test('a deleted section reads as empty', () => {
    expect(learnedText(writeMindSection(DOC, LEARNED_HEADING, ''))).toBe('')
  })

  test('matches the heading when the coach retyped its apostrophe', () => {
    expect(learnedText(DOC.replace("What you've learned", 'What you’ve learned'))).toBe(
      '- He writes short.',
    )
  })
})

// The fork used to be the whole document: one edit anywhere froze all six
// sections against every future release, and the only way to pick up an improved
// paragraph was to discard everything you and the coach had written.
describe('forking is per section', () => {
  const EDITED_HEADING = 'Reading the user'
  const edited = writeMindSection(SEED_MIND, EDITED_HEADING, 'Watch how they hedge.')

  test('an untouched document forks nothing', () => {
    expect(forkedHeadings(SEED_MIND)).toEqual([])
  })

  test('editing one section forks only that one', () => {
    expect(forkedHeadings(edited)).toEqual([EDITED_HEADING])
  })

  // Deleting is an edit — the point of an editable coach is that deleting
  // something deletes it, so the seed must not walk back in on the next read.
  test('a deleted section is forked, not untouched', () => {
    expect(forkedHeadings(writeMindSection(SEED_MIND, EDITED_HEADING, ''))).toEqual([
      EDITED_HEADING,
    ])
  })

  test('a section the user added themselves is not a fork of anything', () => {
    expect(forkedHeadings(writeMindSection(SEED_MIND, 'House rules', 'No emoji.'))).toEqual([])
  })
})

describe('mindText composes stored sections over the current seed', () => {
  test('nothing stored is the shipped document', () => {
    expect(mindText({ markdown: '', updatedAt: 0, forked: [] })).toBe(SEED_MIND)
  })

  // The release, simulated: a stored body that no longer matches the seed, on a
  // heading the user never forked. That is a section the seed moved under, and
  // the current text is what should come out.
  test('a section still tracking the seed is refreshed from it', () => {
    const stale = writeMindSection(SEED_MIND, 'Inference discipline', 'Old shipped wording.')
    const live = mindText({ markdown: stale, updatedAt: 1, forked: [] })
    expect(live).not.toContain('Old shipped wording.')
    expect(live).toContain(seedSection('Inference discipline')!)
  })

  test('a forked section is left exactly as stored', () => {
    const mine = writeMindSection(SEED_MIND, 'Reading the user', 'Watch how they hedge.')
    const live = mindText({ markdown: mine, updatedAt: 1, forked: ['Reading the user'] })
    expect(live).toContain('Watch how they hedge.')
    expect(live).not.toContain(seedSection('Reading the user')!)
  })

  // Both at once, which is the whole feature: your edit survives a release that
  // rewrote a section you never touched.
  test('one edited section survives while the rest take the release', () => {
    const stored = writeMindSection(
      writeMindSection(SEED_MIND, 'Reading the user', 'Watch how they hedge.'),
      'Who you are',
      'Old shipped wording.',
    )
    const live = mindText({ markdown: stored, updatedAt: 1, forked: ['Reading the user'] })
    expect(live).toContain('Watch how they hedge.')
    expect(live).not.toContain('Old shipped wording.')
  })

  // A part added by a later release is absent from the stored document and
  // absent from `forked`; it has to arrive in its running order, not at the end.
  test('a newly shipped section arrives in its place', () => {
    const without = writeMindSection(SEED_MIND, 'Using web research', '')
    const live = mindText({ markdown: without, updatedAt: 1, forked: [] })
    expect(missingHeadings(live)).toEqual([])
    expect(parseSections(live).map((s) => s.heading)).toEqual([...MIND_HEADINGS])
  })

  test("a section of the user's own is not touched either way", () => {
    const stored = writeMindSection(SEED_MIND, 'House rules', 'No emoji.')
    expect(mindText({ markdown: stored, updatedAt: 1, forked: [] })).toContain('No emoji.')
  })
})

// Documents saved before `forked` existed, under "any write forks everything".
// The first version of this migrated them to the full canonical heading list,
// which forks sections the document has never contained — and `mindText` skips a
// forked section, so anything shipped after the upgrade would never arrive for
// the longest-standing users, presenting as a section they appeared to delete.
describe('the legacy migration', () => {
  const LATER = 'Using web research'
  // Written out rather than derived from SEED_MIND, because the contract is about
  // documents that are *historically* old and derivation can only approximate
  // one: this is the heading set of an earlier release, carrying that release's
  // seed prose (stale against today's, as a real stored document would be) plus
  // one section the user had edited by hand. `Using web research` and the learned
  // section came later, so they are simply absent — the shape the migration has
  // to read correctly. `Mirror their energy` is the rule the playbook has since
  // dropped, which is what makes it a fair sample of stale text.
  const LEGACY = `## Who you are

You are the analyst behind Date Bro. Warm, straight, never cruel.

## Inference discipline

Separate observation from inference. Every claim gets evidence.

## Reading the other person

Anxiety and avoidance, two dimensions. Hypotheses, never labels.

## Reading the user

Watch how they hedge.

## Choosing what to say or do

Mirror their energy and match their length.`

  const migrated = { markdown: LEGACY, updatedAt: 1, forked: legacyForked(LEGACY) }

  test('forks every canonical section the document has, and only those', () => {
    expect(migrated.forked).toEqual([
      'Who you are',
      'Inference discipline',
      'Reading the other person',
      'Reading the user',
      'Choosing what to say or do',
    ])
  })

  test('does not fork a section shipped after it was saved', () => {
    expect(migrated.forked).not.toContain(LATER)
    expect(migrated.forked).not.toContain(LEARNED_HEADING)
  })

  test('so the later section arrives, in its place', () => {
    const live = mindText(migrated)
    expect(live).toContain(seedSection(LATER)!)
    expect(missingHeadings(live)).toEqual([])
    expect(parseSections(live).map((s) => s.heading)).toEqual([...MIND_HEADINGS])
  })

  // The other half: what the old whole-document rule protected has to survive
  // the same read — the hand edit *and* the stale seed prose beside it, since
  // under that rule the user owned both.
  test('and everything it did have is left alone, edited or merely old', () => {
    const live = mindText(migrated)
    expect(live).toContain('Watch how they hedge.')
    expect(live).toContain('Mirror their energy and match their length.')
    expect(live).not.toContain(seedSection('Choosing what to say or do')!)
  })

  test('the learned section arrives empty rather than as a placeholder to send', () => {
    expect(learnedText(mindText(migrated))).toBe('')
  })

  test('nothing stored forks nothing', () => {
    expect(legacyForked('')).toEqual([])
  })
})

// The editor loads the whole document, holds it while the user types, and saves
// the whole thing back — so a `suggestMove` amendment landing in between used to
// be overwritten, silently, out of the one section with no seed to restore it.
describe('mergeMind', () => {
  const base = SEED_MIND
  const amended = writeMindSection(base, LEARNED_HEADING, '- He writes short.')

  test('an amendment to a section the draft never touched survives the save', () => {
    const draft = writeMindSection(base, 'Reading the user', 'Watch how they hedge.')
    const merged = mergeMind(base, draft, amended)
    expect(learnedText(merged)).toBe('- He writes short.')
    expect(merged).toContain('Watch how they hedge.')
  })

  test('the draft wins the section it did change', () => {
    const draft = writeMindSection(base, LEARNED_HEADING, '- He writes long.')
    expect(learnedText(mergeMind(base, draft, amended))).toBe('- He writes long.')
  })

  test('a section the draft deleted stays deleted', () => {
    const draft = writeMindSection(base, 'Using web research', '')
    const merged = mergeMind(base, draft, amended)
    expect(missingHeadings(merged)).toEqual(['Using web research'])
    expect(learnedText(merged)).toBe('- He writes short.')
  })

  // A section the draft genuinely *added*, which is the case the reduce onto
  // `latest` exists for — it has no slot in the shipped order, so it has to land
  // last rather than wherever the merge happened to reach it.
  test('a section the draft added lands after the ones that ship', () => {
    const draft = writeMindSection(base, 'House rules', 'No emoji.')
    const merged = mergeMind(base, draft, amended)
    expect(parseSections(merged).map((s) => s.heading)).toEqual([...MIND_HEADINGS, 'House rules'])
    expect(learnedText(merged)).toBe('- He writes short.')
  })

  test('nothing landed while the draft was open, so the draft is the answer', () => {
    const draft = writeMindSection(base, LEARNED_HEADING, '- He writes long.')
    expect(mergeMind(base, draft, base)).toBe(draft)
  })
})

// "Reset beliefs" restores what shipped. Both things it keeps are things with no
// shipped version to be restored to, so resetting them would be deletion wearing
// a restore's label — and the button is aimed at the beliefs.
describe('resetBeliefs', () => {
  const lived = writeMindSection(
    writeMindSection(
      writeMindSection(SEED_MIND, 'Reading the user', 'Watch how they hedge.'),
      LEARNED_HEADING,
      '- He writes short.',
    ),
    'House rules',
    'No emoji.',
  )
  const reset = resetBeliefs(lived)

  test('puts every shipped section back', () => {
    expect(reset).toContain(seedSection('Reading the user')!)
    expect(reset).not.toContain('Watch how they hedge.')
    expect(forkedHeadings(reset)).toEqual([LEARNED_HEADING])
  })

  test('keeps what the coach learned', () => {
    expect(learnedText(reset)).toBe('- He writes short.')
  })

  test('keeps a section the user added, which nothing else could restore', () => {
    expect(reset).toContain('No emoji.')
    expect(parseSections(reset).at(-1)?.heading).toBe('House rules')
  })

  test('an untouched document resets to exactly what shipped', () => {
    expect(resetBeliefs(SEED_MIND)).toBe(SEED_MIND)
  })

  test('nothing loaded yet is still the shipped document', () => {
    expect(resetBeliefs('')).toBe(SEED_MIND)
  })
})
