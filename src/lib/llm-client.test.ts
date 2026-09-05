// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test'

import { chatCompletion, wellFormed } from './llm-client'
import type { LLMConfig } from '@/types/settings'

/** A JSON escape for either half of a surrogate pair, alone on the wire. */
const LONE_ESCAPE = /\\u[dD][89a-fA-F]/

describe('wellFormed', () => {
  // Conversations imported before `clip` landed still carry an orphaned
  // surrogate in their stored log, so the repair has to happen on the way out
  // too — otherwise those chats 400 forever.
  test('drops a lone high surrogate anywhere in the body', () => {
    const body = { messages: [{ role: 'user', content: 'done its job \uD83D] and on' }] }
    const clean = wellFormed(body)
    expect(clean.messages[0]!.content).toBe('done its job ] and on')
    expect(JSON.parse(JSON.stringify(clean))).toEqual(clean)
    expect(JSON.stringify(clean)).not.toMatch(LONE_ESCAPE)
  })

  test('drops a lone low surrogate too', () => {
    expect(wellFormed('a\uDE83b')).toBe('ab')
    expect(JSON.stringify(wellFormed({ a: 'x\uDE83' }))).not.toMatch(LONE_ESCAPE)
  })

  test('leaves a whole emoji, and every non-string, untouched', () => {
    const body = { text: 'a 🚃 b', n: 4, ok: true, nil: null, list: ['🚃', 1] }
    expect(wellFormed(body)).toEqual(body)
  })

  test('leaves a non-plain object whole, so it keeps its own toJSON', () => {
    const date = new Date(0)
    expect(wellFormed({ at: date }).at).toBe(date)
  })
})

/**
 * The scrub is only worth anything if the send paths actually call it, and
 * that wiring is what silently regresses — `wellFormed` stays exported, correct
 * and tested while a deleted call site sends the orphan anyway.
 */
describe('the send paths scrub what they serialize', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const config = (over: Partial<LLMConfig> = {}): LLMConfig => ({
    backend: 'openai',
    base_url: 'https://example.invalid/v1',
    model: 'test-model',
    ...over,
  })

  // The real shape: a reply preview clipped mid-emoji, sitting in a user turn.
  const poisoned = [{ role: 'user' as const, content: '[re: done its job \uD83D] hey' }]

  const capture = (respond: () => Response) => {
    const sent: string[] = []
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(String(init.body))
      return respond()
    }) as unknown as typeof fetch
    return sent
  }

  test('postJSON sends no lone surrogate', async () => {
    const sent = capture(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })),
    )
    await chatCompletion(config({ stream: false }), poisoned)
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toMatch(LONE_ESCAPE)
    expect(sent[0]).toContain('[re: done its job ] hey')
  })

  // The Qwen payload never reaches `postJSON`: it crosses to the background
  // worker by structured clone, which carries a lone surrogate through intact,
  // and is serialized there. Hence its own call site, and its own test.
  test('the Qwen bridge hands the worker no lone surrogate', async () => {
    const seen: unknown[] = []
    const chrome = { runtime: { sendMessage: async (m: unknown) => (seen.push(m), { ok: true, result: 'ok' }) } }
    ;(globalThis as { chrome?: unknown }).chrome = chrome
    try {
      await chatCompletion(config({ backend: 'qwen-chat' }), poisoned)
    } finally {
      delete (globalThis as { chrome?: unknown }).chrome
    }
    expect(JSON.stringify(seen)).not.toMatch(LONE_ESCAPE)
    expect(JSON.stringify(seen)).toContain('[re: done its job ] hey')
  })

  test('postSSE sends no lone surrogate', async () => {
    const chunk = JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })
    const sent = capture(() => new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`))
    await chatCompletion(config(), poisoned)
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toMatch(LONE_ESCAPE)
  })
})
