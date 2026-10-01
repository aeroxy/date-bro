// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { buildPersonMessages, buildSuggestionMessages } from './prompts'
import type { ChatMessage } from '@/lib/llm-client'
import type { DateRecord, Turn } from '@/types/date'

const record = (turns: Turn[]): DateRecord => ({
  id: 'r1',
  name: 'Mira',
  createdAt: 0,
  updatedAt: 0,
  turnsUpdatedAt: 0,
  nextTurnNumber: turns.length + 1,
  stage: 'talking',
  meta: {},
  goal: '',
  turns: turns.map((t, i) => ({ ...t, number: i + 1 })),
  researchNotes: '',
})

const said: Turn = { id: 'a', speaker: 'them', text: 'made it to the lake' }
const photo: Turn = {
  id: 'b',
  speaker: 'them',
  text: 'A selfie in a green coat on a jetty.',
  photo: true,
}

/** Every stratum of the request, in order, with whether it carries a cache mark. */
const strata = (messages: ChatMessage[]) =>
  messages.flatMap((m) => m.segments ?? [{ text: m.content, cache: false }])

const persons = (turns: Turn[]) => strata(buildPersonMessages(record(turns), '', '', ''))

describe('the photo note', () => {
  test('is absent from a transcript with no photo in it', () => {
    const text = persons([said]).map((s) => s.text).join('\n')
    expect(text).not.toContain('[photo]')
    expect(text).not.toContain('vision model')
  })

  test('appears once a photo is in the pool, and the photo line carries the tag', () => {
    const all = persons([said, photo]).map((s) => s.text)
    expect(all).toContain('[2] MIRA: [photo] A selfie in a green coat on a jetty.')
    expect(all.filter((t) => t.includes('Lines starting [photo]'))).toHaveLength(1)
  })

  test('sits below the last cache mark, in the uncached closing segment', () => {
    const s = persons([said, photo])
    const note = s.findIndex((x) => x.text.includes('Lines starting [photo]'))
    const lastMark = s.map((x) => x.cache).lastIndexOf(true)
    expect(note).toBeGreaterThan(lastMark)
  })

  test('reaches the next-move engine too, which reads the same transcript', () => {
    const s = strata(buildSuggestionMessages(record([said, photo]), '', '', '', false, false))
    expect(s.some((x) => x.text.includes('Lines starting [photo]'))).toBe(true)
  })
})
