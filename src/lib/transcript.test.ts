// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { Suggestion } from '@/types/coach'
import type { DateRecord, Turn } from '@/types/date'
import { adviceTurn, formatTurn, numberTurns, speakerLabel, transcriptStats } from './transcript'

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 'sug-1',
  generatedAt: 0,
  read: 'Warm but stalling.',
  priority: 'Get a specific evening on the table this week.',
  options: [
    { label: 'Direct invite', kind: 'message', risk: 'low', draft: 'thursday, 8?', why: '', then: '' },
    { label: 'Tease the delay', kind: 'message', risk: 'medium', draft: 'so we doing this', why: '', then: '' },
  ],
  avoid: [],
  timing: '',
  honest_note: '',
  research_notes: [],
  ...over,
})

const record = (turns: Turn[]): DateRecord =>
  ({ name: 'Mira', turns }) as unknown as DateRecord

describe('adviceTurn', () => {
  test('keeps the priority and the option labels, and nothing else', () => {
    const turn = adviceTurn(suggestion())
    expect(turn.speaker).toBe('coach')
    expect(turn.text).toBe(
      'Get a specific evening on the table this week.\nOffered: Direct invite · Tease the delay',
    )
    // The drafts are the bulk of a generation and the reason this is a summary.
    expect(turn.text).not.toContain('thursday, 8?')
  })

  test('takes the suggestion id, so the two can never drift apart', () => {
    expect(adviceTurn(suggestion({ id: 'abc' })).id).toBe('abc')
  })

  test('carries the whole suggestion for the panel', () => {
    expect(adviceTurn(suggestion()).advice?.options).toHaveLength(2)
  })

  // Local, not `Date.UTC`, for the reason given at the top of `birthday.test.ts`
  // — and mid-year, so the year can be asserted in any zone. The exact wording is
  // the runtime's, so what's pinned is that the stamp is there, carries the year,
  // and reaches the line a prompt actually shows.
  test('timestamps itself, which no other turn can', () => {
    const at = new Date(2026, 7, 15, 23, 36).getTime()
    const turn = adviceTurn(suggestion({ generatedAt: at }))
    expect(turn.at).toBeTruthy()
    expect(turn.at).toContain('2026')
    expect(formatTurn(record([]), { ...turn, number: 12 })).toContain(`[12] COACH (${turn.at}):`)
  })

  // `db.ts` builds these from suggestions stored by older versions too, and an
  // untimed turn is the normal case for every other speaker. "Invalid Date" is
  // not — the model would read it as something the user wrote.
  test('leaves the stamp off rather than inventing one, when there is none', () => {
    const turn = adviceTurn(suggestion({ generatedAt: undefined as unknown as number }))
    expect(turn.at).toBeUndefined()
    expect(formatTurn(record([]), { ...turn, number: 3 })).toStartWith('[3] COACH: ')
  })

  test('survives a suggestion with unlabelled options', () => {
    const turn = adviceTurn(
      suggestion({
        options: [
          { label: '  ', kind: 'message', risk: 'low', draft: 'x', why: '', then: '' },
        ],
      }),
    )
    expect(turn.text).toBe('Get a specific evening on the table this week.')
  })
})

describe('coach turns in the transcript', () => {
  test('render under a COACH label with their number, and their own stamp', () => {
    const turn = { ...adviceTurn(suggestion()), number: 12 }
    expect(speakerLabel(record([]), 'coach')).toBe('COACH')
    expect(formatTurn(record([]), turn)).toStartWith(`[12] COACH (${turn.at}): Get a specific`)
  })

  test('are outside every count — nobody showed up in the conversation', () => {
    const stats = transcriptStats(
      record([
        { id: '1', speaker: 'them', text: 'hey you' },
        { id: '2', speaker: 'me', text: 'hey' },
        adviceTurn(suggestion()),
      ]),
    )
    expect(stats.total).toBe(2)
    expect(stats.themTurns).toBe(1)
    expect(stats.myTurns).toBe(1)
    // The priority ends in a full stop, not a question mark, but the option
    // labels and drafts could hold either — none of it may reach these counts.
    expect(stats.themWords + stats.myWords).toBe(3)
  })
})

const turn = (id: string, number?: number): Turn => ({
  id,
  ...(number === undefined ? {} : { number }),
  speaker: 'them',
  text: id,
})

// A citation used to be the array index, computed at render time — so inserting
// a turn near the top re-aimed every reference below it, in profile prose nobody
// re-reads.
describe('numberTurns', () => {
  test('numbers a record written before the field existed, by position', () => {
    // Position, because that is what the old renderer showed: a `[2]` already
    // sitting in a stored profile has to keep meaning the second turn.
    const out = numberTurns(record([turn('a'), turn('b'), turn('c')]))
    expect(out.turns.map((t) => t.number)).toEqual([1, 2, 3])
    expect(out.nextTurnNumber).toBe(4)
  })

  // Allocation order, not transcript order — the array reads 60, 62, 61 and that
  // is correct. Anyone reading this as untidy and sorting it back into sequence
  // would be renumbering stored citations, which is the whole thing this field
  // exists to prevent. The assertion is deliberately the out-of-order one.
  test('gives an inserted turn the next free number, not its position', () => {
    const stored = { ...record([turn('a', 60), turn('b', 61)]), nextTurnNumber: 62 }
    const inserted = { ...stored, turns: [stored.turns[0]!, turn('new'), stored.turns[1]!] }
    const out = numberTurns(inserted)
    expect(out.turns.map((t) => t.number)).toEqual([60, 62, 61])
    expect(out.nextTurnNumber).toBe(63)
  })

  // The reason the counter is persisted rather than derived from the turns:
  // `max(number) + 1` hands 62 straight back out, and a profile citing the
  // deleted [62] would then point at different content.
  test('never reuses the number of a deleted turn', () => {
    const afterDelete = { ...record([turn('a', 60), turn('b', 61)]), nextTurnNumber: 63 }
    const out = numberTurns({ ...afterDelete, turns: [...afterDelete.turns, turn('new')] })
    expect(out.turns.at(-1)!.number).toBe(63)
    expect(out.nextTurnNumber).toBe(64)
  })

  // Pure and total, like the migrations in `db.ts` — a record read a hundred
  // times before it is next saved has to render the same bytes each time, and a
  // fresh object each read would churn React below it.
  test('is idempotent, and returns the record itself when there is nothing to do', () => {
    const once = numberTurns(record([turn('a'), turn('b')]))
    expect(numberTurns(once)).toBe(once)
  })

  test('a counter behind the turns does not hand out a number twice', () => {
    const out = numberTurns({ ...record([turn('a', 7)]), nextTurnNumber: 2 })
    expect(out.nextTurnNumber).toBe(8)
  })

  test('an empty record still gets a counter', () => {
    expect(numberTurns(record([])).nextTurnNumber).toBe(1)
  })

  // Pinning an assumption rather than asserting a feature. Uniqueness is assumed
  // of numbers already stored, and a duplicate is a bug upstream — but it must
  // not be *repaired* here: which turn an existing `[12]` meant is unanswerable,
  // and renumbering one of them silently re-aims it, which is the failure this
  // field exists to remove. So it is carried, visibly, and a future change to
  // that has to break this test on purpose.
  test('carries a duplicate number rather than repairing it', () => {
    const out = numberTurns(record([turn('a', 12), turn('b', 12)]))
    expect(out.turns.map((t) => t.number)).toEqual([12, 12])
  })

  // What *is* enforced: the counter clears every number any turn holds, so a
  // duplicate can never become a triplicate.
  test('and will not issue a third copy of it', () => {
    const dupes = record([turn('a', 12), turn('b', 12)])
    const out = numberTurns({ ...dupes, turns: [...dupes.turns, turn('new')] })
    expect(out.turns.at(-1)!.number).toBe(13)
  })
})

describe('formatTurn cites the turn number, not the position', () => {
  test('the citation does not move when the turn does', () => {
    // A turn sitting third in the array, cited as 62. There is no index argument
    // to disagree with any more — `formatTurn` takes a `NumberedTurn`, so there
    // is nothing to fall back to and no second identity scheme to invent.
    const t = { id: 'a', number: 62, speaker: 'them' as const, text: 'hey you' }
    expect(formatTurn(record([]), t)).toStartWith('[62] MIRA: hey you')
  })

  // `numberTurns` resolves the record first and rendering follows, which is the
  // order every real path takes — nothing renders mid-numbering. What is being
  // pinned is that resolving a *partially* numbered record leaves no two turns
  // sharing a citation, because that is what the removed positional fallback got
  // wrong: an unnumbered turn dropped in at index 60 of a record already holding
  // 60 and 61 rendered as `[61]`, giving two turns one citation in the material
  // the coach reasons from.
  test('numbers a partially numbered record without citation collisions', () => {
    const stored = {
      ...record([turn('a', 60), turn('b', 61)]),
      nextTurnNumber: 62,
    }
    const inserted = { ...stored, turns: [stored.turns[0]!, turn('new'), stored.turns[1]!] }
    const cited = numberTurns(inserted).turns.map((t) => formatTurn(inserted, t).split(']')[0])
    expect(cited).toEqual(['[60', '[62', '[61'])
    expect(new Set(cited).size).toBe(cited.length)
  })
})
