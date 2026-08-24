import { describe, expect, test } from 'bun:test'

import { mergeJSON, reasoningFrom, splitThinkBlock, withExtraBody } from './provider-dialect'

describe('mergeJSON', () => {
  test('nested objects merge, and the patch wins on a collision', () => {
    expect(mergeJSON({ a: { x: 1, y: 2 }, b: 3 }, { a: { y: 9, z: 4 } })).toEqual({
      a: { x: 1, y: 9, z: 4 },
      b: 3,
    })
  })

  // A request field that *is* a list means the whole list. Merging by index
  // would produce a value neither side asked for.
  test('arrays replace rather than merge', () => {
    expect(mergeJSON({ stop: ['a', 'b'] }, { stop: ['c'] })).toEqual({ stop: ['c'] })
  })

  test('neither input is mutated', () => {
    const base = { a: { x: 1 } }
    mergeJSON(base, { a: { x: 2 } })
    expect(base).toEqual({ a: { x: 1 } })
  })
})

describe('withExtraBody', () => {
  const body = () => ({ model: 'm', messages: [{ role: 'user' }], max_tokens: 100 })

  test('the user’s fields win over ours — the whole point of the setting', () => {
    expect(withExtraBody(body(), '{"max_tokens": 4096}').max_tokens).toBe(4096)
  })

  test('a nested field lands without flattening its siblings', () => {
    const merged = withExtraBody(
      { ...body(), reasoning: { exclude: false } },
      '{"reasoning": {"effort": "high"}}',
    )
    expect(merged.reasoning).toEqual({ exclude: false, effort: 'high' })
  })

  // These three *are* the request. Overriding one turns the call into a
  // different call, which fails as a silently wrong answer rather than an error.
  test('model, messages and stream are dropped, and the rest still applies', () => {
    const merged = withExtraBody(
      body(),
      '{"model": "other", "messages": [], "stream": true, "top_p": 0.5}',
    )
    expect(merged.model).toBe('m')
    expect(merged.messages).toEqual([{ role: 'user' }])
    expect(merged.stream).toBeUndefined()
    expect(merged.top_p).toBe(0.5)
  })

  // Same bargain as `withCustomHeaders`: a typo in an optional field must not
  // take down every call. Settings shows the parse error while it's typed.
  test('malformed or non-object input is ignored, not thrown', () => {
    expect(withExtraBody(body(), '{oops')).toEqual(body())
    expect(withExtraBody(body(), '[1,2]')).toEqual(body())
    expect(withExtraBody(body(), '"a string"')).toEqual(body())
    expect(withExtraBody(body(), '   ')).toEqual(body())
    expect(withExtraBody(body(), undefined)).toEqual(body())
  })
})

describe('splitThinkBlock', () => {
  test('the block comes off the front and is kept', () => {
    expect(splitThinkBlock('<think>weighing it up</think>\n{"a":1}')).toEqual({
      answer: '{"a":1}',
      thinking: 'weighing it up',
    })
  })

  test('content with no block is returned untouched', () => {
    expect(splitThinkBlock('{"a":1}')).toEqual({ answer: '{"a":1}' })
  })

  // Cut off mid-reasoning. The answer has to be empty rather than the
  // half-written thoughts, or parseJSON latches onto a brace inside them.
  test('an unclosed block yields no answer, but the thoughts survive', () => {
    expect(splitThinkBlock('<think>it got cut off {"a"')).toEqual({
      answer: '',
      thinking: 'it got cut off {"a"',
    })
  })
})

describe('reasoningFrom', () => {
  test('reads whichever field this provider chose', () => {
    expect(reasoningFrom({ reasoning_content: 'deepseek, vllm' })).toBe('deepseek, vllm')
    expect(reasoningFrom({ reasoning: 'openrouter' })).toBe('openrouter')
    expect(reasoningFrom({ reasoning_details: [{ text: 'one' }, { text: 'two' }] })).toBe(
      'one\n\ntwo',
    )
  })

  test('falls back to an inline block only when no field carried it', () => {
    expect(reasoningFrom({}, 'from a <think> block')).toBe('from a <think> block')
    expect(reasoningFrom({ reasoning_content: 'the field' }, 'the block')).toBe('the field')
  })

  test('nothing is nothing — an empty panel is worse than the last one', () => {
    expect(reasoningFrom({})).toBeUndefined()
    expect(reasoningFrom({ reasoning_content: '   ', reasoning: '' })).toBeUndefined()
    expect(reasoningFrom({ reasoning_details: [] })).toBeUndefined()
  })
})
