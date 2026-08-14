// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { PersonProfile, SelfProfile, Suggestion } from '@/types/coach'
import type { DateRecord, Turn } from '@/types/date'
import { exportFilename, recordToMarkdown } from './export-markdown'

const NOW = new Date(2026, 7, 13, 9, 30)

const record = (over: Partial<DateRecord> = {}): DateRecord => ({
  id: 'r1',
  name: 'Mira',
  // Local, not `Date.UTC`: the renderer formats this with `toLocaleDateString`,
  // so a UTC midnight is the previous day west of Greenwich and the assertion
  // below fails there and only there.
  createdAt: new Date(2026, 5, 1).getTime(),
  updatedAt: Date.UTC(2026, 7, 1),
  turnsUpdatedAt: Date.UTC(2026, 7, 1),
  nextTurnNumber: 1,
  stage: 'talking',
  meta: {},
  goal: '',
  turns: [],
  researchNotes: '',
  ...over,
})

const themProfile = (over: Partial<PersonProfile> = {}): PersonProfile => ({
  generatedAt: new Date(2026, 7, 2, 14, 5).getTime(),
  markdown: '## Who they are\n\nLandscape architect [4].',
  judgment: {
    headline: 'Engaged, but pacing it.',
    interest_read: {
      level: 'too-early',
      confidence: 'medium',
      signals_for: ['Replies within the hour [3]'],
      signals_against: ['Has not suggested a date [5]'],
      honest_note: 'Three days of texting is not evidence of much.',
    },
    flags: [{ kind: 'green', label: 'Direct about her ex', evidence: 'Raised it unprompted [7]' }],
    open_questions: ['Does she want to meet in person'],
  },
  ...over,
})

const meProfile = (): SelfProfile => ({
  generatedAt: new Date(2026, 7, 2, 14, 6).getTime(),
  markdown: '## Who you are\n\nWorks nights.',
  judgment: {
    headline: 'You are hedging.',
    goal_read: { stated: 'Something serious', revealed: 'Keeping it light', tension: 'Pick one.' },
    open_questions: ['What you actually want by October'],
  },
})

const suggestion = (): Suggestion => ({
  id: 'sug-1',
  generatedAt: 0,
  read: 'Warm but stalling.',
  priority: 'Get an evening on the table.',
  options: [
    {
      label: 'Direct invite',
      kind: 'message',
      risk: 'low',
      draft: 'thursday, 8?',
      why: 'she has opened twice',
      then: 'read the speed of the reply',
    },
  ],
  avoid: ['Another open-ended maybe'],
  timing: 'Tonight',
  honest_note: 'She may say no.',
  research_notes: [],
})

describe('recordToMarkdown', () => {
  test('leads with the person, the export date and the standing facts', () => {
    const md = recordToMarkdown(
      record({
        stage: 'dating',
        meta: { since: 'early June', howWeMet: 'Hinge', pronouns: 'she/her' },
      }),
      NOW,
    )
    expect(md.startsWith('# Mira\n')).toBe(true)
    expect(md).toContain('exported 13 August 2026')
    expect(md).toContain('- **Stage:** Dating')
    expect(md).toContain('- **Talking since:** early June')
    expect(md).toContain('- **How you met:** Hinge')
    // Nothing was entered for these, so they aren't rows saying "unknown".
    expect(md).not.toContain('Location')
    expect(md).not.toContain('Birthday')
  })

  test('derives the age from a birthday instead of restating a stored number', () => {
    const md = recordToMarkdown(record({ meta: { birthday: '1997-07-14', age: '25' } }), NOW)
    expect(md).toContain('- **Birthday:** 14 July 1997 — 29 years old')
    expect(md).not.toContain('**Age:**')
  })

  // `lib/db.ts` migrates records from before the field with `?? 0`, and a stamp
  // reading "1 January 1970" is worse than no stamp.
  test('omits the last-edited stamp on a record migrated from before it existed', () => {
    const turns: Turn[] = [{ id: 't1', speaker: 'me', text: 'Hello' }]
    const md = recordToMarkdown(record({ turns, turnsUpdatedAt: 0 }), NOW)
    expect(md).toContain('1 turns — 0 from Mira, 1 from you_')
    expect(md).not.toContain('1970')
    expect(md).not.toContain('last edited')
  })

  test('keeps a retired free-text age, stamped with when it was written down', () => {
    const md = recordToMarkdown(record({ meta: { age: '28' } }), NOW)
    expect(md).toContain('- **Age:** 28, as recorded on 1 June 2026')
  })

  test('states both profiles in absolute dates, so the file survives being kept', () => {
    const md = recordToMarkdown(
      record({
        themProfile: themProfile({ amendedAt: new Date(2026, 7, 4, 9, 12).getTime() }),
        meProfile: meProfile(),
      }),
      NOW,
    )
    expect(md).toContain('Rebuilt 2 August 2026')
    expect(md).toContain('prose amended 4 August 2026')
    // Never a relative stamp: it is only true the moment it is rendered.
    expect(md).not.toContain('ago')
  })

  test('carries the judgment the prose cannot', () => {
    const md = recordToMarkdown(record({ themProfile: themProfile() }), NOW)
    expect(md).toContain('**Where they stand:** too early (confidence: medium)')
    expect(md).toContain('**Pointing yes:**')
    expect(md).toContain('- Replies within the hour [3]')
    expect(md).toContain('**Straight with you:** Three days of texting')
    expect(md).toContain('- **green · Direct about her ex** — Raised it unprompted [7]')
    expect(md).toContain("### What you still don't know about Mira")
  })

  test("nests the profile's own headings under the section holding them", () => {
    const md = recordToMarkdown(record({ themProfile: themProfile(), meProfile: meProfile() }), NOW)
    // One outline: `## Mira` owns the prose, so `## Who they are` drops a level.
    expect(md).toContain('## Mira\n')
    expect(md).toContain('### Who they are')
    expect(md).toContain('### Who you are')
    // Only the document's own sections are left at `##`.
    expect(md.match(/^## .+$/gm)).toEqual([
      '## What you want from this',
      '## Mira',
      '## You',
      '## Conversation',
    ])
  })

  test('renders every kind of turn, numbered as the coach cites it', () => {
    const turns: Turn[] = [
      { id: 't1', number: 3, speaker: 'them', text: 'hey!', at: 'Tue 9pm', channel: 'call' },
      { id: 't2', number: 4, speaker: 'me', text: 'line one\nline two', note: 'took me an hour' },
      { id: 't3', number: 5, speaker: 'context', text: 'free next weekend', asked: 'is she free' },
      { id: 'sug-1', number: 6, speaker: 'coach', text: 'Get an evening.', advice: suggestion() },
    ]
    const md = recordToMarkdown(record({ turns, nextTurnNumber: 7 }), NOW)
    expect(md).toContain('**[3] MIRA** · Tue 9pm · call')
    expect(md).toContain('> hey!')
    // Every line prefixed, so a multi-line message stays one block.
    expect(md).toContain('> line one\n> line two')
    expect(md).toContain('_Your note: took me an hour_')
    expect(md).toContain('**[5] NOTE**')
    expect(md).toContain('_Answering: is she free_')
    // A note and a coach line are neither of them speaking, so neither counts.
    expect(md).toContain('2 turns — 1 from Mira, 1 from you')
  })

  test('numbers turns that were never numbered, rather than dropping the citation', () => {
    const md = recordToMarkdown(
      record({ turns: [{ id: 't1', speaker: 'them', text: 'hey' }], nextTurnNumber: undefined }),
      NOW,
    )
    expect(md).toContain('**[1] MIRA**')
  })

  test('keeps a coach turn short but does not lose the words it offered', () => {
    const turns: Turn[] = [
      { id: 'sug-1', number: 1, speaker: 'coach', text: 'Get an evening.', advice: suggestion() },
    ]
    const md = recordToMarkdown(record({ turns }), NOW)
    expect(md).toContain('**Direct invite** (message, low risk): thursday, 8?')
    // The rest of the generation is panel furniture — it would bury the
    // conversation it sits inside.
    expect(md).not.toContain('she has opened twice')
    expect(md).not.toContain('Another open-ended maybe')
  })

  test('says a section is empty rather than implying there is nothing to say', () => {
    const md = recordToMarkdown(record(), NOW)
    expect(md).toContain('## What you want from this\n\n_Not stated._')
    expect(md).toContain('## Conversation\n\n_Nothing entered yet._')
    // No profile and no notes yet: the headings would be furniture.
    expect(md).not.toContain('## Research notes')
    expect(md).not.toContain('Rebuilt')
  })

  test('includes the research notes when there are any', () => {
    const md = recordToMarkdown(record({ researchNotes: 'Cafe Lumen closes 9pm Sundays.' }), NOW)
    expect(md).toContain('## Research notes\n\nCafe Lumen closes 9pm Sundays.')
  })

  test('holds up when the record is barely filled in', () => {
    const md = recordToMarkdown(record({ name: '   ' }), NOW)
    expect(md.startsWith('# Them\n')).toBe(true)
  })
})

describe('exportFilename', () => {
  test('is the person and the local date', () => {
    expect(exportFilename(record(), NOW)).toBe('mira-2026-08-13.md')
  })

  test('slugifies a name with punctuation or spaces in it', () => {
    expect(exportFilename(record({ name: "Mira O'Brien-Lee" }), NOW)).toBe(
      'mira-o-brien-lee-2026-08-13.md',
    )
  })

  test('still names a file when the name is unusable', () => {
    expect(exportFilename(record({ name: '???' }), NOW)).toBe('date-2026-08-13.md')
  })
})
