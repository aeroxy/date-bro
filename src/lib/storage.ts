import { DEFAULT_CONFIG, newLLMProfile, type CoachSettings, type LLMConfig, type LLMProfile } from '@/types/settings'

const KEYS = {
  llmProfiles: 'dateBroLLMProfiles',
  activeProfileId: 'dateBroActiveProfileId',
  settings: 'dateBroSettings',
} as const

const DEFAULT_SETTINGS: CoachSettings = { customPrompt: '' }

export async function getLLMProfiles(): Promise<LLMProfile[]> {
  const result = await chrome.storage.local.get(KEYS.llmProfiles)
  return result[KEYS.llmProfiles] ?? []
}

export async function saveLLMProfiles(profiles: LLMProfile[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.llmProfiles]: profiles })
}

export async function getActiveProfileId(): Promise<string | null> {
  const result = await chrome.storage.local.get(KEYS.activeProfileId)
  return result[KEYS.activeProfileId] ?? null
}

export async function setActiveProfileId(id: string | null): Promise<void> {
  await chrome.storage.local.set({ [KEYS.activeProfileId]: id })
}

type ActiveProfile = { profiles: LLMProfile[]; activeId: string }

/**
 * The profile the app is currently running on, creating a default if empty.
 *
 * Concurrent callers share one pass. On a first run two of them would each read
 * an empty list and create a *different* default profile, and the one that
 * saved second could leave `activeId` pointing at the profile the other write
 * dropped — which reads back as no profile at all. Cleared once settled, so
 * this only ever collapses calls that genuinely overlap.
 */
let inFlight: Promise<ActiveProfile> | null = null

export function ensureActiveProfile(): Promise<ActiveProfile> {
  inFlight ??= resolveActiveProfile().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function resolveActiveProfile(): Promise<ActiveProfile> {
  let profiles = await getLLMProfiles()
  if (profiles.length === 0) {
    profiles = [newLLMProfile()]
    await saveLLMProfiles(profiles)
  }
  const stored = await getActiveProfileId()
  const activeId = profiles.some((p) => p.id === stored) ? stored! : profiles[0]!.id
  if (activeId !== stored) await setActiveProfileId(activeId)
  return { profiles, activeId }
}

export async function getActiveConfig(): Promise<LLMConfig> {
  const { profiles, activeId } = await ensureActiveProfile()
  return profiles.find((p) => p.id === activeId)?.config ?? { ...DEFAULT_CONFIG }
}

export async function getSettings(): Promise<CoachSettings> {
  const result = await chrome.storage.local.get(KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...(result[KEYS.settings] ?? {}) }
}

export async function saveSettings(settings: CoachSettings): Promise<void> {
  await chrome.storage.local.set({ [KEYS.settings]: settings })
}
