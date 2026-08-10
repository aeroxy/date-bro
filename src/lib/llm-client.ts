import { jsonrepair } from 'jsonrepair'

import {
  ANTHROPIC_VERSION,
  applyAnthropicStreamEvent,
  buildAnthropicBody,
  finishAnthropicStream,
  newAnthropicStreamState,
  readAnthropicResponse,
  type AnthropicBodyOptions,
  type AnthropicStreamEvent,
} from './anthropic-messages'
import { normalizeQwenModel } from './qwen/qwen-service'
import type { ThinkingSummary } from '@/types/coach'
import type { LLMConfig } from '@/types/settings'
import type { ChatCompletionWithToolsResult, ToolCall, ToolDefinition } from './tools/types'

/**
 * One stratum of a turn, ordered slowest-changing first. `cache` marks the end
 * of a prefix worth caching — see `layeredUser`.
 */
export interface ContentSegment {
  text: string
  cache?: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /**
   * The same text as `content`, split at its mutation-rate boundaries. Only the
   * Anthropic path reads it (one `text` block per segment, `cache_control` on
   * the marked ones); every other backend uses the flattened `content` and gets
   * the identical bytes, which is all OpenAI's automatic prefix caching needs.
   */
  segments?: ContentSegment[]
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

/**
 * A user turn built from strata. `content` is derived here rather than passed
 * in, so the flattened string and the segmented one cannot drift apart.
 */
export function layeredUser(segments: ContentSegment[]): ChatMessage {
  const kept = segments.filter((s) => s.text.trim())
  return { role: 'user', content: kept.map((s) => s.text).join('\n\n'), segments: kept }
}

/** Drop fields the OpenAI wire format doesn't know about. */
function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map(({ role, content, tool_call_id, tool_calls }) => ({
    role,
    content,
    ...(tool_call_id ? { tool_call_id } : {}),
    ...(tool_calls ? { tool_calls } : {}),
  }))
}

interface ChatCompletionResponse {
  choices: Array<{
    message: { content: string; tool_calls?: ToolCall[] }
    finish_reason: string
  }>
}

/** JSON Schema passed to providers that support OpenAI's strict json_schema. */
export interface JsonSchemaSpec {
  name: string
  schema: Record<string, unknown>
}

export interface CompletionOptions {
  temperature?: number
  max_tokens?: number
  signal?: AbortSignal
  /** Strict server-side structured output. Ignored by the Qwen backend. */
  jsonSchema?: JsonSchemaSpec
  /**
   * The model's reasoning summary as it streams, so the UI has something to show
   * during a long think. Each call replaces the last. Fired by Qwen, and by the
   * Anthropic backend when the profile opts into `anthropic_thinking`; never by
   * the OpenAI backend, which we don't stream.
   */
  onThinking?: (thinking: ThinkingSummary) => void
  /**
   * A stable identity for this conversation, sent as `x-claude-code-session-id`
   * on the Anthropic path. Pass `record.id` — immutable for the life of a
   * record, which is exactly the property needed.
   *
   * This exists because prompt cache entries are partitioned by session, and a
   * session id that churns means every request writes a fresh entry and reads
   * nothing. claude-proxy (github.com/aeroxy/claude-proxy) derives one from the
   * *first user message* when
   * the client doesn't send this header (`disguise::session_id`), and its
   * `first_user_text` joins every content block of `messages[0]` — which for us
   * is the entire prompt, transcript and timestamp included. So the derived id
   * changed on every single call, and a byte-identical system block was still
   * read 0 times. Sending our own id short-circuits the derivation.
   *
   * Harmless against api.anthropic.com directly, which ignores headers it
   * doesn't know.
   */
  sessionId?: string
}

// Deliberately generous: reasoning models count reasoning_content against
// max_tokens, so a tight budget gets fully consumed thinking and returns empty
// content with finish_reason 'length'.
const DEFAULT_MAX_TOKENS = 8192

/**
 * Two ways a budget runs out, and the partial case is the one that used to get
 * through. A response cut off *mid-object* still has content, so every check
 * here passed it along; `jsonrepair` then closed the dangling braces into a
 * perfectly valid object with its trailing fields missing, and validation
 * complained about whatever happened to be last in the shape — pointing at a
 * field the model never had trouble with.
 *
 * Found while chasing a different bug that turned out not to be this one (that
 * was `open_questions` colliding with a profile section — see
 * `PERSON_SECTIONS`). Latent rather than observed, but it fails in exactly the
 * way that costs the most time: silently, and by blaming the wrong thing.
 */
function truncatedMessage(maxTokens: number, partial = false): string {
  return partial
    ? `Response was cut off at max_tokens (${maxTokens}) partway through, so only part of the JSON arrived. Raise "Max tokens" in settings.`
    : `Response was cut off at max_tokens (${maxTokens}) before any output — reasoning models spend this budget thinking first. Raise "Max tokens" in settings.`
}

/**
 * Some reasoning models emit chain-of-thought inline as a leading <think> block
 * instead of a separate field. Strip it so JSON parsing sees only the answer.
 * A block with no closing tag means the response was cut off mid-reasoning —
 * return '' rather than the half-written thoughts, or parseJSON's `{…}` regex
 * latches onto a brace inside the reasoning and yields garbage that parses.
 */
export function stripThinkBlock(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('<think>')) return content
  const close = trimmed.indexOf('</think>')
  if (close === -1) return ''
  return trimmed.slice(close + '</think>'.length).trimStart()
}

export async function chatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  options: CompletionOptions = {},
): Promise<string> {
  if (config.backend === 'qwen-chat') return qwenCompletion(config, messages, options)
  if (config.backend === 'anthropic') return anthropicCompletion(config, messages, options)
  return openAICompletion(config, messages, options)
}

/**
 * Qwen borrows the user's live chat.qwen.ai session, which needs
 * `chrome.cookies` and `chrome.declarativeNetRequest` to rewrite Origin/Referer.
 * Those work from any extension context, but the request itself is long-running
 * and the background worker is the one place with a keep-alive, so the app page
 * always bridges rather than fetching directly.
 */
async function qwenCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  options: CompletionOptions,
): Promise<string> {
  const requestId = crypto.randomUUID()
  const payload = {
    type: 'QWEN_CHAT_REQUEST',
    requestId,
    messages: messages.map(({ role, content }) => ({ role, content })),
    qwenModel: normalizeQwenModel(config.qwenModel),
  }

  if (options.signal?.aborted) throw abortError()

  // Registered before the request goes out, so no early reasoning is missed.
  const stopListening = listenForQwenThinking(requestId, options.onThinking)

  try {
    const send = chrome.runtime.sendMessage(payload)
    if (!options.signal) return unwrapQwen(await send)

    // Once the abort promise wins the race below, nothing is awaiting `send` any
    // more — and it will usually reject (the worker tore the request down). Mark
    // it handled so cancelling doesn't log an unhandled rejection every time.
    send.catch(() => {})

    const signal = options.signal
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        chrome.runtime.sendMessage({ type: 'QWEN_CHAT_CANCEL', requestId }).catch(() => {})
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort)
    })

    try {
      return unwrapQwen(await Promise.race([send, aborted]))
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  } finally {
    stopListening()
  }
}

/**
 * Reasoning summaries come back as background broadcasts rather than on the
 * response, since sendResponse only fires once. Filtered by requestId so two
 * concurrent calls can't cross-talk.
 */
function listenForQwenThinking(
  requestId: string,
  onThinking?: (thinking: ThinkingSummary) => void,
): () => void {
  if (!onThinking) return () => {}
  const listener = (message: { type?: string; requestId?: string; thinking?: ThinkingSummary }) => {
    if (message?.type === 'QWEN_CHAT_THINKING' && message.requestId === requestId && message.thinking) {
      onThinking(message.thinking)
    }
  }
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}

function unwrapQwen(resp: { ok?: boolean; result?: string; error?: string; isAbort?: boolean } | undefined): string {
  if (resp?.ok) return stripThinkBlock(resp.result ?? '')
  if (resp?.isAbort) throw abortError()
  throw new Error(resp?.error || 'Qwen request failed — is the background worker alive?')
}

async function openAICompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  options: CompletionOptions,
): Promise<string> {
  const max_tokens = resolveMaxTokens(config, options.max_tokens)
  const temperature = options.temperature ?? config.temperature

  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAIMessages(messages),
    max_tokens,
  }
  // Omitted entirely when unset so the provider applies its own default — some
  // reasoning models reject an explicit temperature.
  if (temperature !== undefined) body.temperature = temperature

  if (options.jsonSchema && config.structured_output) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema, strict: true },
    }
  } else {
    body.response_format = { type: 'json_object' }
  }

  const data = await postJSON<ChatCompletionResponse>(`${resolveEndpoint(config)}/chat/completions`, {
    headers: withCustomHeaders(bearerHeaders(config), config.custom_headers),
    body,
    timeoutMs: resolveTimeout(config),
    signal: options.signal,
  })

  const choice = data.choices?.[0]
  const content = choice?.message?.content
  if (!content) {
    if (choice?.finish_reason === 'length') throw new Error(truncatedMessage(max_tokens))
    throw new Error('LLM returned an empty response')
  }
  // Cut off with content already emitted. Half a JSON object is not a cheaper
  // version of the answer — it's a broken one that parses.
  if (choice?.finish_reason === 'length') throw new Error(truncatedMessage(max_tokens, true))
  return stripThinkBlock(content)
}

async function anthropicCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  options: CompletionOptions,
): Promise<string> {
  const { content } = await anthropicRequest(
    config,
    messages,
    {
      max_tokens: resolveMaxTokens(config, options.max_tokens),
      temperature: options.temperature ?? config.temperature,
      jsonSchema: config.structured_output ? options.jsonSchema : undefined,
    },
    options.signal,
    options.onThinking,
    options.sessionId,
  )
  return content
}

/**
 * Anthropic Messages path: POSTs `{base_url}/messages`. Same bring-your-own-key
 * shape as the OpenAI path, so the API itself, a gateway, or a local proxy all
 * work — only the wire format differs, and `anthropic-messages.ts` translates
 * it.
 *
 * Always streams, for two reasons that hold even when nobody is watching the
 * reasoning: the timeout becomes idle-based rather than total (a full transcript
 * at high effort can outlast any sane wall-clock limit), and it's the only way
 * to surface a summary while the model is still thinking.
 */
async function anthropicRequest(
  config: LLMConfig,
  messages: ChatMessage[],
  bodyOptions: AnthropicBodyOptions,
  signal?: AbortSignal,
  onThinking?: (thinking: ThinkingSummary) => void,
  sessionId?: string,
): Promise<ChatCompletionWithToolsResult> {
  const headers: Record<string, string> = {
    'anthropic-version': ANTHROPIC_VERSION,
    // api.anthropic.com refuses browser-origin requests without this opt-in;
    // endpoints that don't check for it ignore it.
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  if (config.api_key) headers['x-api-key'] = config.api_key
  // Sent whenever we have one — see `CompletionOptions.sessionId`. A proxy that
  // reads it stops deriving an id from the prompt (which changes every call);
  // anything that doesn't recognise it ignores it.
  if (sessionId) headers['x-claude-code-session-id'] = sessionId

  // No point asking for the summary when nothing is listening — it turns
  // thinking on for models that default it off, and costs tokens to produce.
  const wantsThinking = !!onThinking && config.anthropic_thinking === true

  const state = newAnthropicStreamState()
  await postSSE(
    `${resolveEndpoint(config)}/messages`,
    {
      headers: withCustomHeaders(headers, config.custom_headers),
      body: buildAnthropicBody(config, messages, {
        ...bodyOptions,
        stream: true,
        thinkingSummary: wantsThinking,
      }),
      timeoutMs: resolveTimeout(config),
      signal,
    },
    (event) => {
      if (event.type === 'error') {
        const error = (event as { error?: { type?: string; message?: string } }).error
        throw new Error(`LLM API error (${error?.type ?? 'stream'}): ${error?.message ?? 'unknown'}`)
      }
      // Anthropic summarises without headings, so it fills `thoughts` and leaves
      // `titles` empty — the panel falls back to tool activity for its steps.
      if (applyAnthropicStreamEvent(state, event) && onThinking) {
        onThinking({ titles: [], thoughts: [state.thinking] })
      }
    },
  )

  const { content, tool_calls, stopReason, refusalDetail } = readAnthropicResponse(
    finishAnthropicStream(state),
  )
  if (stopReason === 'refusal') {
    throw new Error(`The model declined this request${refusalDetail ? ` (${refusalDetail})` : ''}.`)
  }

  const text = stripThinkBlock(content)
  if (!text && !tool_calls) {
    if (stopReason === 'max_tokens') throw new Error(truncatedMessage(bodyOptions.max_tokens))
    throw new Error('LLM returned an empty response')
  }
  // See the note on `truncatedMessage`: a partial answer parses and then fails
  // validation on whatever happened to be last in the shape, which sends the
  // caller looking in the wrong place entirely.
  if (stopReason === 'max_tokens') throw new Error(truncatedMessage(bodyOptions.max_tokens, true))
  return { content: text, tool_calls }
}

function resolveEndpoint(config: LLMConfig): string {
  const baseUrl = config.base_url.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('No base URL configured. Open Settings.')
  if (!config.model.trim()) throw new Error('No model configured. Open Settings.')
  return baseUrl
}

function resolveMaxTokens(config: LLMConfig, override?: number): number {
  return override ?? config.max_tokens ?? DEFAULT_MAX_TOKENS
}

function resolveTimeout(config: LLMConfig): number {
  return (config.timeout ?? 120) * 1000
}

function bearerHeaders(config: LLMConfig): Record<string, string> {
  return config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}
}

/**
 * Settings warns that anything but a JSON object of string values is ignored, so
 * this has to ignore exactly that much — parsing alone would merge array indices
 * and non-string values the user was told wouldn't be sent. Keep in step with
 * `headersProblem` in SettingsModal.
 */
function withCustomHeaders(
  base: Record<string, string>,
  custom?: string,
): Record<string, string> {
  if (!custom) return base
  let parsed: unknown
  try {
    parsed = JSON.parse(custom)
  } catch {
    /* malformed custom headers — ignore rather than block the call */
    return base
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
  const entries = Object.entries(parsed)
  if (entries.some(([, v]) => typeof v !== 'string')) return base
  return { ...base, ...(Object.fromEntries(entries) as Record<string, string>) }
}

interface PostJSONOptions {
  headers: Record<string, string>
  body: unknown
  timeoutMs: number
  signal?: AbortSignal
}

const RETRY_DELAYS = [3000, 10000]
const RETRYABLE_STATUS = [429, 500, 502, 503, 504]

/**
 * The one HTTP path every keyed backend shares. Retries `[3s, 10s]` on 429/5xx
 * and on transient network/timeout errors; never on a user abort, and never on
 * an error a caller threw itself.
 */
async function postJSON<T>(url: string, options: PostJSONOptions): Promise<T> {
  const { headers, body, timeoutMs, signal } = options
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const canRetry = attempt < RETRY_DELAYS.length
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      timeoutMs,
    )

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      })
      // Timer deliberately still armed: the body reads below are part of the
      // request, and a server that sends headers and then trickles would
      // otherwise hang forever. Cleared in `finally`, on every exit path.

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        if (RETRYABLE_STATUS.includes(response.status) && canRetry) {
          lastError = new Error(`HTTP ${response.status}: ${errorText}`)
          clearTimeout(timer)
          await delay(RETRY_DELAYS[attempt]!)
          continue
        }
        throw new Error(`LLM API error (${response.status}): ${errorText}`)
      }

      return (await response.json()) as T
    } catch (e) {
      if (isTransient(e, signal) && canRetry) {
        lastError = e instanceof Error ? e : new Error(String(e))
        clearTimeout(timer)
        await delay(RETRY_DELAYS[attempt]!)
        continue
      }
      throw e instanceof Error ? e : new Error(String(e))
    } finally {
      // Every exit path: returned body, thrown error, or `continue` into a retry.
      clearTimeout(timer)
    }
  }

  throw lastError ?? new Error('LLM request failed')
}

/**
 * The streaming sibling of postJSON: same retry policy and error messages, but
 * it hands each parsed SSE event to `onEvent` and resolves once the stream ends.
 *
 * Two deliberate differences. The timeout is **idle** rather than total — rearmed
 * on every chunk — so a model that thinks for five minutes doesn't trip it, while
 * a genuinely dead connection still does. And a failure is only retried while
 * nothing has been delivered yet: once events are out, the caller has already
 * shown reasoning and appended state, so replaying from scratch would double it.
 */
async function postSSE(
  url: string,
  options: PostJSONOptions,
  onEvent: (event: AnthropicStreamEvent) => void,
): Promise<void> {
  const { headers, body, timeoutMs, signal } = options
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const canRetry = attempt < RETRY_DELAYS.length
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const rearm = () => {
      clearTimeout(timer)
      timer = setTimeout(
        () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
        timeoutMs,
      )
    }
    rearm()
    let delivered = false

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        if (RETRYABLE_STATUS.includes(response.status) && canRetry) {
          lastError = new Error(`HTTP ${response.status}: ${errorText}`)
          clearTimeout(timer)
          await delay(RETRY_DELAYS[attempt]!)
          continue
        }
        throw new Error(`LLM API error (${response.status}): ${errorText}`)
      }
      if (!response.body) throw new Error('LLM returned no response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const emit = (block: string) => {
        const event = parseSSEBlock(block)
        if (!event) return
        // `delivered` is set after the handler returns, so an `error` event
        // arriving first still throws from a retryable position.
        onEvent(event)
        delivered = true
      }
      // Events are separated by a blank line; the regex tolerates CRLF.
      const drain = () => {
        let boundary: RegExpExecArray | null
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const block = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          emit(block)
        }
      }

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          rearm()
          buffer += decoder.decode(value, { stream: true })
          drain()
        }
        // A stream may end without the trailing blank line, and the decoder can
        // still be holding the tail of a multi-byte character split across the
        // last two chunks. Flush both and parse whatever is left, or the final
        // event — usually the one closing out the answer — is silently dropped.
        buffer += decoder.decode()
        drain()
        if (buffer.trim()) emit(buffer)
      } finally {
        // Leaving mid-stream — a throw from `onEvent`, or a retry — otherwise
        // leaves the body open holding the connection. A no-op once `done`.
        reader.cancel().catch(() => {})
      }

      clearTimeout(timer)
      return
    } catch (e) {
      clearTimeout(timer)
      if (!delivered && isTransient(e, signal) && canRetry) {
        lastError = e instanceof Error ? e : new Error(String(e))
        await delay(RETRY_DELAYS[attempt]!)
        continue
      }
      throw e instanceof Error ? e : new Error(String(e))
    }
  }

  throw lastError ?? new Error('LLM request failed')
}

/**
 * One `data:`-carrying SSE block → the event object. The `event:` line is
 * redundant (the JSON repeats the type), so only `data:` is read. Returns null
 * for keep-alive comments and anything unparseable.
 */
function parseSSEBlock(block: string): AnthropicStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('')
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data) as AnthropicStreamEvent
  } catch {
    return null
  }
}

export interface ToolCompletionOptions {
  tools: ToolDefinition[]
  tool_choice?: 'auto' | 'required' | 'none'
  temperature?: number
  max_tokens?: number
  signal?: AbortSignal
  jsonSchema?: JsonSchemaSpec
  /** See CompletionOptions. Fires per agent turn — each turn thinks afresh. */
  onThinking?: (thinking: ThinkingSummary) => void
  /** See CompletionOptions. Constant across every turn of one agent run. */
  sessionId?: string
}

/**
 * Tool-aware variant of chatCompletion. Returns the raw model message so the
 * caller (the agent loop) can inspect tool_calls. The 'openai' and 'anthropic'
 * backends both genuinely participate in tool-calling — Qwen is itself a
 * delegated agent with its own server-side web search, so forwarding our tool
 * schemas to it would be meaningless; this short-circuits to a plain completion
 * instead.
 */
export async function chatCompletionWithTools(
  config: LLMConfig,
  messages: ChatMessage[],
  options: ToolCompletionOptions,
): Promise<ChatCompletionWithToolsResult> {
  if (config.backend === 'qwen-chat') {
    // Loud on purpose. Tested against a live session on 2026-08-09: send Qwen a
    // `tools` array and it is dropped server-side with no error and no change in
    // input_tokens, and the model answers in prose imitating a call —
    // `update_section(section="Work", content="…")` as text. Nothing throws, and
    // that text would get stored as a profile. Silently short-circuiting here
    // would reproduce the same invisible failure one layer up, so a caller that
    // believes it is getting tool calls finds out immediately instead.
    if (options.tools.length) {
      throw new Error(
        'The Qwen backend cannot tool-call — it drops the tools array server-side. Route this through completeJSON instead.',
      )
    }
    const content = await chatCompletion(config, messages, {
      signal: options.signal,
      onThinking: options.onThinking,
    })
    return { content }
  }
  if (config.backend === 'anthropic') {
    return anthropicRequest(
      config,
      messages,
      {
        max_tokens: resolveMaxTokens(config, options.max_tokens),
        temperature: options.temperature ?? config.temperature,
        // Strict output only once tools are gone — see toolCompletionRequest.
        jsonSchema:
          options.tools.length === 0 && config.structured_output ? options.jsonSchema : undefined,
        tools: options.tools,
        tool_choice: options.tool_choice ?? 'auto',
      },
      options.signal,
      options.onThinking,
      options.sessionId,
    )
  }
  return toolCompletionRequest(config, messages, options)
}

async function toolCompletionRequest(
  config: LLMConfig,
  messages: ChatMessage[],
  options: ToolCompletionOptions,
): Promise<ChatCompletionWithToolsResult> {
  const { tools, tool_choice = 'auto', signal, jsonSchema } = options
  const temperature = options.temperature ?? config.temperature
  const max_tokens = resolveMaxTokens(config, options.max_tokens)

  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAIMessages(messages),
    max_tokens,
  }
  // Only advertise tools when there are any — some OpenAI-compatible backends
  // reject an empty `tools: []` alongside `tool_choice`.
  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = tool_choice
  }
  if (temperature !== undefined) body.temperature = temperature

  // Strict structured output only applies once tools are gone (see coach/run.ts
  // — resolveOutput never sets both). Without it, the default json_object mode
  // would conflict with tool_calls on many providers, so omit response_format
  // entirely here and let provide_verdict carry the shape instead.
  if (jsonSchema && tools.length === 0) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true },
    }
  }

  const data = await postJSON<ChatCompletionResponse>(`${resolveEndpoint(config)}/chat/completions`, {
    headers: withCustomHeaders(bearerHeaders(config), config.custom_headers),
    body,
    timeoutMs: resolveTimeout(config),
    signal,
  })

  const choice = data.choices?.[0]
  const message = choice?.message
  if (!message) throw new Error('LLM returned an empty response')

  const tool_calls = message.tool_calls
  const hasToolCalls = Array.isArray(tool_calls) && tool_calls.length > 0
  if (choice.finish_reason === 'length') {
    // Partial tool-call arguments are the same trap as partial content: they
    // parse into something shaped right and missing whatever came last.
    throw new Error(truncatedMessage(max_tokens, !!message.content || hasToolCalls))
  }
  return { content: stripThinkBlock(message.content ?? ''), tool_calls: hasToolCalls ? tool_calls : undefined }
}

/** Robust JSON extraction: fence → outermost object → jsonrepair → give up. */
export function parseJSON<T>(raw: string): T {
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const object = raw.match(/\{[\s\S]*\}/)
  const candidate = fence ? fence[1]! : object ? object[0] : raw

  const asObject = (val: unknown): T => {
    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      throw new Error('not a JSON object')
    }
    return val as T
  }

  try {
    return asObject(JSON.parse(candidate))
  } catch {
    // LLMs routinely emit unescaped quotes, trailing commas, or truncated
    // tails. Last resort, not the happy path.
    try {
      return asObject(JSON.parse(jsonrepair(candidate)))
    } catch (e) {
      throw new Error(`Couldn't parse the model's response as JSON: ${(e as Error).message}\n\n${raw.slice(0, 300)}`)
    }
  }
}

/**
 * One call, parsed and validated. On a validation failure the bad output goes
 * back to the model with the specific complaint — one retry, then it throws.
 */
export async function completeJSON<T extends object>(
  config: LLMConfig,
  messages: ChatMessage[],
  validate: (result: T) => string | null,
  options: CompletionOptions = {},
): Promise<T> {
  const raw = await chatCompletion(config, messages, options)
  let result: T | null = null
  let error: string
  try {
    result = parseJSON<T>(raw)
    error = validate(result) ?? ''
    if (!error) return result
  } catch (e) {
    error = (e as Error).message
  }

  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: raw },
    {
      role: 'user',
      content: `That response was rejected: ${error}\n\nReturn the corrected JSON object only — no prose, no code fence.`,
    },
  ]

  const retryRaw = await chatCompletion(config, retryMessages, options)
  const retried = parseJSON<T>(retryRaw)
  const retryError = validate(retried)
  if (retryError) throw new Error(`Model returned invalid output twice: ${retryError}`)
  return retried
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function abortError() {
  return new DOMException('The user aborted a request.', 'AbortError')
}

// fetch() rejects a dropped connection with TypeError; our own timeout aborts
// with a TimeoutError DOMException. Both are worth retrying. A user abort is
// deliberate, and the Errors we throw ourselves are not transient.
function isTransient(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false
  if (e instanceof DOMException) return e.name === 'TimeoutError'
  return e instanceof TypeError
}
