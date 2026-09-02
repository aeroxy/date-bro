// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { findOverlap } from './overlap'
import type { Turn } from '@/types/date'

/**
 * The seam between what is recorded and what a fetch just brought back.
 *
 * The interesting cases are all the ways the two sides *don't* match: the record
 * may have been hand-pasted or typed, so its wording drifts from the log's, and
 * the log carries asides no typed turn ever had.
 */
const turn = (speaker: Turn['speaker'], text: string): Turn =>
  ({ id: crypto.randomUUID(), speaker, text }) as Turn

const log = [
  'Them [Sat Aug 8, 8:59pm]: where in singapore are you',
  'Me [Sat Aug 8, 9:02pm]: east coast, near the park',
  'Them [Sat Aug 8, 9:10pm]: oh nice, i run there sometimes',
  'Me [Sun Aug 9, 10:54am]: we should go together then',
  'Them [Sun Aug 9, 11:00am]: haha maybe',
].join('\n')

describe('findOverlap', () => {
  test('finds an exact last turn and counts what is below it', () => {
    const found = findOverlap(log, [turn('them', 'oh nice, i run there sometimes')])

    expect(found?.line).toBe(2)
    expect(found?.fresh).toBe(2)
    expect(found?.score).toBe(1)
    expect(log.slice(found!.start, found!.start + found!.length)).toBe(
      'Them [Sat Aug 8, 9:10pm]: oh nice, i run there sometimes',
    )
  })

  test('reads through punctuation and case a hand-typed turn got wrong', () => {
    // `shape` erases exactly this kind of drift, so it lands as a clean match
    // rather than a near one — worth pinning, since it is the common case.
    const found = findOverlap(log, [turn('me', 'East Coast — near the park!')])

    expect(found?.line).toBe(1)
    expect(found?.score).toBe(1)
  })

  test('still matches when words were added or dropped', () => {
    // Typed from memory a week later: the gist survives, the wording doesn't.
    const found = findOverlap(log, [turn('me', 'east coast near the big park by the water')])

    expect(found?.line).toBe(1)
    expect(found?.score).toBeGreaterThanOrEqual(0.6)
    expect(found?.score).toBeLessThan(1)
  })

  test('matches through an aside the typed turn never had', () => {
    const withMedia = log.replace(
      'Me [Sat Aug 8, 9:02pm]: east coast, near the park',
      'Me [Sat Aug 8, 9:02pm]: [photo] east coast, near the park',
    )
    expect(findOverlap(withMedia, [turn('me', 'east coast, near the park')])?.line).toBe(1)
  })

  test('falls back to an earlier turn when the last one is not in the log', () => {
    // The newest recorded message was sent after the fetch window, or typed and
    // never sent — either way it is the turn before that marks the seam.
    const found = findOverlap(log, [
      turn('them', 'oh nice, i run there sometimes'),
      turn('me', 'something said later that this log does not contain at all'),
    ])

    expect(found?.line).toBe(2)
    expect(found?.back).toBe(1)
  })

  test('skips a turn too short to mean anything', () => {
    // "haha maybe" is the last line of the log, but anchoring on "ok" would
    // point at whichever line happened to score first.
    expect(findOverlap(log, [turn('me', 'ok')])).toBeNull()
  })

  test('a repeated word is not a fingerprint, however long the turn', () => {
    // Four "no"s used to score four shared words against a line that says "no"
    // once — a perfect match to a message that has nothing to do with it.
    const noisy = ['Them [Sat 9pm]: no way, really?', 'Me [Sat 9pm]: yes it happened', 'Them [Sat 9pm]: wild'].join('\n')
    expect(findOverlap(noisy, [turn('me', 'no no no no')])).toBeNull()
  })

  test('containment needs a substantial line, not a one-word one', () => {
    // "yes no yes no" contains "no", so a one-word line saying "no" used to
    // count as a 0.95 match. The line has to clear the same length bar the turn does.
    const oneWord = 'Them [Sat 9pm]: no\nMe [Sat 9pm]: something else entirely'
    expect(findOverlap(oneWord, [turn('me', 'yes no yes no')])).toBeNull()
  })

  test('ignores notes and coach lines, which no source can have said', () => {
    expect(findOverlap(log, [turn('context', 'she mentioned a sister who lives nearby')])).toBeNull()
    expect(findOverlap(log, [turn('coach', 'ask about the running, it is the open thread')])).toBeNull()
  })

  test('answers null when nothing resembles the record', () => {
    expect(findOverlap(log, [turn('me', 'a completely unrelated sentence about bicycles')])).toBeNull()
  })

  test('a one-line log can be all overlap, with nothing new below it', () => {
    const found = findOverlap('Them [Sun Aug 9, 11:00am]: oh nice, i run there sometimes', [
      turn('them', 'oh nice, i run there sometimes'),
    ])

    expect(found?.line).toBe(0)
    expect(found?.fresh).toBe(0)
  })

  test('answers null on an empty log or an empty record', () => {
    expect(findOverlap('', [turn('me', 'east coast, near the park')])).toBeNull()
    expect(findOverlap(log, [])).toBeNull()
  })

  test('anchors on the later of two identical lines', () => {
    const repeated = ['Me [Sat 9pm]: are you around this weekend', 'Them [Sat 9pm]: hey', 'Me [Sun 9am]: are you around this weekend', 'Them [Sun 10am]: yes'].join('\n')
    const found = findOverlap(repeated, [turn('me', 'are you around this weekend')])

    expect(found?.line).toBe(2)
    expect(found?.fresh).toBe(1)
  })
})
