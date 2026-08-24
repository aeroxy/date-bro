import { afterEach, describe, expect, test } from 'bun:test'

import { chatCompletion, chatCompletionWithTools } from './llm-client'
import {
  applyOpenAIChunk,
  finishOpenAIStream,
  newOpenAIStreamState,
  reasoningSoFar,
} from './openai-stream'

import type { LLMConfig } from '@/types/settings'

const chunk = (delta: object, finish_reason?: string) => ({
  choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }],
})

describe('applyOpenAIChunk', () => {
  test('content and reasoning accumulate on their own fields', () => {
    const state = newOpenAIStreamState()
    applyOpenAIChunk(state, chunk({ reasoning_content: 'weigh' }))
    applyOpenAIChunk(state, chunk({ reasoning_content: 'ing it' }))
    applyOpenAIChunk(state, chunk({ content: '{"a"' }))
    applyOpenAIChunk(state, chunk({ content: ':1}' }, 'stop'))
    expect(finishOpenAIStream(state)).toEqual({
      content: '{"a":1}',
      reasoning: 'weighing it',
      finish_reason: 'stop',
    })
  })

  test('growing reasoning is reported, so the caller can push without diffing', () => {
    const state = newOpenAIStreamState()
    expect(applyOpenAIChunk(state, chunk({ reasoning: 'hm' }))).toBe(true)
    expect(applyOpenAIChunk(state, chunk({ content: 'x' }))).toBe(false)
  })

  // A model with no reasoning field puts it in a <think> block. Worth streaming
  // for the same reason, so it is read out of the unclosed prefix as it grows.
  test('an unclosed <think> block streams as reasoning, then leaves the answer', () => {
    const state = newOpenAIStreamState()
    applyOpenAIChunk(state, chunk({ content: '<think>let me' }))
    expect(reasoningSoFar(state)).toBe('let me')
    applyOpenAIChunk(state, chunk({ content: ' check</think>{"a":1}' }))
    expect(finishOpenAIStream(state)).toEqual({ content: '{"a":1}', reasoning: 'let me check' })
  })

  test('tool-call fragments reassemble by index', () => {
    const state = newOpenAIStreamState()
    applyOpenAIChunk(state, chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_' } }] }))
    applyOpenAIChunk(state, chunk({ tool_calls: [{ index: 0, function: { name: 'search' } }] }))
    applyOpenAIChunk(state, chunk({ tool_calls: [{ index: 0, function: { arguments: '{"query"' } }] }))
    applyOpenAIChunk(state, chunk({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'read_page', arguments: '{}' } }] }))
    applyOpenAIChunk(state, chunk({ tool_calls: [{ index: 0, function: { arguments: ':"x"}' } }] }, 'tool_calls'))
    const { tool_calls } = finishOpenAIStream(state)
    expect(tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } },
      { id: 'c2', type: 'function', function: { name: 'read_page', arguments: '{}' } },
    ])
  })

  // Without this, a provider streaming one call and omitting `index` would get a
  // fresh call per fragment and its arguments shredded across all of them.
  test('a missing index means the one call being streamed', () => {
    const state = newOpenAIStreamState()
    applyOpenAIChunk(state, chunk({ tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"a"' } }] }))
    applyOpenAIChunk(state, chunk({ tool_calls: [{ function: { arguments: ':1}' } }] }))
    expect(finishOpenAIStream(state).tool_calls).toEqual([
      { id: 'c', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
    ])
  })

  test('a later null finish_reason does not erase the one that arrived', () => {
    const state = newOpenAIStreamState()
    applyOpenAIChunk(state, chunk({ content: 'x' }, 'length'))
    applyOpenAIChunk(state, { choices: [{ delta: {}, finish_reason: null }] })
    expect(finishOpenAIStream(state).finish_reason).toBe('length')
  })
})

// --- the wire ---------------------------------------------------------------

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const config: LLMConfig = {
  backend: 'openai',
  base_url: 'https://example.test/v1',
  model: 'm',
  max_tokens: 100,
  timeout: 5,
}

/** Captures the request and answers with an SSE body. */
function stubSSE(lines: string[]): { body: () => Record<string, unknown> } {
  let sent: Record<string, unknown> = {}
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string)
    const stream = new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(new TextEncoder().encode(`data: ${line}\n\n`))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return new Response(stream, { status: 200 })
  }) as typeof fetch

  return { body: () => sent }
}

describe('the OpenAI-compatible request', () => {
  test('asks for a stream, and the reasoning arrives before the answer does', async () => {
    const stub = stubSSE([
      JSON.stringify(chunk({ reasoning_content: 'thinking' })),
      JSON.stringify(chunk({ content: '{"ok":true}' }, 'stop')),
    ])
    const seen: string[][] = []
    const content = await chatCompletion(config, [{ role: 'user', content: 'hi' }], {
      onThinking: (t) => seen.push(t.thoughts),
    })
    expect(stub.body().stream).toBe(true)
    expect(content).toBe('{"ok":true}')
    expect(seen).toEqual([['thinking'], ['thinking']])
  })

  test('stream: false keeps the old single POST, and sends no stream flag', async () => {
    let sent: Record<string, unknown> = {}
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)
      return Response.json({
        choices: [{ message: { content: '{"ok":true}', reasoning_content: 'late' }, finish_reason: 'stop' }],
      })
    }) as typeof fetch
    const seen: string[][] = []
    const content = await chatCompletion({ ...config, stream: false }, [{ role: 'user', content: 'hi' }], {
      onThinking: (t) => seen.push(t.thoughts),
    })
    expect(sent.stream).toBeUndefined()
    expect(content).toBe('{"ok":true}')
    expect(seen).toEqual([['late']])
  })

  test('tool calls survive the stream', async () => {
    stubSSE([
      JSON.stringify(chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search' } }] })),
      JSON.stringify(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"query":"x"}' } }] }, 'tool_calls')),
    ])
    const result = await chatCompletionWithTools(config, [{ role: 'user', content: 'hi' }], {
      tools: [
        {
          type: 'function',
          function: { name: 'web_search', description: 'd', parameters: { type: 'object', properties: {} } },
        },
      ],
    })
    expect(result.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } },
    ])
  })

  // A server that ignores `stream` and answers with an ordinary JSON body used to
  // surface as "empty response", which points at the model rather than the setting.
  test('a provider that ignored the flag says which setting to turn off', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      })) as unknown as typeof fetch
    await expect(chatCompletion(config, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /Stream responses/,
    )
  })
})
