// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { Suggestion } from '@/types/coach'
import type { DateRecord, Turn } from '@/types/date'
import { adviceTurn, formatTurn, speakerLabel, transcriptStats } from './transcript'

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
  test('render under a COACH label with their number', () => {
    const turn = adviceTurn(suggestion())
    expect(speakerLabel(record([]), 'coach')).toBe('COACH')
    expect(formatTurn(record([]), turn, 11)).toStartWith('[12] COACH: Get a specific evening')
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
