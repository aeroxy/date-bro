// Tool definitions exposed to the LLM. Keep descriptions concrete and short so
// the model picks the right tool — and keep the scope guardrail IN the
// description, not just the system prompt: a model that skims past the system
// prompt still reads the tool it's about to call.

import type { JsonSchemaSpec } from '@/lib/llm-client'
import type { ToolDefinition, ToolParameterSchema } from './types'

const SCOPE_NOTE =
  'Scope: (1) date logistics — venues, events, restaurants, opening hours, etiquette, gift ideas; ' +
  '(2) what the person has said about themselves, followed outward — the employer or studio they ' +
  'named, the field they work in, the race they are training for, the band they mentioned — which ' +
  'is what makes a specific plan and a good question possible; (3) whether those claims hold up, ' +
  'for safety: does the job or employer check out, does their photo/bio turn up reused elsewhere ' +
  '(catfish signal), public safety records. Confirming someone is who they say they are before ' +
  'meeting a stranger is normal safety practice, not surveillance. Inside those lanes, search what ' +
  'would change the advice and nothing for its own sake — and build the query from the current ' +
  'state of the thread, not a stale detail (their old city, a plan already dropped). The line is ' +
  'where a ' +
  'search STARTS: outward from something they disclosed is research; "everything about [name]", ' +
  'their address, family, old accounts, or whereabouts is a file on a private individual, and no ' +
  'answer needs one. Never a search meant to monitor, control, or find leverage on someone. If ' +
  'unsure which side a search falls on, do not run it.'

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: `Search the web (via DuckDuckGo HTML) and return the results page as markdown. ${SCOPE_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query — a normal phrase or space-separated keywords. The handler URL-encodes it for you; do not add "+" between words.',
        },
      },
      required: ['query'],
    },
  },
}

export const READ_PAGE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_page',
    description: `Fetch a URL and return the page content as markdown (scripts and styles stripped). ${SCOPE_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute URL to fetch, e.g. https://example.com/events/123',
        },
      },
      required: ['url'],
    },
  },
}

// Real research tools — the only definitions that have handlers in
// `handlers.ts` and produce tool results the model reads. `provide_verdict`
// (below) is NOT in this list: it's a structured-output channel, not a
// research tool.
export const ALL_TOOLS: ToolDefinition[] = [WEB_SEARCH_TOOL, READ_PAGE_TOOL]

// ============================================================================
// `provide_verdict` — in-house structured-output channel
// ============================================================================
//
// NOT a tool in the sense of `web_search` / `read_page`:
//   * it has no handler and is never executed;
//   * no tool result is ever returned for the model to read;
//   * the agent loop intercepts the call and treats its arguments as the
//     final structured answer.
//
// It shares the *wire format* with tools (a function declaration under
// `body.tools`) because it's the only mechanism left once research tools are
// in play: strict `response_format.json_schema` is mutually exclusive with
// `tool_calls` on most providers, so a call that genuinely needs to research
// can't also use it. `buildVerdictSchema` wraps a schema as a fake tool
// declaration: its `properties` become the tool's `parameters`, so "calling
// the tool" yields a JSON object of exactly the right shape. The agent loop
// terminates on this call — its `arguments` string becomes the returned
// content.
export const VERDICT_NAME = 'provide_verdict'

export function buildVerdictSchema(schema: JsonSchemaSpec): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: VERDICT_NAME,
      description:
        'Submit your final structured answer. You MUST call this to end your turn — the parameters ARE the answer object. Do not write the answer as plain text.',
      parameters: schema.schema as unknown as ToolParameterSchema,
    },
  }
}
