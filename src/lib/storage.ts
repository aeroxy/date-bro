import { EMPTY_MIND, forkedHeadings, legacyForked, mergeMind, mindText, type Mind } from '@/coach/mind'
import { DEFAULT_CONFIG, newLLMProfile, type CoachSettings, type LLMConfig, type LLMProfile } from '@/types/settings'

const KEYS = {
  llmProfiles: 'dateBroLLMProfiles',
  activeProfileId: 'dateBroActiveProfileId',
  settings: 'dateBroSettings',
  mind: 'dateBroCoachMind',
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

/**
 * The coach itself — see `coach/mind.ts`.
 *
 * Here rather than on a `DateRecord` because it isn't about a particular person.
 * Filing it under one of them would mean choosing which record owns a coach that
 * every record shares, and losing it when that record is deleted.
 *
 * Empty `markdown` means "still tracking the shipped seed", so an installation
 * nobody has edited keeps getting knowledge-base improvements from releases.
 * `saveMind` is the fork — per section, not per document: it records which
 * headings the document being saved has diverged on, and `mindText` refreshes
 * the rest from the seed on every read.
 */
export async function getMind(): Promise<Mind> {
  const result = await chrome.storage.local.get(KEYS.mind)
  const stored = result[KEYS.mind] as Partial<Mind> | undefined
  // Field by field rather than spread over `EMPTY_MIND`: a spread copies a key
  // that is present-but-undefined straight over the default it was supposed to
  // fall back to, and every reader of this calls `.trim()` on `markdown`.
  return {
    markdown: stored?.markdown ?? EMPTY_MIND.markdown,
    updatedAt: stored?.updatedAt ?? EMPTY_MIND.updatedAt,
    // A document stored before `forked` existed was saved under the rule that
    // any write forks everything, so every section it *has* is migrated as
    // forked — reading it as "nothing forked" would refresh all of them from the
    // seed and silently discard edits made under the old rule. Only the sections
    // it has, though: see `legacyForked` for why marking the full canonical list
    // strands every section shipped after the upgrade.
    forked: stored?.forked ?? legacyForked(stored?.markdown ?? ''),
  }
}

/**
 * Writes are queued rather than issued as they arrive.
 *
 * `chrome.storage.local` has no compare-and-set, so this is a read-modify-write
 * across two await points, and two of them interleaved lose one. One writer is a
 * user hitting Save and the other is a 30-second model run finishing — the
 * overlap is narrow but it is exactly when both have something to say. A promise
 * chain is enough because both writers live in the app page; there is no second
 * context writing this key.
 *
 * `.catch` on the tail, not on the returned promise: a failed save must still
 * reject for its own caller, while leaving the queue usable for the next one.
 */
let mindWrites: Promise<unknown> = Promise.resolve()

/**
 * `base` is the document as the caller loaded it. Pass it and a concurrent
 * amendment survives — see `mergeMind`. Omitting it keeps the old behaviour of
 * replacing the document outright, which is right only when the caller knows
 * nothing can have changed under it.
 */
export async function saveMind(markdown: string, base?: string): Promise<Mind> {
  const write = mindWrites.then(async () => {
    const merged = base === undefined ? markdown : mergeMind(base, markdown, mindText(await getMind()))
    const mind: Mind = { markdown: merged, updatedAt: Date.now(), forked: forkedHeadings(merged) }
    await chrome.storage.local.set({ [KEYS.mind]: mind })
    return mind
  })
  mindWrites = write.catch(() => {})
  return write
}

/**
 * Everything the settings modal owns, in one `set`.
 *
 * Three separate writes could half-land — profiles stored but the active id
 * not, leaving the app pointed at a profile that no longer exists, or the other
 * way round. One `set` writes all three keys or none of them.
 */
export async function saveAllSettings(bundle: {
  profiles: LLMProfile[]
  activeId: string | null
  settings: CoachSettings
}): Promise<void> {
  await chrome.storage.local.set({
    [KEYS.llmProfiles]: bundle.profiles,
    [KEYS.activeProfileId]: bundle.activeId,
    [KEYS.settings]: bundle.settings,
  })
}
