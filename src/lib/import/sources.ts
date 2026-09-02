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
  /**
   * The global a resumable driver parks its progress under, so a walk that never
   * reaches `done` can still be cleaned up. Only the two that keep state between
   * passes have one; Instagram and RED finish in pass 0 and hold nothing.
   */
  stateKey?: string
}

export const SOURCES: SourceDef[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    match: '*://web.whatsapp.com/*',
    where: 'web.whatsapp.com',
    fetch: fetchWhatsApp,
    stateKey: '__dbWaImport',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    match: '*://web.telegram.org/*',
    where: 'web.telegram.org/a',
    fetch: fetchTelegram,
    stateKey: '__dbTgImport',
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

/**
 * Which import currently owns each tab's parked state. A cancelled import only
 * notices at its next pass boundary, up to a whole pass later — and in that
 * window the user can start again on the same tab, whose pass 0 re-creates the
 * state with `restart`. The old import's cleanup then lands on the new import's
 * progress. Ownership says whose it is.
 */
const owners = new Map<number, symbol>()

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
  signal?: AbortSignal,
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

  // A walk that ends without `done` — cancelled, or thrown out of — leaves the
  // driver's progress on the user's own tab, which for a long Telegram history
  // is a Map of every message harvested, sitting there until they reload the
  // site. Cancelling is exactly when the most has piled up, so the exit path
  // clears it rather than leaving it to the next import's `restart`.
  const me = Symbol('import')
  owners.set(tabId, me)
  const clearState = async () => {
    // A newer import on this tab has re-created the state and will clear its
    // own; deleting it from here would wipe that import's pass-0 progress and
    // send its pass 1 back to the start.
    if (owners.get(tabId) !== me) return
    owners.delete(tabId)
    if (done || !source.stateKey) return
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (key: string) => {
          delete (globalThis as Record<string, unknown>)[key]
        },
        args: [source.stateKey],
      })
    } catch {
      // The tab is gone or navigated away, which frees the state anyway.
    }
  }

  try {
    for (let pass = 0; pass < MAX_PASSES && !done; pass++) {
      // Checked between passes rather than inside one: there is no way to reach
      // into a running `executeScript`. That bounds what this can do, and the
      // bound is worth naming — it stops the two resumable sources, where a
      // whole-history fetch walked away from would otherwise keep driving the tab
      // for up to `MAX_PASSES` × `BUDGET_MS`. Instagram and RED do the whole
      // import in pass 0, so cancelling them stops the UI from listening but not
      // the work; what caps those is their own `MAX_PAGES`, minutes rather than
      // an hour.
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
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
  } finally {
    void clearState()
  }

  const all = Array.from(byId.values()).sort((a, b) => a.order - b.order)
  // Trim after fetching, never before: the overshoot is what lets a reply quoting
  // a message just outside the window still render its `[re: …]`.
  const tail = last ? all.slice(-last) : all
  // A driver that failed on its first page reports the reason as a note and
  // returns nothing — and "no messages for that conversation" reads as an empty
  // chat, which is the one thing it isn't. The note is the whole difference
  // between "nothing to import" and "your wifi dropped, try again".
  if (!tail.length) {
    throw new Error(
      note
        ? `${source.label} gave back no messages — ${note}`
        : `${source.label} gave back no messages for that conversation.`,
    )
  }

  // Kept apart for the same reason `ambiguous` is: a driver can both report
  // something and fail to finish, and letting its note stand in for the pass cap
  // would hide the one fact that changes what the transcript is worth.
  const capped = done ? null : `Stopped after ${MAX_PASSES} passes — older history may remain.`
  return {
    text: renderLog(tail),
    peer,
    count: tail.length,
    note: [ambiguous, note, capped].filter(Boolean).join(' · ') || null,
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
