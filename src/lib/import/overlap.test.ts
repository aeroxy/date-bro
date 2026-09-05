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

// The logs below label with `Me`/`Them`, so the name only matters for the
// tests that check a name-labelled line resolves to them.
const find = (log: string, turns: Turn[], theirName = 'Sofi') =>
  findOverlap(log, turns, theirName)

const log = [
  'Them [Sat Aug 8, 8:59pm]: where in singapore are you',
  'Me [Sat Aug 8, 9:02pm]: east coast, near the park',
  'Them [Sat Aug 8, 9:10pm]: oh nice, i run there sometimes',
  'Me [Sun Aug 9, 10:54am]: we should go together then',
  'Them [Sun Aug 9, 11:00am]: haha maybe',
].join('\n')

describe('findOverlap', () => {
  test('finds an exact last turn and counts what is below it', () => {
    const found = find(log, [turn('them', 'oh nice, i run there sometimes')])

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
    const found = find(log, [turn('me', 'East Coast — near the park!')])

    expect(found?.line).toBe(1)
    expect(found?.score).toBe(1)
  })

  test('still matches when words were added or dropped', () => {
    // Typed from memory a week later: the gist survives, the wording doesn't.
    const found = find(log, [turn('me', 'east coast near the big park by the water')])

    expect(found?.line).toBe(1)
    expect(found?.score).toBeGreaterThanOrEqual(0.6)
    expect(found?.score).toBeLessThan(1)
  })

  test('matches through an aside the typed turn never had', () => {
    const withMedia = log.replace(
      'Me [Sat Aug 8, 9:02pm]: east coast, near the park',
      'Me [Sat Aug 8, 9:02pm]: [photo] east coast, near the park',
    )
    expect(find(withMedia, [turn('me', 'east coast, near the park')])?.line).toBe(1)
  })

  test('falls back to an earlier turn when the last one is not in the log', () => {
    // The newest recorded message was sent after the fetch window, or typed and
    // never sent — either way it is the turn before that marks the seam.
    const found = find(log, [
      turn('them', 'oh nice, i run there sometimes'),
      turn('me', 'something said later that this log does not contain at all'),
    ])

    expect(found?.line).toBe(2)
    expect(found?.back).toBe(1)
  })

  test('skips a turn too short to mean anything', () => {
    // "haha maybe" is the last line of the log, but anchoring on "ok" would
    // point at whichever line happened to score first.
    expect(find(log, [turn('me', 'ok')])).toBeNull()
  })

  test('a repeated word is not a fingerprint, however long the turn', () => {
    // Four "no"s used to score four shared words against a line that says "no"
    // once — a perfect match to a message that has nothing to do with it.
    const noisy = ['Them [Sat 9pm]: no way, really?', 'Me [Sat 9pm]: yes it happened', 'Them [Sat 9pm]: wild'].join('\n')
    expect(find(noisy, [turn('me', 'no no no no')])).toBeNull()
  })

  test('containment needs a substantial line, not a one-word one', () => {
    // "yes no yes no" contains "no", so a one-word line saying "no" used to
    // count as a 0.95 match. The line has to clear the same length bar the turn does.
    const oneWord = 'Them [Sat 9pm]: no\nMe [Sat 9pm]: something else entirely'
    expect(find(oneWord, [turn('me', 'yes no yes no')])).toBeNull()
  })

  test('the same words from the other person are not the seam', () => {
    // Both sides say it. Anchoring on her line would put the boundary at a turn
    // that was never the one recorded, and mark his as new.
    const both = [
      'Them [Sat Aug 8, 9:00pm]: see you tomorrow then',
      'Me [Sat Aug 8, 9:01pm]: see you tomorrow then',
      'Them [Sun Aug 9, 9:00am]: on my way',
    ].join('\n')

    expect(find(both, [turn('them', 'see you tomorrow then')])?.line).toBe(0)
    expect(find(both, [turn('me', 'see you tomorrow then')])?.line).toBe(1)
  })

  test('a line only the other speaker said is no match at all', () => {
    const hers = 'Them [Sat 9pm]: i booked the place for eight\nThem [Sat 9pm]: see you there'
    expect(find(hers, [turn('me', 'i booked the place for eight')])).toBeNull()
  })

  test('resolves a line labelled with their name, not just Them', () => {
    const named = 'Sofi [Sat 9pm]: i booked the place for eight\nMe [Sat 9pm]: perfect'
    expect(find(named, [turn('them', 'i booked the place for eight')])?.line).toBe(0)
  })

  test('an unlabelled continuation line is never the seam itself', () => {
    // The second line belongs to the message above it; the boundary is the line
    // that starts the turn.
    const wrapped = [
      'Them [Sat 9pm]: i booked the place for eight',
      'and asked for the corner table',
      'Me [Sat 9pm]: perfect',
    ].join('\n')

    expect(find(wrapped, [turn('them', 'i booked the place for eight')])?.line).toBe(0)
  })

  // A script written without spaces between words, where both of the gates that
  // guard the anchor were counting the wrong things.
  const zh = [
    'Me [Sat Sep 5, 9:00pm]: 明天下午三点在中央公园见面可以吗',
    'Them [Sat Sep 5, 9:02pm]: 可以的',
    'Them [Sat Sep 5, 9:02pm]: 不过',
    'Me [Sun Sep 6, 9:00am]: 那我们改到四点吧',
  ].join('\n')

  test('anchors on a Chinese turn, which carries no spaces to count', () => {
    // Every word gate that splits on spaces sees one "word" here however long
    // the sentence runs, and threw the turn out — leaving the seam on whichever
    // older message happened to contain a comma.
    const found = find(zh, [turn('me', '明天下午三点在中央公园见面可以吗')])

    expect(found?.line).toBe(0)
    expect(found?.score).toBe(1)
  })

  test('extends the seam through short trailing turns the anchor confirms', () => {
    // 可以的 and 不过 are far too short and too common to anchor anything, and
    // the seam used to stop above them — marking as new two messages the record
    // already had. Sitting exactly where the record says they do is the evidence
    // their text cannot supply.
    const found = find(zh, [
      turn('me', '明天下午三点在中央公园见面可以吗'),
      turn('them', '可以的'),
      turn('them', '不过'),
    ])

    expect(found?.line).toBe(2)
    expect(found?.back).toBe(0)
    expect(found?.fresh).toBe(1)
  })

  test('stops extending at the first turn the log does not contain', () => {
    const found = find(zh, [
      turn('me', '明天下午三点在中央公园见面可以吗'),
      turn('them', '可以的'),
      turn('them', '这句话在日志里根本不存在过'),
    ])

    // Confirmed one step, then nothing to confirm — so the seam holds there
    // rather than running on to a line that only happens to be nearby.
    expect(found?.line).toBe(1)
    expect(found?.back).toBe(1)
  })

  test('ignores notes and coach lines, which no source can have said', () => {
    expect(find(log, [turn('context', 'she mentioned a sister who lives nearby')])).toBeNull()
    expect(find(log, [turn('coach', 'ask about the running, it is the open thread')])).toBeNull()
  })

  test('answers null when nothing resembles the record', () => {
    expect(find(log, [turn('me', 'a completely unrelated sentence about bicycles')])).toBeNull()
  })

  test('a one-line log can be all overlap, with nothing new below it', () => {
    const found = find('Them [Sun Aug 9, 11:00am]: oh nice, i run there sometimes', [
      turn('them', 'oh nice, i run there sometimes'),
    ])

    expect(found?.line).toBe(0)
    expect(found?.fresh).toBe(0)
  })

  test('blank lines below the seam are not counted as new', () => {
    // A hand-pasted log with a blank line between every message: two messages
    // below the seam, not four lines.
    const spaced = log.split('\n').join('\n\n') + '\n'
    const found = find(spaced, [turn('them', 'oh nice, i run there sometimes')])

    expect(found?.line).toBe(4)
    expect(found?.fresh).toBe(2)
  })

  test('answers null on an empty log or an empty record', () => {
    expect(find('', [turn('me', 'east coast, near the park')])).toBeNull()
    expect(find(log, [])).toBeNull()
  })

  test('anchors on the later of two identical lines', () => {
    const repeated = ['Me [Sat 9pm]: are you around this weekend', 'Them [Sat 9pm]: hey', 'Me [Sun 9am]: are you around this weekend', 'Them [Sun 10am]: yes'].join('\n')
    const found = find(repeated, [turn('me', 'are you around this weekend')])

    expect(found?.line).toBe(2)
    expect(found?.fresh).toBe(1)
  })
})
