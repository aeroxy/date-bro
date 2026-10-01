// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { buildAnthropicBody, toAnthropicMessages } from './anthropic-messages'
import type { ChatMessage } from './llm-client'
import type { LLMConfig } from '@/types/settings'

const picture = { mediaType: 'image/jpeg', data: 'QUJD' }
const block = {
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
} as const

describe('a picture in a message', () => {
  test('becomes a base64 image block, ahead of the text that asks about it', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'Describe this image.', images: [picture] },
    ])
    expect(messages).toEqual([
      { role: 'user', content: [block, { type: 'text', text: 'Describe this image.' }] },
    ])
  })

  test('with nothing said about it is only the image — a blank text block is rejected', () => {
    const { messages } = toAnthropicMessages([{ role: 'user', content: '', images: [picture] }])
    expect(messages[0]!.content).toEqual([block])
  })

  test('keeps every image, in order', () => {
    const second = { mediaType: 'image/png', data: 'REVG' }
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'These two.', images: [picture, second] },
    ])
    expect(messages[0]!.content.map((b) => b.type)).toEqual(['image', 'image', 'text'])
  })

  test('leaves a message without one exactly as it was', () => {
    const plain: ChatMessage[] = [{ role: 'user', content: 'hello' }]
    expect(toAnthropicMessages(plain).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ])
  })

  test('reaches the request body, with the system prompt still hoisted out', () => {
    const config: LLMConfig = { backend: 'anthropic', base_url: 'https://x.invalid/v1', model: 'm' }
    const body = buildAnthropicBody(
      config,
      [
        { role: 'system', content: 'You read pictures.' },
        { role: 'user', content: 'Describe this image.', images: [picture] },
      ],
      { max_tokens: 100 },
    ) as { system: { text: string }[]; messages: { content: unknown[] }[] }
    expect(body.system[0]!.text).toBe('You read pictures.')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]!.content[0]).toEqual(block)
  })
})
