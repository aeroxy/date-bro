import { applyProfileUpdate } from '@/coach/profile'
import type { ProfileProposal } from '@/types/coach'
import type { DateRecord } from '@/types/date'

/**
 * Applying a proposal, and taking it back. Pure functions over a record, so the
 * two ways in can't drift apart: an amendment is applied when the advice is
 * stored, and again by hand if the user undid one and changed their mind. The
 * hard part is the same both times — which writes are safe, and what has to be
 * kept so the write can be reversed — and it is written once, here, where it can
 * be tested without a browser.
 *
 * Each function returns the record **unchanged, by identity** when it declines,
 * so a caller can compare with `===` and skip the write entirely.
 */

/** Where a target's profile lives on the record. */
const key = (target: 'them' | 'me'): 'themProfile' | 'meProfile' =>
  target === 'them' ? 'themProfile' : 'meProfile'

/**
 * Whether a profile has been written since `at` — by a rebuild, by an amendment,
 * or by the user editing the prose by hand. All three invalidate a proposal
 * identically, so all three are one clock here.
 *
 * Two questions, one answer. Before applying: the quotes in an `edit` were
 * checked against the document as it stood during the run, so a document that
 * has moved since was checked against text that no longer exists. Before
 * undoing: a snapshot restored over a newer write would silently delete it,
 * which is a worse outcome than not undoing at all — and the hand edit is the
 * version of that which would lose the user's own typing.
 */
export function movedSince(profile: { generatedAt: number; amendedAt?: number }, at: number): boolean {
  return Math.max(profile.generatedAt, profile.amendedAt ?? 0) > at
}

/** The proposal aimed at `target` on the advice turn `adviceId`, if there is one. */
function find(record: DateRecord, adviceId: string, target: 'them' | 'me') {
  const advice = record.turns.find((t) => t.id === adviceId)?.advice
  return { advice, proposal: advice?.profiles?.find((p) => p.target === target) }
}

/** Rewrite one proposal in place, leaving every other turn's object identity alone. */
function withProposal(
  record: DateRecord,
  adviceId: string,
  target: 'them' | 'me',
  edit: (p: ProfileProposal) => ProfileProposal,
  /**
   * Applied to every *other* applied proposal aimed at the same document. Only
   * one snapshot per document can be live at a time — the moment a second
   * amendment lands on it, every earlier one is unrestorable — so the dead ones
   * are dropped rather than kept forever on a turn nobody will scroll back to.
   */
  editOthers?: (p: ProfileProposal) => ProfileProposal,
): DateRecord {
  return {
    ...record,
    turns: record.turns.map((turn) => {
      if (!turn.advice?.profiles) return turn
      const isTarget = turn.id === adviceId
      return {
        ...turn,
        advice: {
          ...turn.advice,
          profiles: turn.advice.profiles.map((p) => {
            if (p.target !== target) return p
            if (isTarget) return edit(p)
            return editOthers ? editOthers(p) : p
          }),
        },
      }
    }),
  }
}

/**
 * Write an amendment into the profile it aims at, and keep what Undo needs.
 *
 * Declines, rather than half-doing it, in four cases: the proposal is gone or
 * already applied (a second click in one frame, which would apply an `append`
 * twice); the document doesn't exist, since inventing one would fabricate a
 * judgment nothing produced; the document has moved since the run that wrote
 * the amendment, so `applyProfileUpdate` would drop whichever quotes stopped
 * fitting and apply the rest — a half-applied amendment reported as applied.
 */
export function applyProposalTo(
  record: DateRecord,
  adviceId: string,
  target: 'them' | 'me',
  now: number,
): DateRecord {
  const { advice, proposal } = find(record, adviceId, target)
  if (!advice || !proposal || proposal.appliedAt) return record

  const field = key(target)
  const profile = record[field]
  if (!profile) return record
  if (movedSince(profile, advice.generatedAt)) return record

  const next = withProposal(
    record,
    adviceId,
    target,
    (p) => ({
      ...p,
      appliedAt: now,
      before: {
        markdown: profile.markdown,
        amendedAt: profile.amendedAt,
        amendedTurnsAt: profile.amendedTurnsAt,
      },
    }),
    ({ before, ...rest }) => rest,
  )
  return {
    ...next,
    [field]: {
      ...profile,
      markdown: applyProfileUpdate(profile.markdown, proposal.update),
      amendedAt: now,
      // The transcript the amendment was written from, which is the
      // suggestion's, not this moment's.
      amendedTurnsAt: advice.turnsAt,
    },
  }
}

/**
 * Put the document back exactly as it stood before the amendment landed, and
 * return the offer to the state it was in before — so a user who undoes by
 * mistake can apply it again.
 *
 * Declines when there is nothing to restore, and when the document has moved
 * since: a rebuild or a chat amendment after the apply means the snapshot is no
 * longer the immediately-previous state, and writing it would take that newer
 * work with it.
 */
export function undoProposalIn(
  record: DateRecord,
  adviceId: string,
  target: 'them' | 'me',
): DateRecord {
  const { proposal } = find(record, adviceId, target)
  if (!proposal?.appliedAt || !proposal.before) return record

  const field = key(target)
  const profile = record[field]
  if (!profile) return record
  if (movedSince(profile, proposal.appliedAt)) return record

  const { markdown, amendedAt, amendedTurnsAt } = proposal.before
  const next = withProposal(record, adviceId, target, ({ appliedAt, before, ...rest }) => rest)
  return {
    ...next,
    [field]: {
      ...profile,
      markdown,
      // Assigned even when undefined, which is the point: a profile that had
      // never been amended has no clocks, and leaving the ones this apply set
      // in place would show the prose as updated on a document nothing touched.
      amendedAt,
      amendedTurnsAt,
    },
  }
}
