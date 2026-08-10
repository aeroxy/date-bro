/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import {
  LEARNED_HEADING,
  MIND_HEADINGS,
  SEED_MIND,
  learnedText,
  mindFor,
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
