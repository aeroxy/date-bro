// Agent loop: drives the LLM through tool use until it produces a final
// answer. Each iteration:
//   1. Send messages → chatCompletionWithTools
//   2. If response calls `provide_verdict` (the in-house structured-output
//        channel): return its args as the final JSON content.
//   3. Else if response has tool_calls:
//        append assistant message
//        for each call: append tool result via executeTool()
//   4. Else (no tool_calls):
//        if a verdict is expected, nudge and loop;
//        otherwise return content.
// Caps iterations to prevent runaway.

import { chatCompletionWithTools, parseJSON } from './llm-client'
import type { ChatMessage, JsonSchemaSpec } from './llm-client'
import type { ThinkingSummary } from '@/types/coach'
import type { LLMConfig } from '@/types/settings'
import type { ToolCall, ToolDefinition } from './tools/types'
import { webSearch, readPage } from './tools/handlers'

// Hard cap on the agent loop to prevent runaway.
export const MAX_AGENT_ITERATIONS = 10
// After this many rounds, research tools are disabled — the model must
// produce a final answer. Gives it time to look things up, then forces it
// to stop and answer instead of researching forever.
const MAX_TOOL_ROUNDS = 5

export type ToolExecutor = (call: ToolCall, signal?: AbortSignal) => Promise<string>

export interface AgentOptions {
  tools: ToolDefinition[]
  executeTool: ToolExecutor
  signal?: AbortSignal
  onToolCall?: (call: ToolCall) => void
  /** Reasoning summary for the waiting UI, refreshed on every turn. */
  onThinking?: (thinking: ThinkingSummary) => void
  maxIterations?: number
  // Strict structured output. Mutually exclusive with verdictName in practice
  // (the provide_verdict channel replaces it whenever research tools are
  // present — see coach/run.ts).
  jsonSchema?: JsonSchemaSpec
  // Names the in-house structured-output channel for this run — see
  // lib/tools/definitions.ts for how `provide_verdict` works.
  verdictName?: string
  /**
   * Stable conversation identity, forwarded to every turn of the loop. It has to
   * be the same on all of them: the whole point is that a research round appends
   * to a prefix the previous turn already cached, and a per-turn session id would
   * put each of them in its own cache partition. See `CompletionOptions`.
   */
  sessionId?: string
}

export const executeTool: ToolExecutor = async (call, signal) => {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.function.arguments)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object')
  } catch {
    throw new Error(`Tool ${call.function.name} received malformed arguments`)
  }
  switch (call.function.name) {
    case 'web_search': {
      const query = String(args.query ?? '').trim()
      if (!query) throw new Error('web_search requires a non-empty query')
      return webSearch(query, { signal })
    }
    case 'read_page': {
      const url = String(args.url ?? '').trim()
      if (!url) throw new Error('read_page requires a non-empty url')
      return readPage(url, { signal })
    }
    default:
      throw new Error(`Unknown tool: ${call.function.name}`)
  }
}

// Stable cache key for a tool call so identical web_search / read_page calls
// within one run resolve to one fetch. Returns null for calls that shouldn't
// be cached (malformed args, unknown tool) so they always hit the network.
function toolCacheKey(call: ToolCall): string | null {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.function.arguments)
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  } catch {
    return null
  }
  switch (call.function.name) {
    case 'web_search': {
      const q = String(args.query ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
      return q ? `search:${q}` : null
    }
    case 'read_page': {
      const raw = String(args.url ?? '').trim()
      if (!raw) return null
      try {
        const u = new URL(raw)
        u.hash = ''
        return `read:${u.toString()}`
      } catch {
        return `read:${raw}`
      }
    }
    default:
      return null
  }
}

// Wrap a ToolExecutor with a per-run cache. Promises are cached (not just
// results), so concurrent identical calls share one in-flight fetch; a
// rejected call is evicted so a transient failure can be retried.
//
// A cache hit returns the *first* caller's promise, signal and all. That's only
// sound because the cache is per-run and every call in a run shares that run's
// signal — aborting the run cancels the one fetch all of them are waiting on.
// Don't reuse an executor across runs: a later run would inherit an earlier
// run's abort.
export function createCachedExecutor(base: ToolExecutor = executeTool): ToolExecutor {
  const inflight = new Map<string, Promise<string>>()
  return (call, signal) => {
    const key = toolCacheKey(call)
    if (!key) return base(call, signal)
    const existing = inflight.get(key)
    if (existing) return existing
    const p = base(call, signal).catch((e) => {
      inflight.delete(key)
      throw e
    })
    inflight.set(key, p)
    return p
  }
}

// Returns the final content plus the accumulated transcript (assistant tool
// calls + tool results). Callers that retry on a bad final answer reuse
// `messages` so the retry keeps the gathered tool context instead of
// re-researching from scratch.
export async function runAgent(
  config: LLMConfig,
  messages: ChatMessage[],
  options: AgentOptions,
): Promise<{ content: string; messages: ChatMessage[] }> {
  // `exec`, not `executeTool` — that name is the module-level default export
  // just above, and shadowing it here reads as a recursive call.
  const { tools, executeTool: exec, signal, onToolCall, onThinking, maxIterations = MAX_AGENT_ITERATIONS, jsonSchema, verdictName, sessionId } = options
  const working: ChatMessage[] = [...messages]

  const hasVerdict = !!verdictName && tools.some((t) => t.function.name === verdictName)
  const verdictOnlyTools = hasVerdict ? tools.filter((t) => t.function.name === verdictName) : []

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) throw new DOMException('Agent aborted', 'AbortError')

    // After MAX_TOOL_ROUNDS, strip research tools but keep the structured-
    // output channel (if any) so the model can still submit its answer.
    const activeTools = i < MAX_TOOL_ROUNDS ? tools : hasVerdict ? verdictOnlyTools : []
    const response = await chatCompletionWithTools(config, working, { tools: activeTools, signal, jsonSchema, onThinking, sessionId })

    // The structured-output channel is terminal: extract the provide_verdict
    // arguments as the final content and end the loop. Sibling research tool
    // calls in the same response are dropped — the model declared it's done.
    if (hasVerdict && response.tool_calls?.length) {
      const verdictCall = response.tool_calls.find((c) => c.function.name === verdictName)
      if (verdictCall) {
        working.push({ role: 'assistant', content: response.content, tool_calls: [verdictCall] } as ChatMessage)
        return { content: verdictCall.function.arguments, messages: working }
      }
    }

    if (!response.tool_calls?.length) {
      // No tool calls. If a verdict was expected, nudge and loop — but only
      // if there's a turn left to answer the nudge.
      if (hasVerdict && i < maxIterations - 1) {
        working.push({ role: 'assistant', content: response.content || ' ' })
        working.push({
          role: 'user',
          content: `<system-reminder>\nYou must call the \`${verdictName}\` tool to submit your final answer. Do not write it as plain text.\n</system-reminder>`,
        })
        continue
      }
      return { content: response.content, messages: working }
    }

    working.push({ role: 'assistant', content: response.content, tool_calls: response.tool_calls } as ChatMessage)

    // Tool calls in one turn are independent — run them concurrently. .map()
    // preserves order, so results line up with response.tool_calls.
    const toolResults = await Promise.all(
      response.tool_calls.map(async (call) => {
        onToolCall?.(call)
        let result: string
        try {
          result = await exec(call, signal)
        } catch (e) {
          result = `Error: ${e instanceof Error ? e.message : String(e)}`
        }
        return { role: 'tool' as const, tool_call_id: call.id, content: result }
      }),
    )
    working.push(...(toolResults as ChatMessage[]))
  }

  throw new Error(`Agent exceeded ${maxIterations} iterations without a final answer`)
}

// Agent-aware replacement for completeJSON. Runs the agent loop, parses the
// final content as JSON, validates, and retries once on parse/validation
// failure with the bad response in context so the model can self-correct.
export async function runAgentWithValidation<T extends object>(
  config: LLMConfig,
  messages: ChatMessage[],
  options: AgentOptions & { validate: (result: T) => string | null },
): Promise<T> {
  const { validate, verdictName, ...agentOpts } = options

  // Inject the verdict instruction once, as a user message wrapped in
  // <system-reminder>. Deliberately not a `role: 'system'` message — strict
  // providers reject system messages that aren't at position 0.
  const initial: ChatMessage[] = verdictName
    ? [
        ...messages,
        {
          role: 'user',
          content: `<system-reminder>\nTo submit your final answer, call the \`${verdictName}\` tool with the answer object as its arguments. The turn only ends when you call it — do not write the answer as plain text.\n</system-reminder>`,
        },
      ]
    : messages

  const { content: raw, messages: history } = await runAgent(config, initial, { ...agentOpts, verdictName })
  try {
    const parsed = parseJSON<T>(raw)
    const error = validate(parsed)
    if (!error) return parsed
    return await retry<T>(config, history, agentOpts, raw, error, validate, verdictName)
  } catch (parseError) {
    return await retry<T>(config, history, agentOpts, raw, `Could not parse JSON: ${(parseError as Error).message}`, validate, verdictName)
  }
}

async function retry<T extends object>(
  config: LLMConfig,
  history: ChatMessage[],
  agentOpts: AgentOptions,
  badResponse: string,
  errorMessage: string,
  validate: (result: T) => string | null,
  verdictName?: string,
): Promise<T> {
  let retryMessages: ChatMessage[]
  if (verdictName) {
    // Append a tool message to the provide_verdict call so the correction
    // arrives as a tool result — a plain-text assistant+user pair after an
    // unresolved tool call would violate the protocol.
    const lastMessage = history[history.length - 1]
    const verdictCall = lastMessage?.tool_calls?.find((c) => c.function.name === verdictName)
    if (verdictCall) {
      retryMessages = [
        ...history,
        {
          role: 'tool',
          tool_call_id: verdictCall.id,
          content: `${errorMessage}. Please call \`${verdictName}\` again with the corrected JSON.`,
        } as ChatMessage,
      ]
    } else {
      retryMessages = [
        ...history,
        { role: 'assistant', content: badResponse },
        { role: 'user', content: `${errorMessage}. Fix it and output compact JSON only.` },
      ]
    }
  } else {
    retryMessages = [
      ...history,
      { role: 'assistant', content: badResponse },
      { role: 'user', content: `${errorMessage}. Fix it and output compact JSON only.` },
    ]
  }
  const { content: retryRaw } = await runAgent(config, retryMessages, { ...agentOpts, verdictName })
  const parsed = parseJSON<T>(retryRaw)
  const error = validate(parsed)
  if (error) throw new Error(`Validation failed after retry: ${error}`)
  return parsed
}
