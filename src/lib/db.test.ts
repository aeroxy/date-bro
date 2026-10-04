// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { ProfileProposal, Suggestion } from '@/types/coach'
import type { DateRecord, Turn } from '@/types/date'
import { migrateProposals, migrateReactions } from './db'

const update = { changed: true as const, sections: [{ heading: 'Right now', mode: 'append' as const, content: '- x' }] }

/** A stored advice turn in the shape a record written before the two slots holds. */
const legacy = (profile: unknown, rest: Partial<Suggestion> = {}): Turn =>
  ({
    id: 'sug-1',
    speaker: 'coach',
    text: 'Get a specific evening on the table.',
    advice: { id: 'sug-1', generatedAt: 10, profile, ...rest },
  }) as unknown as Turn

const record = (turns: Turn[]): DateRecord => ({ name: 'Mira', turns }) as unknown as DateRecord

const proposals = (out: DateRecord): ProfileProposal[] | undefined => out.turns[0]!.advice!.profiles

describe('migrateProposals', () => {
  test('moves the single proposal into the list, keeping whose it was', () => {
    const out = migrateProposals(record([legacy({ target: 'me', update })]))
    expect(proposals(out)).toEqual([{ target: 'me', update }])
    // The old field is gone, not shadowed: left in place it would be migrated
    // again on the next read and appended a second time.
    expect(out.turns[0]!.advice).not.toHaveProperty('profile')
  })

  test('carries `appliedAt`, so an accepted offer is not re-offered', () => {
    const out = migrateProposals(record([legacy({ target: 'them', update, appliedAt: 99 })]))
    expect(proposals(out)![0]!.appliedAt).toBe(99)
  })

  test('leaves a record that never had one alone, object identity included', () => {
    const already = record([legacy(undefined, { profiles: [{ target: 'them', update }] })])
    expect(migrateProposals(already)).toBe(already)
  })

  test('does not double up when a record holds both shapes for one document', () => {
    const both = record([legacy({ target: 'them', update }, { profiles: [{ target: 'them', update }] })])
    expect(proposals(migrateProposals(both))).toHaveLength(1)
  })

  test('keeps both when the two shapes aim at different documents', () => {
    const mixed = record([legacy({ target: 'me', update }, { profiles: [{ target: 'them', update }] })])
    expect(proposals(migrateProposals(mixed))!.map((p) => p.target)).toEqual(['them', 'me'])
  })

  test('touches only the turns that carry one', () => {
    const plain = { id: 't1', speaker: 'them', text: 'hey' } as Turn
    const out = migrateProposals(record([plain, legacy({ target: 'them', update })]))
    expect(out.turns[0]).toBe(plain)
  })
})

// What this rewrites is stored message text, on a pattern. The cases it must
// leave alone matter as much as the one it lifts.
describe('migrateReactions', () => {
  const said = (text: string, over: Partial<Turn> = {}): Turn =>
    ({ id: 't1', speaker: 'them', text, ...over }) as Turn

  const only = (out: DateRecord) => out.turns[0]!

  test('lifts the bracketed emoji an old import left on the end of the text', () => {
    const out = migrateReactions(record([said('sure [❤️]')]))
    expect(only(out).text).toBe('sure')
    expect(only(out).reactions).toBe('❤️')
  })

  test('lifts it from either side, and from a captionless photo line', () => {
    const out = migrateReactions(
      record([said('haha [😂]', { speaker: 'me' }), said('[photo] [👍 2]', { id: 't2' })]),
    )
    expect(out.turns.map((t) => [t.text, t.reactions])).toEqual([
      ['haha', '😂'],
      ['[photo]', '👍 2'],
    ])
  })

  test('keeps everything else about the turn', () => {
    const turn = said('sure [❤️]', { number: 7, at: 'Tue 9pm', note: 'flat' })
    expect(only(migrateReactions(record([turn])))).toEqual({
      id: 't1',
      speaker: 'them',
      number: 7,
      at: 'Tue 9pm',
      note: 'flat',
      text: 'sure',
      reactions: '❤️',
    })
  })

  test('leaves a bracket that holds a word, or a number, as the words they are', () => {
    for (const text of ['see [1]', 'and then [laughs]', 'look [sticker 😂]', '[❤️] first', '[❤️]']) {
      const turn = said(text)
      const already = record([turn])
      expect(migrateReactions(already)).toBe(already)
    }
  })

  test('does not read a NOTE, a coach turn or a photo description', () => {
    const turns = [
      said('learned this from a friend [❤️]', { id: 'n', speaker: 'context' }),
      said('Get a evening on the table [❤️]', { id: 'c', speaker: 'coach' }),
      said('A selfie by a lake [❤️]', { id: 'p', photo: true }),
    ]
    const already = record(turns)
    expect(migrateReactions(already)).toBe(already)
  })

  test('does not overwrite a reaction the turn already has', () => {
    const already = record([said('sure [❤️]', { reactions: '👍' })])
    expect(migrateReactions(already)).toBe(already)
  })

  test('is idempotent, and returns the record itself once there is nothing left to lift', () => {
    const once = migrateReactions(record([said('sure [❤️]')]))
    expect(migrateReactions(once)).toBe(once)
  })

  test('returns a record with nothing to lift by identity', () => {
    const already = record([said('hey you'), said('how was your day', { speaker: 'me', id: 't2' })])
    expect(migrateReactions(already)).toBe(already)
  })
})
