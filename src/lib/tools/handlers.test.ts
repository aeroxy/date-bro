// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test'

import { capped, MAX_PAGE_CHARS, webSearch } from './handlers'

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
// The cap itself, not a copy of its current value: the two emoji cases below
// work by placing a surrogate pair exactly astride the cut, so a second
// spelling that drifted would leave them asserting nothing.
const MAX = MAX_PAGE_CHARS

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

/**
 * The bot-wall path, which is the only branch of `webSearch` with a decision in
 * it. DDG serves that page with a *success* status — 200 and 202 both observed —
 * so there is nothing in the status to catch and the detection is by content.
 * Worth a test because the failure mode is silent in both directions: miss the
 * page and the model gets handed a CAPTCHA as if it were search results, match
 * it too eagerly and a real result mentioning the phrase kills the search.
 */
const CHALLENGE = '<html><body><p>Unfortunately, bots use DuckDuckGo too.</p></body></html>'
const RESULTS = '<html><body><a class="result__a" href="https://example.com">A cafe</a></body></html>'

/** Stand in for `fetch` and the two `chrome.tabs` calls the wall path makes. */
function install(html: string, { status = 200, tabs = [] as { id?: number }[] } = {}) {
  const created: unknown[] = []
  const updated: unknown[] = []
  ;(globalThis as Record<string, any>).fetch = async () => new Response(html, { status })
  ;(globalThis as Record<string, any>).chrome = {
    tabs: {
      query: async () => tabs,
      create: async (opts: unknown) => void created.push(opts),
      update: async (id: number, opts: unknown) => void updated.push({ id, ...(opts as object) }),
    },
  }
  return { created, updated }
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as Record<string, any>).chrome
})

describe('webSearch', () => {
  test('opens the challenge tab in the background, never in front of the user', async () => {
    // A coach run searches several times, and stealing focus mid-answer
    // interrupts whatever the user was typing once per search.
    const { created } = install(CHALLENGE)

    await expect(webSearch('cafe singapore')).rejects.toThrow(/bot-verification/)
    expect(created).toEqual([
      { url: 'https://html.duckduckgo.com/html?q=cafe%20singapore', active: false },
    ])
  })

  test('reuses an open DuckDuckGo tab without activating it', async () => {
    const { created, updated } = install(CHALLENGE, { tabs: [{ id: 4 }] })

    await expect(webSearch('cafe singapore')).rejects.toThrow(/bot-verification/)
    expect(created).toEqual([]) // retries must not stack tabs
    expect(updated).toEqual([{ id: 4, url: 'https://html.duckduckgo.com/html?q=cafe%20singapore' }])
  })

  test('detects the wall behind a success status', async () => {
    // 202 is what DDG actually served in testing, and `res.ok` covers it — so
    // a status check alone would hand the model the CAPTCHA as results.
    const { created } = install(CHALLENGE, { status: 202 })

    await expect(webSearch('cafe singapore')).rejects.toThrow(/bot-verification/)
    expect(created).toHaveLength(1)
  })

  test('a real result page opens no tab', async () => {
    const { created, updated } = install(RESULTS)

    expect(await webSearch('cafe singapore')).toContain('A cafe')
    expect(created).toEqual([])
    expect(updated).toEqual([])
  })

  test('a hard error is not mistaken for the wall', async () => {
    // 403 has to stay a plain failure: no tab helps, since the request never
    // reached a page the user could clear.
    const { created } = install('nope', { status: 403 })

    await expect(webSearch('cafe singapore')).rejects.toThrow(/HTTP 403/)
    expect(created).toEqual([])
  })
})
