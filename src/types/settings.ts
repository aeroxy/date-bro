import type { QwenModel } from '@/lib/qwen/qwen-service'

/**
 * Three backends, all zero-install:
 *   'openai'    — bring your own key, any OpenAI-compatible endpoint
 *   'anthropic' — bring your own key, any Anthropic `/v1/messages` endpoint
 *                 (the API itself, a gateway, or a local proxy)
 *   'qwen-chat' — borrows the user's live chat.qwen.ai browser session, no key
 *
 * (Chrome's built-in Gemini Nano is deliberately absent — it's far too small
 * to hold a transcript plus a knowledge base and return structured judgement.)
 */
export type LLMBackend = 'openai' | 'anthropic' | 'qwen-chat'

export interface LLMConfig {
  backend: LLMBackend
  base_url: string
  model: string
  api_key?: string
  /** JSON object of extra headers, e.g. '{"X-Api-Key":"…"}'. */
  custom_headers?: string
  /** Strict server-side JSON: `response_format.json_schema` on the 'openai'
   * backend, `output_config.format` on 'anthropic'. Needs a provider (and, on
   * Anthropic, a model) that supports it. */
  structured_output?: boolean
  /** Default true. Some local LLM servers (small models, llama.cpp, older
   * Ollama) don't support the function-calling protocol and will error or
   * hallucinate tool calls; turn off web research for those. Ignored by the
   * Qwen backend — it never receives our tool schemas either way, since it
   * already researches natively on its own. */
  tools_enabled?: boolean
  /** 'anthropic' only: ask for a summary of the model's reasoning and stream it
   * into the waiting UI. Off by default — it sends `thinking: {type:'adaptive'}`,
   * which turns thinking *on* for models where it's off by default (Opus 4.8,
   * 4.7) and is rejected outright by models that never had it (Haiku 4.5) and by
   * proxies that don't understand the field. */
  anthropic_thinking?: boolean
  temperature?: number
  /** Default 8192 — reasoning models spend this budget on reasoning first. */
  max_tokens?: number
  /** Request timeout, seconds. Default 120: these are long, thinky calls. */
  timeout?: number
  qwenModel?: QwenModel
}

export interface LLMProfile {
  id: string
  name: string
  config: LLMConfig
}

/** Coach-wide preferences that aren't tied to one date. */
export interface CoachSettings {
  /** Appended to every system prompt. House rules, tone, personal constraints. */
  customPrompt: string
}

export const DEFAULT_CONFIG: LLMConfig = {
  backend: 'qwen-chat',
  base_url: 'https://api.openai.com/v1',
  model: '',
  structured_output: false,
  max_tokens: 8192,
  timeout: 120,
}

export function newLLMProfile(name = 'Default'): LLMProfile {
  return { id: crypto.randomUUID(), name, config: { ...DEFAULT_CONFIG } }
}
