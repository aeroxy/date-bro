/**
 * Accumulator for an OpenAI-compatible `stream: true` response. Pure functions
 * only, the same split `anthropic-messages.ts` keeps: the fetch, the retries and
 * the idle timeout stay in `llm-client.ts` so all three backends share one
 * policy.
 *
 * A streamed response is assembled and *then* parsed, exactly as the
 * non-streamed one was — nothing downstream sees a partial JSON object. What
 * streaming buys is the two things a single POST cannot give: reasoning on
 * screen while the model is still working, and an idle timeout instead of a
 * total one, so a five-minute think is fine while a dead socket still fails.
 */
import { splitThinkBlock } from './provider-dialect'

import type { ToolCall } from './tools/types'

/** One `data:` chunk. Every field is optional — providers omit what they lack. */
export interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

export interface OpenAIStreamState {
  content: string
  reasoning: string
  /** Keyed by the `index` the provider assigns, which is the only stable handle
   * a fragment carries — `id` and `name` arrive once, `arguments` in pieces. */
  toolCalls: Map<number, { id: string; name: string; arguments: string }>
  finishReason?: string
  /** Whether any chunk at all was understood. A provider that ignored `stream`
   * and answered with a plain JSON body leaves this false, which is a different
   * failure from an empty answer and gets a different message. */
  sawChunk: boolean
}

export const newOpenAIStreamState = (): OpenAIStreamState => ({
  content: '',
  reasoning: '',
  toolCalls: new Map(),
  sawChunk: false,
})

/**
 * The reasoning to show right now: the provider's own field when it sent one,
 * and otherwise the inside of an unclosed `<think>` block at the head of the
 * content — which is where a model with no such field puts it, and is worth
 * streaming for exactly the same reason.
 */
export function reasoningSoFar(state: OpenAIStreamState): string {
  if (state.reasoning.trim()) return state.reasoning.trim()
  return splitThinkBlock(state.content).thinking ?? ''
}

/**
 * Fold one chunk in. Returns whether the *visible reasoning* grew, so the caller
 * can push a UI update without diffing — the same contract
 * `applyAnthropicStreamEvent` has.
 */
export function applyOpenAIChunk(state: OpenAIStreamState, chunk: OpenAIStreamChunk): boolean {
  const choice = chunk.choices?.[0]
  if (!choice) return false
  state.sawChunk = true
  const before = reasoningSoFar(state)

  const delta = choice.delta
  if (typeof delta?.content === 'string') state.content += delta.content
  if (typeof delta?.reasoning_content === 'string') state.reasoning += delta.reasoning_content
  else if (typeof delta?.reasoning === 'string') state.reasoning += delta.reasoning

  for (const fragment of delta?.tool_calls ?? []) {
    // Absent index means a provider streaming one call at a time; 0 is then the
    // only slot it could mean, and treating it as a fresh call each fragment
    // would shred the arguments into one call per token.
    const index = fragment.index ?? 0
    const call = state.toolCalls.get(index) ?? { id: '', name: '', arguments: '' }
    if (fragment.id) call.id = fragment.id
    if (fragment.function?.name) call.name += fragment.function.name
    if (fragment.function?.arguments) call.arguments += fragment.function.arguments
    state.toolCalls.set(index, call)
  }

  // Kept from whichever chunk carried one — it is the last chunk in practice,
  // and a later null must not erase it.
  if (choice.finish_reason) state.finishReason = choice.finish_reason

  return reasoningSoFar(state) !== before
}

/**
 * The assembled response, in the shape the non-streaming path returns, so
 * everything downstream is identical either way. The `<think>` block comes off
 * the content here rather than per chunk: it can only be split once its closing
 * tag has arrived.
 */
export function finishOpenAIStream(state: OpenAIStreamState): {
  content: string
  tool_calls?: ToolCall[]
  reasoning?: string
  finish_reason?: string
} {
  const { answer, thinking } = splitThinkBlock(state.content)
  const reasoning = state.reasoning.trim() || thinking?.trim()
  // Ordered by index, not by insertion: a provider is free to interleave
  // fragments, and the agent loop pairs results back positionally.
  const tool_calls: ToolCall[] = [...state.toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, call]) => call.name)
    .map(([, call], i) => ({
      // An id is required downstream to match a result to its call, and some
      // providers stream the name and arguments without ever sending one.
      id: call.id || `call_${i}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments || '{}' },
    }))

  return {
    content: answer,
    ...(tool_calls.length ? { tool_calls } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(state.finishReason ? { finish_reason: state.finishReason } : {}),
  }
}
