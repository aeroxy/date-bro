// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getPhotoConfig } from './storage'
import type { LLMProfile } from '@/types/settings'

const profile = (id: string, model: string): LLMProfile => ({
  id,
  name: id,
  config: { backend: 'openai', base_url: 'https://x.invalid/v1', model },
})

// The three keys below are the storage layout in `wiki/architecture.md`; spelling
// them out here is what makes a rename fail this test rather than a user.
let store: Record<string, unknown>
const seed = (photoProfileId?: string) => {
  store = {
    dateBroLLMProfiles: [profile('text', 'text-model'), profile('vision', 'vision-model')],
    dateBroActiveProfileId: 'text',
    dateBroSettings: { customPrompt: '', ...(photoProfileId ? { photoProfileId } : {}) },
  }
}

beforeEach(() => {
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      },
    },
  }
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe('getPhotoConfig', () => {
  test('is the active profile until another is chosen', async () => {
    seed()
    expect((await getPhotoConfig()).model).toBe('text-model')
  })

  test('is the chosen profile, whichever one is active', async () => {
    seed('vision')
    expect((await getPhotoConfig()).model).toBe('vision-model')
  })

  test('falls back to the active profile when the chosen one has been deleted', async () => {
    seed('gone')
    expect((await getPhotoConfig()).model).toBe('text-model')
  })
})
