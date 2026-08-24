/**
 * The two places the "OpenAI-compatible" surface isn't actually uniform, and the
 * only two that matter here: how you turn a model's thinking *on*, and where the
 * thinking comes *back*.
 *
 * Neither is in the OpenAI spec, so every provider invented its own. There is no
 * table of them worth shipping — the list would be wrong within a month — so this
 * module handles the response side by trying every shape anyone uses, and hands
 * the request side to the user as an extra JSON body they merge in themselves.
 */

/** A plain JSON object — not an array, not null. What both halves here accept. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Deep merge, patch wins. Nested objects merge; arrays and scalars replace
 * wholesale, because a request field that *is* a list (`stop`, `tools`) is
 * always meant as the whole list — merging those index-by-index would produce a
 * value neither side asked for.
 */
export function mergeJSON(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key]
    out[key] = isObject(existing) && isObject(value) ? mergeJSON(existing, value) : value
  }
  return out
}

/**
 * The user's extra request body, merged over whatever we built.
 *
 * Theirs wins, deliberately: the field exists because the provider needs
 * something we don't know to send, and a setting that loses to our defaults
 * couldn't fix a default that is wrong for their provider. The exception is the
 * three fields that *are* the request — send those from here and the call is not
 * the call the caller asked for, which fails as a silent wrong answer rather than
 * as an error. `model` is settable in Settings, `messages` is the whole prompt,
 * `stream` decides how the response is read.
 *
 * Malformed input is ignored rather than thrown, the same bargain
 * `withCustomHeaders` strikes: a typo in an optional field should not take down
 * every call until it's noticed. Settings shows the parse error while it's being
 * typed, which is where a typo is cheap to see.
 */
const RESERVED = ['model', 'messages', 'stream']

export function withExtraBody(
  body: Record<string, unknown>,
  raw?: string,
): Record<string, unknown> {
  if (!raw?.trim()) return body
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return body
  }
  if (!isObject(parsed)) return body
  const patch = { ...parsed }
  for (const field of RESERVED) delete patch[field]
  return mergeJSON(body, patch)
}

/**
 * Some models emit their reasoning inline as a leading <think> block instead of
 * in a field of their own. Split it off so JSON parsing sees only the answer —
 * and keep it, rather than dropping it, so it can be shown while the user waits.
 *
 * A block with no closing tag means the response was cut off mid-reasoning. The
 * answer is then empty rather than the half-written thoughts: `parseJSON`'s
 * `{…}` regex would otherwise latch onto a brace inside the reasoning and yield
 * garbage that parses.
 */
export function splitThinkBlock(content: string): { answer: string; thinking?: string } {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('<think>')) return { answer: content }
  const close = trimmed.indexOf('</think>')
  const open = '<think>'.length
  if (close === -1) return { answer: '', thinking: trimmed.slice(open).trim() || undefined }
  return {
    answer: trimmed.slice(close + '</think>'.length).trimStart(),
    thinking: trimmed.slice(open, close).trim() || undefined,
  }
}

export const stripThinkBlock = (content: string): string => splitThinkBlock(content).answer

/**
 * The reasoning a non-streaming OpenAI-compatible response carried, whichever
 * shape this provider chose for it.
 *
 * All four are in the wild: `reasoning_content` (DeepSeek, vLLM, most
 * Qwen-compatible servers), `reasoning` as a plain string (OpenRouter), the newer
 * `reasoning_details` array of blocks (OpenRouter again, and anything proxying
 * it), and no field at all with a `<think>` block at the head of the content.
 * Order is longest-standing first; the inline block is last because it is the
 * fallback for a model whose server never had a field to put this in.
 *
 * Arrives whole, after the model has finished — this is not streaming, so it is
 * one late summary rather than a running one. Worth surfacing anyway: it is the
 * difference between reading why the answer says what it says and taking it on
 * faith.
 */
export function reasoningFrom(
  message: {
    reasoning_content?: unknown
    reasoning?: unknown
    reasoning_details?: unknown
  },
  inline?: string,
): string | undefined {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined

  const blocks = Array.isArray(message.reasoning_details)
    ? message.reasoning_details
        .map((block) => (isObject(block) ? text(block.text) ?? text(block.summary) : text(block)))
        .filter(Boolean)
        .join('\n\n')
    : undefined

  return text(message.reasoning_content) ?? text(message.reasoning) ?? text(blocks) ?? text(inline)
}
