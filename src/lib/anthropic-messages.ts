// Translation between our OpenAI-shaped ChatMessage / ToolDefinition types and
// Anthropic's Messages API (`POST {base_url}/messages`). Pure functions only —
// the fetch, retry, and error handling stay in llm-client.ts, so all three
// backends share one policy.

import type { ChatMessage, JsonSchemaSpec } from './llm-client'
import type { ToolCall, ToolDefinition } from './tools/types'
import type { LLMConfig } from '@/types/settings'

export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * The default 5-minute TTL. Writes cost 1.25x base input, reads 0.1x, so a
 * breakpoint pays for itself on its second read — there is no free tier here
 * (that's the OpenAI side, where prefix caching is automatic and unpriced).
 */
const EPHEMERAL = { type: 'ephemeral' } as const

type RequestBlock =
  | { type: 'text'; text: string; cache_control?: typeof EPHEMERAL }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface RequestMessage {
  role: 'user' | 'assistant'
  content: RequestBlock[]
}

/** Only the response fields we read. Unknown block types are ignored. */
export interface AnthropicResponse {
  content?: Array<{
    type: string
    text?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
  }>
  stop_reason?: string | null
  stop_details?: { category?: string | null; explanation?: string | null } | null
}

export interface AnthropicBodyOptions {
  max_tokens: number
  temperature?: number
  /** Strict server-side JSON. Only pass it when the model supports it. */
  jsonSchema?: JsonSchemaSpec
  tools?: ToolDefinition[]
  tool_choice?: 'auto' | 'required' | 'none'
  /** SSE. Always on in practice — see llm-client's `postSSE`. */
  stream?: boolean
  /**
   * Ask for a readable summary of the model's reasoning. Opt-in, because
   * `display` only exists inside a `thinking` config: sending one turns thinking
   * *on* for models where it defaults off (Opus 4.8/4.7), and models that never
   * had adaptive thinking (Haiku 4.5) reject it with a 400.
   */
  thinkingSummary?: boolean
}

export interface AnthropicReadResult {
  content: string
  tool_calls?: ToolCall[]
  stopReason?: string | null
  /** Category / explanation from `stop_details`, when the request was declined. */
  refusalDetail?: string
}

/**
 * Our flat ChatMessage list → Anthropic's `system` + `messages`.
 *
 * Three shape differences to bridge: system turns are hoisted out (Anthropic
 * takes them as a top-level field), `tool` turns become `tool_result` blocks on
 * a *user* turn, and assistant `tool_calls` become `tool_use` blocks. Turns with
 * the same role are merged, which is what puts a whole round of parallel tool
 * results into one user turn — splitting them teaches the model to stop calling
 * tools in parallel.
 */
export function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string
  messages: RequestMessage[]
} {
  const system: string[] = []
  const out: RequestMessage[] = []

  const append = (role: RequestMessage['role'], blocks: RequestBlock[]) => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last?.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) system.push(message.content)
      continue
    }

    if (message.role === 'tool') {
      append('user', [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id ?? '',
          // An empty block is rejected, and "no output" is itself the result.
          content: message.content || '(no output)',
        },
      ])
      continue
    }

    const blocks: RequestBlock[] = []
    if (message.segments?.length) {
      // One block per stratum, so a `cache_control` marker can sit at the
      // boundary between what's stable and what isn't. A single block would
      // key the cache on the volatile tail and never read back.
      for (const segment of message.segments) {
        if (!segment.text.trim()) continue
        blocks.push({
          type: 'text',
          text: segment.text,
          ...(segment.cache ? { cache_control: EPHEMERAL } : {}),
        })
      }
    } else if (message.content.trim()) {
      blocks.push({ type: 'text', text: message.content })
    }
    for (const call of message.tool_calls ?? []) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: toolInput(call) })
    }
    append(message.role, blocks)
  }

  return { system: system.length ? system.join('\n\n') : undefined, messages: out }
}

export function buildAnthropicBody(
  config: LLMConfig,
  messages: ChatMessage[],
  options: AnthropicBodyOptions,
): Record<string, unknown> {
  const { system, messages: converted } = toAnthropicMessages(messages)

  // max_tokens is required by this API, not optional as on the OpenAI side.
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: options.max_tokens,
    messages: converted,
  }
  if (system) body.system = system
  // Omitted when unset so the provider's default applies. Recent Claude models
  // (Opus 5, Sonnet 5, Opus 4.7+) reject an explicit temperature outright, and
  // *any* model rejects one alongside thinking — that pairing (a temperature
  // set once, "show reasoning" left on) otherwise 400s every single call.
  if (options.temperature !== undefined && !options.thinkingSummary) {
    body.temperature = options.temperature
  }

  if (options.stream) body.stream = true
  // Thinking is left unset otherwise: that keeps every model and proxy happy,
  // and on Opus 5 it still thinks (adaptive is the default there) — it just
  // doesn't hand us the summary.
  if (options.thinkingSummary) body.thinking = { type: 'adaptive', display: 'summarized' }

  if (options.jsonSchema) {
    body.output_config = {
      format: { type: 'json_schema', schema: options.jsonSchema.schema },
    }
  }

  if (options.tools?.length) {
    body.tools = options.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }))
    body.tool_choice = { type: TOOL_CHOICE[options.tool_choice ?? 'auto'] }
  }

  return body
}

const TOOL_CHOICE = { auto: 'auto', required: 'any', none: 'none' } as const

/**
 * Response content blocks → the OpenAI-shaped result the agent loop expects.
 * `tool_use` blocks are re-serialised as `tool_calls` so `lib/agent.ts` and the
 * `provide_verdict` channel work unchanged across backends.
 */
export function readAnthropicResponse(data: AnthropicResponse): AnthropicReadResult {
  const blocks = data.content ?? []

  const content = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')

  const tool_calls: ToolCall[] = blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: block.id ?? crypto.randomUUID(),
      type: 'function' as const,
      function: { name: block.name ?? '', arguments: JSON.stringify(block.input ?? {}) },
    }))

  const detail = [data.stop_details?.category, data.stop_details?.explanation]
    .filter((part): part is string => !!part)
    .join(': ')

  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    stopReason: data.stop_reason,
    refusalDetail: detail || undefined,
  }
}

/** Tool arguments reach us as a JSON string; this API wants the object. */
function toolInput(call: ToolCall): Record<string, unknown> {
  return asObject(call.function.arguments)
}

/**
 * Malformed or truncated JSON becomes `{}` rather than dropping the call: the
 * transcript still lines up with its `tool_result`, and the handler's own
 * "requires a non-empty query" error goes back to the model as something it can
 * act on. Dropping the block would strand the tool_use with no result.
 */
function asObject(json: string): Record<string, unknown> {
  if (!json.trim()) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  return {}
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** The SSE event fields we act on. Everything else (`ping`, usage) is ignored. */
export interface AnthropicStreamEvent {
  type?: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    partial_json?: string
    stop_reason?: string | null
    stop_details?: AnthropicResponse['stop_details']
  }
}

interface StreamBlock {
  type: string
  id?: string
  name?: string
  /** Text or thinking, whichever this block carries. */
  text: string
  /** `input_json_delta` fragments for a tool_use block, concatenated. */
  json: string
}

export interface AnthropicStreamState {
  blocks: StreamBlock[]
  stopReason?: string | null
  stopDetails?: AnthropicResponse['stop_details']
  /** Every thinking block so far, joined — replace-state for the UI. */
  thinking: string
}

export function newAnthropicStreamState(): AnthropicStreamState {
  return { blocks: [], thinking: '' }
}

/**
 * Folds one SSE event into `state`. Returns true when the reasoning summary
 * grew, so the caller can push it to the UI without diffing.
 *
 * Streamed tool calls are the reason this exists: a `tool_use` block's arguments
 * arrive as `input_json_delta` fragments that are only valid JSON once
 * concatenated, so nothing can be interpreted until the stream ends.
 */
export function applyAnthropicStreamEvent(
  state: AnthropicStreamState,
  event: AnthropicStreamEvent,
): boolean {
  switch (event.type) {
    case 'content_block_start': {
      state.blocks[event.index ?? state.blocks.length] = {
        type: event.content_block?.type ?? 'text',
        id: event.content_block?.id,
        name: event.content_block?.name,
        text: '',
        json: '',
      }
      return false
    }

    case 'content_block_delta': {
      const block = state.blocks[event.index ?? 0]
      if (!block) return false
      switch (event.delta?.type) {
        case 'text_delta':
          block.text += event.delta.text ?? ''
          return false
        case 'thinking_delta':
          block.text += event.delta.thinking ?? ''
          state.thinking = joinThinking(state)
          return true
        case 'input_json_delta':
          block.json += event.delta.partial_json ?? ''
          return false
        default:
          // signature_delta and anything newer: nothing for us to accumulate.
          return false
      }
    }

    case 'message_delta': {
      if (event.delta?.stop_reason !== undefined) state.stopReason = event.delta.stop_reason
      if (event.delta?.stop_details !== undefined) state.stopDetails = event.delta.stop_details
      return false
    }

    default:
      return false
  }
}

/**
 * Collapses the accumulated stream into the same shape a non-streaming response
 * has, so `readAnthropicResponse` stays the only place that interprets a reply.
 */
export function finishAnthropicStream(state: AnthropicStreamState): AnthropicResponse {
  return {
    content: state.blocks.filter(Boolean).map((block) =>
      block.type === 'tool_use'
        ? { type: block.type, id: block.id, name: block.name, input: asObject(block.json) }
        : // Non-text types (thinking, redacted_thinking) pass through here too;
          // readAnthropicResponse only ever reads `text` and `tool_use` blocks.
          { type: block.type, text: block.text },
    ),
    stop_reason: state.stopReason,
    stop_details: state.stopDetails,
  }
}

function joinThinking(state: AnthropicStreamState): string {
  return state.blocks
    .filter((block) => block?.type === 'thinking' && block.text)
    .map((block) => block.text)
    .join('\n\n')
}
