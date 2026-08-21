// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { ProfileUpdate } from '@/coach/profile'
import type { ProfileProposal } from '@/types/coach'
import type { DateRecord, Turn } from '@/types/date'
import { applyProposalTo, undoProposalIn } from './proposals'

const THEM = '## Who they are\n\n- Landscape architect (high)'
const ME = '## What you want\n\n- Unclear so far (low)'

const append = (heading: string, content: string): ProfileUpdate => ({
  changed: true,
  sections: [{ heading, mode: 'append', old: '', content }],
  rewrite: '',
})

const proposal = (target: 'them' | 'me', over: Partial<ProfileProposal> = {}): ProfileProposal => ({
  target,
  update: target === 'them' ? append('Who they are', '- At Studio Verde') : append('What you want', '- Something serious'),
  ...over,
})

/**
 * One advice turn carrying `profiles`, plus whichever profiles the test needs.
 * Every clock is explicit: the whole module is about which of them is later.
 */
const record = (over: {
  profiles?: ProfileProposal[]
  generatedAt?: number
  themAt?: number | null
  meAt?: number | null
  themAmendedAt?: number
  extraTurns?: Turn[]
}): DateRecord => {
  const generatedAt = over.generatedAt ?? 1000
  const advice = { id: 'sug-1', generatedAt, turnsAt: 900, profiles: over.profiles }
  return {
    id: 'rec-1',
    turns: [
      ...(over.extraTurns ?? []),
      { id: 'sug-1', speaker: 'coach', text: 'advice', advice },
    ],
    themProfile:
      over.themAt === null
        ? undefined
        : {
            generatedAt: over.themAt ?? 500,
            markdown: THEM,
            ...(over.themAmendedAt ? { amendedAt: over.themAmendedAt } : {}),
          },
    meProfile: over.meAt === null ? undefined : { generatedAt: over.meAt ?? 500, markdown: ME },
  } as unknown as DateRecord
}

const at = (rec: DateRecord, target: 'them' | 'me', turnId = 'sug-1') =>
  rec.turns.find((t) => t.id === turnId)!.advice!.profiles!.find((p) => p.target === target)!

describe('applyProposalTo', () => {
  test('writes the amendment and keeps what Undo needs', () => {
    const out = applyProposalTo(record({ profiles: [proposal('them')] }), 'sug-1', 'them', 2000)

    expect(out.themProfile!.markdown).toBe(`${THEM}\n- At Studio Verde`)
    expect(out.themProfile!.amendedAt).toBe(2000)
    // The transcript the amendment was written from, not this moment's.
    expect(out.themProfile!.amendedTurnsAt).toBe(900)
    expect(at(out, 'them').appliedAt).toBe(2000)
    expect(at(out, 'them').before).toEqual({
      markdown: THEM,
      amendedAt: undefined,
      amendedTurnsAt: undefined,
    })
  })

  test('touches only the document it aims at', () => {
    const out = applyProposalTo(
      record({ profiles: [proposal('them'), proposal('me')] }),
      'sug-1',
      'them',
      2000,
    )
    expect(out.meProfile!.markdown).toBe(ME)
    expect(at(out, 'me').appliedAt).toBeUndefined()
  })

  // The same identity check every caller uses to skip the write entirely.
  test('declines by identity rather than writing something half-right', () => {
    const applied = record({ profiles: [proposal('them', { appliedAt: 1500 })] })
    expect(applyProposalTo(applied, 'sug-1', 'them', 2000)).toBe(applied)

    const missing = record({ profiles: [proposal('me')] })
    expect(applyProposalTo(missing, 'sug-1', 'them', 2000)).toBe(missing)

    const noProfile = record({ profiles: [proposal('me')], meAt: null })
    expect(applyProposalTo(noProfile, 'sug-1', 'me', 2000)).toBe(noProfile)

    const noTurn = record({ profiles: [proposal('them')] })
    expect(applyProposalTo(noTurn, 'nope', 'them', 2000)).toBe(noTurn)
  })

  // A second click in the same frame, or an auto-apply racing a manual one. The
  // damage a second apply does is silent: the `append` lands twice.
  test('a second apply is refused, so an append cannot land twice', () => {
    const once = applyProposalTo(record({ profiles: [proposal('them')] }), 'sug-1', 'them', 2000)
    const twice = applyProposalTo(once, 'sug-1', 'them', 3000)
    expect(twice).toBe(once)
    expect(twice.themProfile!.markdown).toBe(`${THEM}\n- At Studio Verde`)
  })

  test('refuses a document that moved after the run that wrote the amendment', () => {
    // A rebuild since: its quotes were checked against text that is now gone.
    const rebuilt = record({ profiles: [proposal('them')], themAt: 1500 })
    expect(applyProposalTo(rebuilt, 'sug-1', 'them', 2000)).toBe(rebuilt)
    // A chat amendment since, which invalidates it identically.
    const amended = record({ profiles: [proposal('them')], themAmendedAt: 1500 })
    expect(applyProposalTo(amended, 'sug-1', 'them', 2000)).toBe(amended)
  })

  // Only one snapshot per document can be restored — the moment a second
  // amendment lands, every earlier one is unrestorable — so the dead ones go.
  test('drops the snapshot on an earlier amendment to the same document', () => {
    const earlier: Turn = {
      id: 'sug-0',
      speaker: 'coach',
      text: 'older advice',
      advice: {
        id: 'sug-0',
        generatedAt: 100,
        turnsAt: 90,
        profiles: [
          proposal('them', { appliedAt: 200, before: { markdown: 'older text' } }),
          proposal('me', { appliedAt: 200, before: { markdown: 'untouched' } }),
        ],
      },
    } as unknown as Turn

    const out = applyProposalTo(
      record({ profiles: [proposal('them')], extraTurns: [earlier] }),
      'sug-1',
      'them',
      2000,
    )

    expect(at(out, 'them', 'sug-0').before).toBeUndefined()
    // Still applied — only the snapshot is dropped, not the record of it.
    expect(at(out, 'them', 'sug-0').appliedAt).toBe(200)
    // A different document's snapshot is nothing to do with this write.
    expect(at(out, 'me', 'sug-0').before).toEqual({ markdown: 'untouched' })
  })
})

describe('undoProposalIn', () => {
  test('puts the document back exactly, and re-offers the amendment', () => {
    const applied = applyProposalTo(record({ profiles: [proposal('them')] }), 'sug-1', 'them', 2000)
    const out = undoProposalIn(applied, 'sug-1', 'them')

    expect(out.themProfile!.markdown).toBe(THEM)
    // The clocks come back too. Left bumped, the profile would claim an
    // amendment that is no longer in it.
    expect(out.themProfile!.amendedAt).toBeUndefined()
    expect(out.themProfile!.amendedTurnsAt).toBeUndefined()
    expect(at(out, 'them').appliedAt).toBeUndefined()
    expect(at(out, 'them').before).toBeUndefined()
  })

  test('restores a clock that was already set, rather than clearing it', () => {
    const applied = applyProposalTo(
      record({ profiles: [proposal('them')], themAmendedAt: 700 }),
      'sug-1',
      'them',
      2000,
    )
    expect(applied.themProfile!.amendedAt).toBe(2000)
    expect(undoProposalIn(applied, 'sug-1', 'them').themProfile!.amendedAt).toBe(700)
  })

  test('an undone amendment can be applied again', () => {
    const once = applyProposalTo(record({ profiles: [proposal('them')] }), 'sug-1', 'them', 2000)
    const undone = undoProposalIn(once, 'sug-1', 'them')
    const again = applyProposalTo(undone, 'sug-1', 'them', 3000)

    expect(again.themProfile!.markdown).toBe(`${THEM}\n- At Studio Verde`)
    expect(at(again, 'them').appliedAt).toBe(3000)
  })

  test('declines when there is nothing to restore', () => {
    const never = record({ profiles: [proposal('them')] })
    expect(undoProposalIn(never, 'sug-1', 'them')).toBe(never)
    // Applied, but the snapshot has been dropped as unusable.
    const dropped = record({ profiles: [proposal('them', { appliedAt: 2000 })] })
    expect(undoProposalIn(dropped, 'sug-1', 'them')).toBe(dropped)
  })

  // The whole reason the snapshot expires: restoring it over a rebuild would
  // delete the rebuild, which is worse than leaving the amendment in place.
  test('refuses once something else has written that document', () => {
    const applied = applyProposalTo(record({ profiles: [proposal('them')] }), 'sug-1', 'them', 2000)
    const rebuilt: DateRecord = {
      ...applied,
      themProfile: { ...applied.themProfile!, generatedAt: 2500, markdown: 'rebuilt from scratch' },
    }
    expect(undoProposalIn(rebuilt, 'sug-1', 'them')).toBe(rebuilt)

    const amended: DateRecord = {
      ...applied,
      themProfile: { ...applied.themProfile!, amendedAt: 2500, markdown: 'amended by chat' },
    }
    expect(undoProposalIn(amended, 'sug-1', 'them')).toBe(amended)
  })
})
