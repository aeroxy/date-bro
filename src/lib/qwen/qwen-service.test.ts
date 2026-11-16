// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getQwenToken, sendQwenChat } from './qwen-service'

const realFetch = globalThis.fetch

/** A JWT-shaped token expiring `minutes` from now (negative: already expired). */
const jwt = (minutes: number) =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + minutes * 60 }))}.s`

let cookieToken: string
let requests: { url: string; headers: Record<string, string> }[]

/**
 * Stubs chat.qwen.ai and auth.qwen.ai. `completion` is the completions body;
 * `session` the chats/new body; the refresh hands out `refreshed`.
 */
function serveQwen({
  completion = sse({ phase: 'answer', content: 'hi' }),
  completionType = 'text/event-stream',
  session = JSON.stringify({ success: true, data: { id: 'chat-1' } }),
  refreshed = 'renewed-token',
} = {}) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    requests.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
    if (url.includes('/auths/refresh')) {
      return new Response(JSON.stringify({ success: true, data: { access_token: refreshed } }))
    }
    if (url.includes('/chats/new')) return new Response(session)
    return new Response(completion, { status: 200, headers: { 'content-type': completionType } })
  }) as typeof fetch
}

const sse = (...deltas: object[]) =>
  deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join('')

const completionHeaders = () => requests.find((r) => r.url.includes('/chat/completions'))!.headers

beforeEach(() => {
  requests = []
  cookieToken = 'jwt'
  ;(globalThis as { chrome?: unknown }).chrome = {
    cookies: {
      get: async ({ name }: { name: string }) => (name === 'token' ? { value: cookieToken } : null),
      set: async ({ name, value }: { name: string; value: string }) => {
        if (name === 'token') cookieToken = value
      },
    },
    storage: { local: { get: async () => ({ qwen_device_id: 'device-1' }) } },
    runtime: { getPlatformInfo: async () => ({}) },
    tabs: { query: async () => [] },
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as { chrome?: unknown }).chrome
})

describe('getQwenToken', () => {
  // Qwen's access tokens last 15 minutes and nothing renews the cookie we
  // cache, so trusting it unread sent Qwen a dead token on every call after.
  test('renews an expired cached token through auth.qwen.ai, and caches the new one', async () => {
    cookieToken = jwt(-5)
    serveQwen()
    expect(await getQwenToken()).toBe('renewed-token')
    expect(cookieToken).toBe('renewed-token')

    const refresh = requests.find((r) => r.url.includes('/auths/refresh'))!
    expect(refresh.url).toBe('https://auth.qwen.ai/api/v2/auths/refresh')
    // Without this one Qwen answers "Missing origin"; the cookie is the credential.
    expect(refresh.headers['x-request-origin']).toBe('https://chat.qwen.ai')
    expect(refresh.headers).not.toHaveProperty('authorization')
  })

  test('renews one about to lapse, and leaves one with life left alone', async () => {
    serveQwen()
    cookieToken = jwt(0.5)
    expect(await getQwenToken()).toBe('renewed-token')

    requests = []
    const live = jwt(10)
    cookieToken = live
    expect(await getQwenToken()).toBe(live)
    expect(requests).toHaveLength(0)
  })

  test('parallel callers share one renewal', async () => {
    cookieToken = jwt(-5)
    serveQwen()
    await Promise.all([getQwenToken(), getQwenToken(), getQwenToken()])
    expect(requests.filter((r) => r.url.includes('/auths/refresh'))).toHaveLength(1)
  })
})

describe('sendQwenChat', () => {
  // Qwen's 0.3.x frontend broke both of these: the old `Version` and a bare
  // `token` header each get the request refused.
  test('authenticates with a Bearer header, not the retired `token` header', async () => {
    serveQwen()
    await sendQwenChat([{ role: 'user', content: 'x' }])
    expect(completionHeaders().authorization).toBe('Bearer jwt')
    expect(completionHeaders()).not.toHaveProperty('token')
  })

  test('sends the renewed token, not the expired one', async () => {
    cookieToken = jwt(-5)
    serveQwen()
    await sendQwenChat([{ role: 'user', content: 'x' }])
    expect(completionHeaders().authorization).toBe('Bearer renewed-token')
  })

  // The anti-bot back-off is up to three 30s waits, longer than the minute of
  // life a token needs to pass the check, so a retry can't reuse the first one.
  test('a retry after the anti-bot back-off takes a live token, on the same chat', async () => {
    const first = jwt(1.5)
    cookieToken = first
    serveQwen()
    const served = globalThis.fetch
    let completions = 0
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (url.includes('/chat/completions') && completions++ === 0) {
        requests.push({ url, headers: init.headers as Record<string, string> })
        cookieToken = jwt(-1) // lapses during the back-off
        return new Response('{"ret":["FAIL_SYS_USER_VALIDATE"]}', { headers: { 'content-type': 'application/json' } })
      }
      return served(url, init)
    }) as typeof fetch

    // Skip the 30s back-off itself; every other timer keeps its real length.
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms?: number) =>
      realSetTimeout(fn, ms === 30_000 ? 0 : ms)) as typeof setTimeout
    try {
      expect(await sendQwenChat([{ role: 'user', content: 'x' }])).toBe('hi')
    } finally {
      globalThis.setTimeout = realSetTimeout
    }

    const attempts = requests.filter((r) => r.url.includes('/chat/completions'))
    expect(attempts.map((r) => r.headers.authorization)).toEqual([`Bearer ${first}`, 'Bearer renewed-token'])
    expect(new Set(attempts.map((r) => r.url)).size).toBe(1)
  })

  // The refusal arrives as a 200 with a JSON body. It used to finish as an
  // empty answer, which the caller then reported as unparseable JSON.
  test('rejects with Qwen\'s own words when it answers JSON instead of a stream', async () => {
    serveQwen({
      completion: '{"success":false,"data":{"code":"Bad_Request","details":"Internal error..."}}',
      completionType: 'application/json',
    })
    await expect(sendQwenChat([{ role: 'user', content: 'x' }])).rejects.toThrow('Bad_Request')
  })

  // Was "Failed to initialize a Qwen chat session." whatever the reason.
  test('says why when Qwen won\'t start a chat', async () => {
    serveQwen({
      session: '{"success":false,"data":{"code":"unauthorized","details":"Token has expired, please log in again."}}',
    })
    await expect(sendQwenChat([{ role: 'user', content: 'x' }])).rejects.toThrow('Token has expired')
  })

  test('still returns only the answer from a normal stream', async () => {
    serveQwen({
      completion:
        sse(
          { phase: 'thinking_summary', content: '', extra: { summary_title: { content: ['t'] } } },
          { phase: 'web_search', content: '' },
          { phase: 'answer', content: '{"ok":' },
          { phase: 'answer', content: 'true}' },
        ) + 'data: [DONE]\n\n',
    })
    expect(await sendQwenChat([{ role: 'user', content: 'x' }])).toBe('{"ok":true}')
  })
})
