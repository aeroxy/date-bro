// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { ProfileProposal, Suggestion } from '@/types/coach'
import type { DateRecord, Turn } from '@/types/date'
import { migrateProposals } from './db'

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
