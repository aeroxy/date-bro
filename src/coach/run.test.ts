// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { VERDICT_NAME } from '@/lib/tools/definitions'
import type { PersonProfile, SelfProfile } from '@/types/coach'
import type { DateRecord } from '@/types/date'
import { suggestMove } from './run'

const THEM = '## Who they are\n\n- Landscape architect (high)'
const ME = '## Who you are\n\n- Between jobs (medium)'

const idle = { changed: false, sections: [], rewrite: '' }
const append = (heading: string, content: string) => ({
  changed: true,
  sections: [{ heading, mode: 'append', old: '', content }],
  rewrite: '',
})

const option = (label: string) => ({
  label,
  kind: 'message',
  risk: 'low',
  draft: 'ha, the lake. were you swimming?',
  why: 'picks up what she said',
  then: 'if she answers in kind, ask about the weekend',
})

/** A complete answer to "what do I say?", with every amendment idle unless overridden. */
const answer = (over: Record<string, unknown> = {}) => ({
  read: 'The thread is young and warm.',
  priority: 'Answer what she said.',
  options: [option('Warm'), option('Direct')],
  avoid: [],
  timing: 'Tonight.',
  honest_note: '',
  research_notes: [],
  mind: idle,
  profile_them: idle,
  profile_me: idle,
  ...over,
})

const record = (over: Partial<DateRecord> = {}): DateRecord => ({
  id: 'r1',
  name: 'Mira',
  createdAt: 0,
  updatedAt: 0,
  turnsUpdatedAt: 0,
  nextTurnNumber: 2,
  stage: 'talking',
  meta: {},
  goal: '',
  turns: [{ id: 'a', number: 1, speaker: 'them', text: 'made it to the lake' }],
  researchNotes: '',
  ...over,
})

// `suggestMove` reads the prose and nothing else of a profile.
const themProfile = { generatedAt: 1, turnsAt: 0, markdown: THEM } as unknown as PersonProfile
const meProfile = { generatedAt: 1, turnsAt: 0, markdown: ME } as unknown as SelfProfile

const realFetch = globalThis.fetch
let calls: number

/**
 * Both ways a keyed backend answers: as plain content, or — when web research is
 * on, which is the default — as the arguments of the `provide_verdict` tool. They
 * retry differently and fail with different messages, and the same `validate`
 * sits behind both, so each is run.
 */
const paths = [
  { name: 'plain completion', tools: false },
  { name: 'research agent', tools: true },
]

const modelSays = (reply: object, tools: boolean) => {
  calls = 0
  globalThis.fetch = (async () => {
    calls++
    const message = tools
      ? {
          content: '',
          tool_calls: [
            {
              id: `call-${calls}`,
              type: 'function',
              function: { name: VERDICT_NAME, arguments: JSON.stringify(reply) },
            },
          ],
        }
      : { content: JSON.stringify(reply) }
    return new Response(
      JSON.stringify({ choices: [{ message, finish_reason: tools ? 'tool_calls' : 'stop' }] }),
    )
  }) as unknown as typeof fetch
}

beforeEach(() => {
  const store: Record<string, unknown> = {}
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      },
    },
  }
  return undefined
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
  globalThis.fetch = realFetch
})

/** Seed the one active LLM profile the run reads, for the path under test. */
const configure = async (tools: boolean) => {
  await chrome.storage.local.set({
    dateBroLLMProfiles: [
      {
        id: 'p',
        name: 'p',
        config: {
          backend: 'openai',
          base_url: 'https://x.invalid/v1',
          model: 'test-model',
          stream: false,
          tools_enabled: tools,
        },
      },
    ],
    dateBroActiveProfileId: 'p',
    dateBroSettings: { customPrompt: '' },
  })
}

describe('a profile amendment aimed at a profile nobody has built yet', () => {
  for (const { name, tools } of paths) {
    describe(name, () => {
      // The reported failure: the first "What do I say?" on a new record, with a
      // note about the person in it, sent the model after `profile_them`. There
      // was nothing to amend, so the answer was rejected, the retry did the same,
      // and the advice — read, drafts and all — was thrown away for a field whose
      // correct value is nothing.
      test('does not cost the user their advice', async () => {
        await configure(tools)
        modelSays(answer({ profile_them: append('Who they are', '- At Studio Verde') }), tools)

        const result = await suggestMove(record(), 'she is a landscape architect')

        expect(result.read).toBe('The thread is young and warm.')
        expect(result.options).toHaveLength(2)
        // Accepted first time: a retry here is a whole extra run, paid for a
        // field that was going to be empty either way.
        expect(calls).toBe(1)
      })

      // Stored, it would be a card offering something `applyProposalTo` declines
      // to do: there is no document to write it into.
      test('is dropped rather than stored as an offer that cannot be applied', async () => {
        await configure(tools)
        modelSays(answer({ profile_them: append('Who they are', '- At Studio Verde') }), tools)

        const result = await suggestMove(record(), '')

        expect(result.profiles).toBeUndefined()
      })

      test('is dropped for the missing one only, and the other still lands', async () => {
        await configure(tools)
        modelSays(
          answer({
            profile_them: append('Who they are', '- At Studio Verde'),
            profile_me: append('Who you are', '- Starting at Verde next week'),
          }),
          tools,
        )

        // Hers exists, the user's does not.
        const result = await suggestMove(record({ themProfile }), '')

        expect(calls).toBe(1)
        expect(result.profiles?.map((p) => p.target)).toEqual(['them'])
      })

      test('a profile that exists is still amended, and still checked', async () => {
        await configure(tools)
        modelSays(
          answer({
            profile_them: append('Who they are', '- At Studio Verde'),
            profile_me: append('Who you are', '- Starting at Verde next week'),
          }),
          tools,
        )

        const result = await suggestMove(record({ themProfile, meProfile }), '')

        expect(result.profiles?.map((p) => p.target)).toEqual(['them', 'me'])
      })
    })
  }
})
