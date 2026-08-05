import { createCachedExecutor, executeTool, runAgentWithValidation } from '@/lib/agent'
import { completeJSON } from '@/lib/llm-client'
import { getActiveConfig, getSettings } from '@/lib/storage'
import { ALL_TOOLS, buildVerdictSchema, VERDICT_NAME } from '@/lib/tools/definitions'
import type { ToolCall, ToolDefinition } from '@/lib/tools/types'
import type { LLMConfig } from '@/types/settings'
import type { PersonContext, SelfContext, Suggestion, ThinkingSummary } from '@/types/coach'
import type { DateRecord } from '@/types/date'

import { buildPersonMessages, buildSelfMessages, buildSuggestionMessages } from './prompts'
import {
  PERSON_SCHEMA,
  SELF_SCHEMA,
  SUGGESTION_SCHEMA,
  validatePerson,
  validateSelf,
  validateSuggestion,
} from './schemas'

async function context() {
  const [config, settings] = await Promise.all([getActiveConfig(), getSettings()])
  if (config.backend !== 'qwen-chat' && (!config.base_url.trim() || !config.model.trim())) {
    throw new Error('Set a base URL and model in Settings, or switch to the Qwen backend.')
  }
  return { config, customPrompt: settings.customPrompt }
}

/**
 * Whether — and how — the suggestion engine gets web research this call.
 * Qwen never receives our tool schemas: it's a delegated agent that already
 * researches natively, server-side (see qwen-service.ts's `auto_search`).
 * The keyed backends ('openai', 'anthropic') get `web_search` + `read_page`
 * plus the `provide_verdict` structured-output channel, unless the user has
 * turned tool-calling off for a provider that doesn't support it.
 */
function resolveSuggestionOutput(config: LLMConfig): { tools: ToolDefinition[]; verdictName?: string } {
  if (config.backend === 'qwen-chat' || config.tools_enabled === false) return { tools: [] }
  return { tools: [...ALL_TOOLS, buildVerdictSchema(SUGGESTION_SCHEMA)], verdictName: VERDICT_NAME }
}

/** A human-readable line for the UI while research is in flight. */
function describeToolCall(call: ToolCall): string {
  try {
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>
    if (call.function.name === 'web_search' && typeof args.query === 'string') return `Searching: ${args.query}`
    if (call.function.name === 'read_page' && typeof args.url === 'string') return `Reading: ${args.url}`
  } catch {
    /* malformed args — fall through to the generic label */
  }
  return `Running ${call.function.name}`
}

/**
 * Rebuild the picture of the date, from seed context + everything since.
 * `onThinking` streams the model's reasoning summary: Qwen always, Anthropic
 * when the profile opts in, never OpenAI (that path doesn't stream).
 */
export async function rebuildPersonContext(
  record: DateRecord,
  signal?: AbortSignal,
  onThinking?: (thinking: ThinkingSummary) => void,
): Promise<PersonContext> {
  const { config, customPrompt } = await context()
  const result = await completeJSON<Omit<PersonContext, 'generatedAt'>>(
    config,
    buildPersonMessages(record, customPrompt),
    validatePerson,
    { signal, jsonSchema: PERSON_SCHEMA, onThinking },
  )
  return { ...result, generatedAt: Date.now(), turnsAt: record.turnsUpdatedAt }
}

/** Rebuild the read of the user, in this specific connection. */
export async function rebuildSelfContext(
  record: DateRecord,
  signal?: AbortSignal,
  onThinking?: (thinking: ThinkingSummary) => void,
): Promise<SelfContext> {
  const { config, customPrompt } = await context()
  const result = await completeJSON<Omit<SelfContext, 'generatedAt'>>(
    config,
    buildSelfMessages(record, customPrompt),
    validateSelf,
    { signal, jsonSchema: SELF_SCHEMA, onThinking },
  )
  return { ...result, generatedAt: Date.now(), turnsAt: record.turnsUpdatedAt }
}

/**
 * What to say or do next, given everything known so far. `onActivity` is
 * called with a human-readable line each time the coach searches or reads a
 * page, so the UI can show what it's doing while it's doing it.
 */
export async function suggestMove(
  record: DateRecord,
  question: string,
  signal?: AbortSignal,
  onActivity?: (label: string) => void,
  onThinking?: (thinking: ThinkingSummary) => void,
): Promise<Suggestion> {
  const { config, customPrompt } = await context()
  const { tools, verdictName } = resolveSuggestionOutput(config)
  const messages = buildSuggestionMessages(record, question, customPrompt, tools.length > 0)

  const result =
    tools.length > 0
      ? await runAgentWithValidation<Omit<Suggestion, 'id' | 'generatedAt' | 'question'>>(config, messages, {
          tools,
          executeTool: createCachedExecutor(executeTool),
          signal,
          verdictName,
          validate: validateSuggestion,
          onToolCall: onActivity ? (call) => onActivity(describeToolCall(call)) : undefined,
          onThinking,
        })
      : await completeJSON<Omit<Suggestion, 'id' | 'generatedAt' | 'question'>>(
          config,
          messages,
          validateSuggestion,
          { signal, jsonSchema: SUGGESTION_SCHEMA, onThinking },
        )
  return {
    ...result,
    id: crypto.randomUUID(),
    generatedAt: Date.now(),
    turnsAt: record.turnsUpdatedAt,
    question: question.trim() || undefined,
  }
}
