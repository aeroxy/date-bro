import { renderLog, type FetchArgs, type RawMessage } from './render'
import { fetchInstagram } from './instagram'
import { fetchRed } from './red'
import { fetchTelegram } from './telegram'
import { fetchWhatsApp } from './whatsapp'

export type SourceId = 'whatsapp' | 'telegram' | 'instagram' | 'red'

type FetchResult = {
  peer?: string | null
  messages?: RawMessage[]
  done?: boolean
  note?: string | null
  error?: string
}

export type SourceDef = {
  id: SourceId
  label: string
  /** Which tab to inject into. */
  match: string
  /** The address to name when there isn't one. */
  where: string
  fetch: (args: FetchArgs) => Promise<FetchResult>
}

export const SOURCES: SourceDef[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    match: '*://web.whatsapp.com/*',
    where: 'web.whatsapp.com',
    fetch: fetchWhatsApp,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    match: '*://web.telegram.org/*',
    where: 'web.telegram.org/a',
    fetch: fetchTelegram,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    match: '*://*.instagram.com/*',
    where: 'instagram.com',
    fetch: fetchInstagram,
  },
  {
    id: 'red',
    label: 'RED',
    // The only source matched down to the conversation's own path, because it
    // is the only one where the id of the thread to read lives in the url — so
    // narrowing here means the tab lookup can never hand the driver a tab it
    // has nothing to say about, and "no RED tab is open" is the honest error
    // for a feed tab rather than something the driver has to discover.
    match: '*://*.xiaohongshu.com/chat/*',
    where: 'xiaohongshu.com',
    fetch: fetchRed,
  },
]

// Each pass is bounded so the injected function returns while the page is still
// listening, and picks up where it left off on the next one — the sources keep
// their progress in the tab. The cap is a runaway guard, not a budget.
const BUDGET_MS = 20_000
const MAX_PASSES = 200

export type ImportResult = {
  text: string
  peer: string | null
  count: number
  note: string | null
}

/**
 * Drive one source until it says it's finished, and render what it found.
 *
 * This runs from the app page rather than the service worker on purpose: a long
 * history is minutes of passes, and the app page is the context with no lifetime
 * to worry about — the same reason the keyed LLM backends live there and only the
 * Qwen stream is bridged through the worker.
 */
export async function importFromSource(
  source: SourceDef,
  last: number,
  onProgress: (found: number) => void,
): Promise<ImportResult> {
  const tabs = await chrome.tabs.query({ url: source.match, discarded: false })
  // More than one tab can match, and for Instagram it usually does: the pattern
  // has to cover the whole site, so a feed tab matches as readily as the DM. Take
  // the one the user was in most recently — clicking into the conversation and
  // then coming back here is what an import *is*, so recency is the signal, and
  // taking whatever the array happened to list first meant a background feed tab
  // could answer "no DM is open" while the DM sat open one tab over.
  const rank = (t: chrome.tabs.Tab) => t.lastAccessed ?? (t.active ? 1 : 0)
  const target = [...tabs].sort((a, b) => rank(b) - rank(a))[0]
  const tabId = target?.id
  if (tabId === undefined) {
    throw new Error(`No ${source.label} tab is open. Open ${source.where}, go to the conversation, and try again.`)
  }

  // Kept apart from the driver's own note rather than seeded into it: they can
  // both be true, and folding them together would let this one stand in for the
  // "didn't finish" warning below.
  const ambiguous =
    tabs.length > 1 ? `read the ${source.label} tab you were in last, of ${tabs.length} open` : null

  const byId = new Map<string, RawMessage>()
  let peer: string | null = null
  let note: string | null = null
  let done = false

  for (let pass = 0; pass < MAX_PASSES && !done; pass++) {
    let injected
    try {
      injected = await chrome.scripting.executeScript({
        target: { tabId },
        // WhatsApp and Instagram need the page's own module registry and RED
        // needs its patched `fetch`, none of which exist anywhere else. Telegram
        // only reads the DOM, but runs there too so all four keep their progress
        // in one place.
        world: 'MAIN',
        func: source.fetch,
        args: [{ last, budgetMs: BUDGET_MS, restart: pass === 0 }],
      })
    } catch (e) {
      throw new Error(`Couldn't read the ${source.label} tab: ${(e as Error).message}`)
    }
    const data = injected[0]?.result
    if (!data) throw new Error(`The ${source.label} tab returned nothing — is it still on ${source.where}?`)
    if (data.error) throw new Error(data.error)
    peer = data.peer ?? peer
    note = data.note ?? note
    for (const m of data.messages ?? []) byId.set(m.id, m)
    onProgress(byId.size)
    done = !!data.done
  }

  const all = Array.from(byId.values()).sort((a, b) => a.order - b.order)
  // Trim after fetching, never before: the overshoot is what lets a reply quoting
  // a message just outside the window still render its `[re: …]`.
  const tail = last ? all.slice(-last) : all
  if (!tail.length) throw new Error(`${source.label} gave back no messages for that conversation.`)

  const progress = done ? note : (note ?? `Stopped after ${MAX_PASSES} passes — older history may remain.`)
  return {
    text: renderLog(tail),
    peer,
    count: tail.length,
    note: [ambiguous, progress].filter(Boolean).join(' · ') || null,
  }
}

const LAST_KEY = 'dateBroImportLast'

/**
 * The "last N" the previous fetch ran with. Kept because it is a habit rather
 * than a per-conversation choice — someone who wants the last 50 wants it every
 * time — and it is stored on the way out of a fetch, not on every keystroke, so
 * what comes back is a count that was actually used.
 */
export async function getImportLast(): Promise<string> {
  const result = await chrome.storage.local.get(LAST_KEY)
  return result[LAST_KEY] ?? ''
}

export async function setImportLast(value: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_KEY]: value })
}
