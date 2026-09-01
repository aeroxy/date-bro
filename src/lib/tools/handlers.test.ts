// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { capped } from './handlers'

/**
 * The page cap, and specifically its surrogate trim.
 *
 * The same bug — a `slice` that cuts through an emoji's surrogate pair, leaving
 * a half that `JSON.stringify` emits as a lone `\ud83d` and strict parsers
 * reject — has three fix sites in this codebase, and this was the one without a
 * test. It reads like a `replace` that does nothing, which is exactly why it
 * needs one: the failure it prevents is a 400 on the whole request, not on the
 * one character, and it only shows up on pages long enough to be cut.
 */
const MAX = 100_000

describe('capped', () => {
  test('returns a short page untouched', () => {
    expect(capped('hello', false)).toBe('hello')
  })

  test('marks a page that was truncated upstream even when it is short', () => {
    const out = capped('hello', true)
    expect(out).toStartWith('hello')
    expect(out).toContain('[Truncated:')
  })

  test('never cuts through an emoji', () => {
    // The pair straddles the cap: the low half is the first character dropped.
    const page = 'a'.repeat(MAX - 1) + '😀' + 'b'.repeat(50)
    const out = capped(page, false)

    expect(out).toContain('[Truncated:')
    // Nothing unpaired survives — this is the assertion the bare slice fails.
    expect(/[\uD800-\uDFFF]/.test(out)).toBe(false)
    expect(out.slice(0, MAX - 1)).toBe('a'.repeat(MAX - 1))
    // What actually goes on the wire. JS itself round-trips a lone surrogate
    // happily, so the round trip proves nothing — the lone `\udXXX` escape in
    // the serialised bytes is the thing serde_json refuses.
    expect(JSON.stringify({ out })).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i)
  })

  test('keeps an emoji that fits whole', () => {
    const page = 'a'.repeat(MAX - 2) + '😀' + 'b'.repeat(50)
    expect(capped(page, false)).toContain('😀')
  })
})
