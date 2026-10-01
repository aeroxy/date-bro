// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test'

import { describePhoto, PHOTO_TASK, readingRequest } from './photo'
import type { ImagePart } from '@/lib/llm-client'
import type { LLMConfig } from '@/types/settings'

const config: LLMConfig = {
  backend: 'openai',
  base_url: 'https://example.invalid/v1',
  model: 'vision-model',
  stream: false,
}

const slice = (n: number): ImagePart => ({ mediaType: 'image/jpeg', data: `SLICE${n}` })

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Runs `describePhoto` against a canned reply and hands back what went out. */
async function ask(images: ImagePart[], reply = '  A selfie beside a lake.  ') {
  const sent: string[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(String(init.body))
    return new Response(
      JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }),
    )
  }) as unknown as typeof fetch
  const description = await describePhoto(config, images)
  return {
    description,
    body: JSON.parse(sent[0]!) as {
      messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[]
      response_format?: unknown
    },
  }
}

describe('describePhoto', () => {
  test('sends the reader its task and the picture, and returns the description trimmed', async () => {
    const { description, body } = await ask([slice(1)])
    expect(description).toBe('A selfie beside a lake.')
    expect(body.messages[0]).toEqual({ role: 'system', content: PHOTO_TASK })
    expect(body.messages[1]!.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,SLICE1' } },
      { type: 'text', text: 'Describe this image.' },
    ])
  })

  test('sends every slice of a long screenshot, in order, ahead of the line that says they are one', async () => {
    const { body } = await ask([slice(1), slice(2), slice(3)])
    const parts = body.messages[1]!.content as { type: string; text?: string; image_url?: { url: string } }[]
    expect(parts.map((p) => p.type)).toEqual(['image_url', 'image_url', 'image_url', 'text'])
    expect(parts.slice(0, 3).map((p) => p.image_url!.url.split(',')[1])).toEqual([
      'SLICE1',
      'SLICE2',
      'SLICE3',
    ])
    expect(parts[3]!.text).toBe(readingRequest(3))
  })

  test('asks for prose, not the JSON object every other call in the app wants', async () => {
    expect((await ask([slice(1)])).body.response_format).toBeUndefined()
  })

  test('would rather fail than store an empty description', async () => {
    await expect(ask([slice(1)], '   ')).rejects.toThrow(/empty description/)
  })
})

describe('readingRequest', () => {
  test('is the plain ask for a single image', () => {
    expect(readingRequest(1)).toBe('Describe this image.')
  })

  test('says how many slices there are, and that they are one picture', () => {
    const text = readingRequest(5)
    expect(text).toContain('5')
    expect(text).toContain('slices')
    expect(text).toContain('one long screenshot')
  })
})
