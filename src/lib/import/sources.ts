import { renderLog, type FetchArgs, type RawMessage } from './render'
import { fetchDiscord } from './discord'
import { fetchInstagram } from './instagram'
import { fetchRed } from './red'
import { fetchTelegram } from './telegram'
import { fetchWhatsApp } from './whatsapp'

export type SourceId = 'whatsapp' | 'telegram' | 'instagram' | 'red' | 'discord'

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
   * passes have one; Instagram, RED and Discord finish in pass 0 and hold nothing.
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
    // Narrowed to the DM section rather than the whole site, for the reason RED
    // is: with `/*`, a feed tab matched as readily as the conversation, and the
    // tab ranking below can only ever pick one of them — so an open DM plus an
    // open feed tab answered "No Instagram DM is open" whenever the feed was the
    // one touched last, with the thread sitting one tab over.
    //
    // `/direct/*` and not `/direct/t/*`: the inbox is still the DM section, and
    // the driver's own error is the one worth reaching from there — it names the
    // `/direct/t/…` url to go to, which "no Instagram tab is open" does not.
    match: '*://*.instagram.com/direct/*',
    where: 'instagram.com',
    fetch: fetchInstagram,
  },
  {
    id: 'red',
    label: 'RED',
    // Matched down to the conversation's own page, because the id of the thread
    // to read lives in the url — so narrowing here means the tab lookup can
    // never hand the driver a tab it has nothing to say about, and "no RED tab
    // is open" is the honest error for a feed tab rather than something the
    // driver has to discover.
    //
    // `/chat*` rather than `/chat/*`: RED reaches the same conversation two
    // ways, `/chat/<id>` and the message page's `/chat?openUid=<id>`, and a
    // match pattern's path is matched against the query too — so the trailing
    // slash form excluded exactly the url the message page hands out. It costs
    // nothing that `/chat` with no id also matches now: the driver reads the id
    // itself and says which forms it accepts when there isn't one.
    match: '*://*.xiaohongshu.com/chat*',
    where: 'xiaohongshu.com',
    fetch: fetchRed,
  },
  {
    id: 'discord',
    label: 'Discord',
    // Narrowed to the DM section, for the reason Instagram is: a server channel
    // lives under `/channels/` too, and is something this has nothing to say
    // about — so `@me` is literal, and a server tab never becomes a candidate.
    //
    // `@me*` and not `@me/*`, for the same reason Instagram stops at `/direct/*`:
    // the friends list at `/channels/@me` is still the DM section, and the
    // driver's own error is the one worth reaching from there — it names the
    // `/channels/@me/…` url to go to. `*.discord.com` takes the bare domain too,
    // which is the one the web app actually lives on, and ptb. and canary.
    match: '*://*.discord.com/channels/@me*',
    where: 'discord.com',
    fetch: fetchDiscord,
  },
]

// Each pass is bounded so the injected function returns while the page is still
// listening, and picks up where it left off on the next one — the sources keep
// their progress in the tab. The cap is a runaway guard, not a budget.
const BUDGET_MS = 20_000
const MAX_PASSES = 200

/**
 * The import currently driving each tab, so the next one on it waits its turn.
 * A cancelled import only notices at its next pass boundary, up to a whole pass
 * later — and in that window the user can start again on the same tab. Run side
 * by side, two injected passes scroll the same list, and the old one's `done`
 * deletes the state the new pass 0 has just parked, sending its pass 1 back to
 * the start. Queued instead: the wait is at most one pass, and the signal is
 * checked before the first pass, so cancelling during it costs nothing.
 */
const inflight = new Map<number, Promise<void>>()

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
  // More than one tab can match — two threads open at once, an inbox beside a
  // conversation, two windows on the same site. Take the one the user was in
  // most recently: clicking into the conversation and then coming back here is
  // what an import *is*, so recency is the signal, and taking whatever the array
  // happened to list first meant a stale background tab could answer for a
  // conversation the user had left.
  //
  // Ranked as a pair, not one number. Folding the two into a single score meant
  // comparing epoch milliseconds against a 0/1 flag — so a tab that reports no
  // `lastAccessed` (it is Chrome 121+) lost to every tab that does, the active
  // one included, and the fallback could never actually decide anything.
  //
  // Recency stays primary and `active` only breaks its ties, deliberately in
  // that order: `active` is per *window*, so a stale tab that happens to be
  // frontmost in another window would otherwise outrank the conversation the
  // user was just reading here — the same wrong-tab answer, reached the other
  // way round.
  const seen = (t: chrome.tabs.Tab) => t.lastAccessed ?? 0
  const target = [...tabs].sort(
    (a, b) => seen(b) - seen(a) || (b.active ? 1 : 0) - (a.active ? 1 : 0),
  )[0]
  const tabId = target?.id
  if (tabId === undefined) {
    throw new Error(`No ${source.label} tab is open. Open ${source.where}, go to the conversation, and try again.`)
  }

  // Kept apart from the driver's own note rather than seeded into it: they can
  // both be true, and folding them together would let this one stand in for the
  // "didn't finish" warning below.
  const ambiguous =
    tabs.length > 1 ? `read the ${source.label} tab you were in last, of ${tabs.length} open` : null

  const previous = inflight.get(tabId)
  let release!: () => void
  const settled = new Promise<void>((r) => (release = r))
  inflight.set(tabId, settled)

  const byId = new Map<string, RawMessage>()
  let peer: string | null = null
  let note: string | null = null
  let done = false
  let began = false

  // A walk that ends without `done` — cancelled, or thrown out of — leaves the
  // driver's progress on the user's own tab, which for a long Telegram history
  // is a Map of every message harvested, sitting there until they reload the
  // site. Cancelling is exactly when the most has piled up, so the exit path
  // clears it rather than leaving it to the next import's `restart`.
  const clearState = async () => {
    // Nothing is parked if the walk finished — the driver frees its own state
    // on `done` — or never began, cancelled while still waiting for the tab.
    if (done || !began || !source.stateKey) return
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
    // Inside the try so the slot is released whatever happens from here on: an
    // import left waiting on a slot nobody releases would wait forever.
    // `settled` never rejects, and a wait the user gives up on ends at the
    // signal check below.
    if (previous) await previous
    for (let pass = 0; pass < MAX_PASSES && !done; pass++) {
      // Checked between passes rather than inside one: there is no way to reach
      // into a running `executeScript`. That bounds what this can do, and the
      // bound is worth naming — it stops the two resumable sources, where a
      // whole-history fetch walked away from would otherwise keep driving the tab
      // for up to `MAX_PASSES` × `BUDGET_MS`. Instagram, RED and Discord do the
      // whole import in pass 0, so cancelling them stops the UI from listening but
      // not the work; what caps those is their own `MAX_PAGES`, minutes rather than
      // an hour.
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
      let injected
      try {
        began = true
        injected = await chrome.scripting.executeScript({
          target: { tabId },
          // WhatsApp, Instagram and Discord need the page's own module registry
          // and RED needs its patched `fetch`, none of which exist anywhere else.
          // Telegram only reads the DOM, but runs there too so all five keep their
          // progress in one place.
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
    // Awaited, not fired and forgotten: the slot is what keeps the next import's
    // pass 0 off the tab, so it has to stay held until this one's cleanup has
    // actually landed. Released first, the two injections raced, and the loser
    // was the new import — its freshly parked state deleted under it, its pass
    // 1 sent back to the start.
    await clearState()
    // The tab is free once the loop is out of it; the trim and render below
    // never touch it. Only forget the slot if it is still ours — a later import
    // may already be queued in it.
    release()
    if (inflight.get(tabId) === settled) inflight.delete(tabId)
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
