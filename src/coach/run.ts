import { createCachedExecutor, executeTool, runAgentWithValidation } from '@/lib/agent'
import { completeJSON } from '@/lib/llm-client'
import { getActiveConfig, getMind, getSettings, saveMind } from '@/lib/storage'
import { ALL_TOOLS, buildVerdictSchema, VERDICT_NAME } from '@/lib/tools/definitions'
import type { ToolCall, ToolDefinition } from '@/lib/tools/types'
import type { LLMConfig } from '@/types/settings'
import type {
  PersonJudgment,
  PersonProfile,
  SelfJudgment,
  SelfProfile,
  Suggestion,
  ThinkingSummary,
} from '@/types/coach'
import type { ChatEngine, DateRecord } from '@/types/date'

import { mindText } from './mind'
import { applyProfileUpdate, type ProfileUpdate } from './profile'
import {
  buildChatMessages,
  buildPersonMessages,
  buildSelfMessages,
  buildSuggestionMessages,
} from './prompts'
import {
  CHAT_SCHEMA,
  PERSON_SCHEMA,
  SELF_SCHEMA,
  SUGGESTION_SCHEMA,
  validateChat,
  validatePerson,
  validateSelf,
  validateSuggestion,
} from './schemas'

async function context() {
  const [config, settings, mind] = await Promise.all([
    getActiveConfig(),
    getSettings(),
    getMind(),
  ])
  if (config.backend !== 'qwen-chat' && (!config.base_url.trim() || !config.model.trim())) {
    throw new Error('Set a base URL and model in Settings, or switch to the Qwen backend.')
  }
  return { config, customPrompt: settings.customPrompt, mind: mindText(mind) }
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

/** What both rebuild engines return: a delta for the prose, the judgment whole. */
type Rebuild<J> = J & { profile: ProfileUpdate }

/**
 * Update what's known about the date. The model returns only what changed, so
 * the stored markdown is the input as well as the output — a rebuild that finds
 * nothing new returns `changed: false` and the document survives byte-for-byte.
 *
 * `message` is whatever the user typed into the box when they hit rebuild, and
 * it is read once and never stored. That is the whole difference between it and
 * the seed field this app deleted: the seed sat above the transcript and was
 * re-sent on every rebuild forever, where this rides the volatile tail, below
 * every breakpoint, and exists only for this call. What survives is whatever the
 * profile absorbed from it — which is the point, since the profile is the thing
 * carried forward and a pasted CV is not.
 *
 * `onThinking` streams the model's reasoning summary: Qwen always, Anthropic
 * when the profile opts in, never OpenAI (that path doesn't stream).
 */
export async function rebuildPersonContext(
  record: DateRecord,
  message: string,
  signal?: AbortSignal,
  onThinking?: (thinking: ThinkingSummary) => void,
): Promise<PersonProfile> {
  const { config, customPrompt, mind } = await context()
  const { profile, ...judgment } = await completeJSON<Rebuild<PersonJudgment>>(
    config,
    buildPersonMessages(record, message, mind, customPrompt),
    validatePerson,
    { signal, jsonSchema: PERSON_SCHEMA, onThinking, sessionId: record.id },
  )
  return {
    generatedAt: Date.now(),
    turnsAt: record.turnsUpdatedAt,
    markdown: applyProfileUpdate(record.themProfile?.markdown ?? '', profile),
    judgment,
  }
}

/** The same, for the read of the user in this specific connection. */
export async function rebuildSelfContext(
  record: DateRecord,
  message: string,
  signal?: AbortSignal,
  onThinking?: (thinking: ThinkingSummary) => void,
): Promise<SelfProfile> {
  const { config, customPrompt, mind } = await context()
  const { profile, ...judgment } = await completeJSON<Rebuild<SelfJudgment>>(
    config,
    buildSelfMessages(record, message, mind, customPrompt),
    validateSelf,
    { signal, jsonSchema: SELF_SCHEMA, onThinking, sessionId: record.id },
  )
  return {
    generatedAt: Date.now(),
    turnsAt: record.turnsUpdatedAt,
    markdown: applyProfileUpdate(record.meProfile?.markdown ?? '', profile),
    judgment,
  }
}

/**
 * One instruction to amend a profile. Not a conversation: the request carries no
 * history, and nothing here is kept but the document it changes.
 *
 * Returns rather than persists, and deliberately. The amendment and the reply
 * are one result, and a failed call should leave the stored profile exactly as
 * it was rather than half-written — so the caller applies both at once, once
 * this has resolved.
 *
 * `changed` is the headings this reply touched, for the caption the user sees
 * once. A rewrite reports none, because there is no meaningful list to give —
 * it replaced everything.
 */
export async function chatAboutProfile(
  record: DateRecord,
  engine: ChatEngine,
  message: string,
  signal?: AbortSignal,
  onThinking?: (thinking: ThinkingSummary) => void,
): Promise<{ reply: string; headline: string; markdown: string; changed: string[] }> {
  const { config, customPrompt, mind } = await context()
  const current = (engine === 'them' ? record.themProfile : record.meProfile)?.markdown ?? ''

  const { reply, headline, profile } = await completeJSON<{
    reply: string
    headline?: string
    profile: ProfileUpdate
  }>(config, buildChatMessages(record, engine, message, mind, customPrompt), validateChat, {
    signal,
    jsonSchema: CHAT_SCHEMA,
    onThinking,
    sessionId: record.id,
  })

  return {
    reply: reply.trim(),
    // Empty means "leave it", which is the common and correct answer.
    headline: headline?.trim() ?? '',
    markdown: applyProfileUpdate(current, profile),
    changed: profile.changed ? (profile.sections ?? []).map((s) => s.heading) : [],
  }
}

/**
 * What to say or do next, given everything known so far. `onActivity` is
 * called with a human-readable line each time the coach searches or reads a
 * page, so the UI can show what it's doing while it's doing it.
 */
export async function suggestMove(
  record: DateRecord,
  message: string,
  signal?: AbortSignal,
  onActivity?: (label: string) => void,
  onThinking?: (thinking: ThinkingSummary) => void,
): Promise<Suggestion> {
  const { config, customPrompt, mind } = await context()
  const { tools, verdictName } = resolveSuggestionOutput(config)
  const messages = buildSuggestionMessages(
    record,
    message,
    mind,
    customPrompt,
    tools.length > 0,
  )

  type Raw = Omit<Suggestion, 'id' | 'generatedAt' | 'question'> & { mind?: ProfileUpdate }
  const { mind: amendment, ...result } =
    tools.length > 0
      ? await runAgentWithValidation<Raw>(config, messages, {
          tools,
          executeTool: createCachedExecutor(executeTool),
          signal,
          verdictName,
          validate: validateSuggestion,
          onToolCall: onActivity ? (call) => onActivity(describeToolCall(call)) : undefined,
          onThinking,
          sessionId: record.id,
        })
      : await completeJSON<Raw>(config, messages, validateSuggestion, {
          signal,
          jsonSchema: SUGGESTION_SCHEMA,
          onThinking,
          sessionId: record.id,
        })

  // The coach amending itself. Written here rather than handed back for the
  // caller to store, unlike the profile amendments: the mind isn't a field of any
  // record, so there is no record-merge for a caller to get right.
  //
  // Applied to a fresh read, not to the copy this run was built from — a run
  // takes half a minute and the user may have edited it by hand in the meantime.
  // `mindText` resolves the seed on a first write, so an amendment forks the
  // whole document rather than landing on an empty one.
  //
  // A failed write is not allowed to take the advice with it. The suggestion is
  // finished and half a minute paid for by the time this runs; losing all of it
  // because storage refused a write is the worse of the two outcomes by a wide
  // margin, and the amendment is the one this run can afford to drop.
  if (amendment?.changed) {
    try {
      await saveMind(applyProfileUpdate(mindText(await getMind()), amendment))
    } catch {
      /* the coach doesn't learn from this run; the user still gets their answer */
    }
  }

  return {
    ...result,
    id: crypto.randomUUID(),
    generatedAt: Date.now(),
    turnsAt: record.turnsUpdatedAt,
    question: message.trim() || undefined,
  }
}
