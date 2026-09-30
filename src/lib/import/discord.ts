import type { FetchArgs, RawMessage } from './render'

/**
 * One Discord DM, read the way the web app reads it: GET /channels/<id>/messages,
 * a hundred at a time, newest first, each page asking for what is older than the
 * last one's oldest message.
 *
 * Runs in the page's MAIN world because the session token exists nowhere else:
 * Discord deletes `window.localStorage` and keeps the token in an in-memory
 * store. It is read from there, used for same-origin requests to discord.com and
 * handed to nothing else — not returned, not logged, not put in an error message.
 *
 * Like Instagram and RED, a single pass runs to completion and ignores
 * `budgetMs`/`restart`: it is a plain request loop with no page to keep mounted
 * and no scroll position to hold. Pages arriving newest-first is what makes
 * `last` cheap — it stops as soon as it has enough, and that *is* the tail.
 *
 * Everything is inlined: `chrome.scripting` serialises this function, so it
 * cannot close over an import or a module constant.
 */
export async function fetchDiscord(args: FetchArgs) {
  const API = '/api/v9'
  const PAGE = 100
  const MAX_PAGES = 200
  const REQUEST_TIMEOUT_MS = 20_000
  // What a person said, as opposed to what the app says about the chat: default
  // messages, replies, and calls. Everything else is a notice — pins, renames,
  // and types the public docs don't list (67 turned up as the oldest row of a
  // fresh DM, empty and unattributable to anyone).
  const SPOKEN = new Set([0, 19, 3])
  // Message flag: the attachment is a voice message, not a file.
  const VOICE = 1 << 13

  if (!location.hostname.endsWith('discord.com')) {
    return { error: 'That tab is not on discord.com.' }
  }
  const channelId = (location.pathname.match(/^\/channels\/@me\/(\d+)/) || [])[1]
  if (!channelId) {
    return { error: 'No Discord DM is open — click into the conversation, so the address bar reads /channels/@me/…' }
  }

  // The client is several webpack runtimes sharing one chunk array, and pushing a
  // chunk calls back once per runtime — newest first. Keeping only the last
  // `require` found a 100-module runtime holding none of the app, while the app
  // itself (thousands of modules) is the first call. So every one is collected.
  //
  // The store is recognised by `getName()`, which Flux gives every store and which
  // survives minification, rather than by the export key it happens to sit under
  // (`A`, `Ay`, `default` — all three in one build, renamed in the next). A
  // catch-all proxy in the registry answers every method with a function, so
  // having `getToken` alone proves nothing; its `getName()` is not this string.
  const chunks = (globalThis as Record<string, any>).webpackChunkdiscord_app
  if (!chunks) return { error: "That tab isn't Discord's web app — reload it and try again." }
  const runtimes: any[] = []
  chunks.push([[Symbol()], {}, (r: any) => runtimes.push(r)])
  chunks.pop()
  const findAuth = () => {
    for (const r of runtimes) {
      for (const id in r.c || {}) {
        let ex: any
        try {
          ex = r.c[id].exports
        } catch {
          continue
        }
        if (!ex || (typeof ex !== 'object' && typeof ex !== 'function')) continue
        for (const key of Object.keys(ex)) {
          try {
            const o = ex[key]
            if (o && typeof o.getToken === 'function' && typeof o.getName === 'function' && o.getName() === 'AuthenticationStore') {
              return o
            }
          } catch {
            // A getter that throws is not the store.
          }
        }
      }
    }
    return null
  }
  const auth = findAuth()
  if (!auth) {
    return {
      error: "Couldn't find Discord's session in that tab — reload it and try again. If it keeps happening, Discord has changed how its page is built.",
    }
  }
  const token = auth.getToken()
  if (!token) return { error: 'That Discord tab is not logged in.' }

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
  const api = async (path: string) => {
    for (let attempt = 0; ; attempt++) {
      // A stalled request has nowhere to be interrupted from: this driver does
      // everything in pass 0, so `sources.ts` never reaches another `aborted`
      // check and Stop cannot end it. The timeout is the only exit — and it covers
      // the body as well as the headers, so the read sits inside the same try.
      // Rethrown under its own name because `AbortSignal.timeout` says "signal
      // timed out", which in an import note reads as a bug here, not the network.
      let r: Response
      let text: string
      try {
        r = await fetch(API + path, {
          headers: { Authorization: token },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        text = await r.text()
      } catch (e) {
        if ((e as Error).name === 'TimeoutError') {
          throw new Error(`Discord did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`)
        }
        throw e
      }
      let body: any = null
      try {
        body = JSON.parse(text)
      } catch {
        // An error page rather than JSON; the status still says what happened.
      }
      // The page is shown no x-ratelimit headers on this route (measured: all
      // null), so there is nothing to pace against in advance — the 429 is the
      // only signal, and it carries how long to wait. Kept well under the point
      // where a pass would look hung. A hidden tab's timers may oversleep this,
      // which for a wait is the harmless direction.
      if (r.status === 429 && attempt < 3) {
        await sleep(Math.min(Number(body?.retry_after) || 1, 30) * 1000)
        continue
      }
      if (!r.ok) throw new Error(`Discord answered ${r.status}${body?.message ? ` — ${body.message}` : ''}`)
      return body
    }
  }

  // One request for who is on the other end. In a one-to-one DM `recipients` is
  // exactly the other person — it leaves out the caller — so `out` needs nothing
  // but this: any author who isn't them is me. Unlike Instagram, where the id in
  // the url is a guess at the other participant, this is what Discord says.
  let channel: any
  try {
    channel = await api(`/channels/${channelId}`)
  } catch (e) {
    return { error: `Couldn't read that Discord conversation (${(e as Error).message}) — is that tab logged in?` }
  }
  const other = channel?.recipients?.[0]
  if (!other || channel.type !== 1 || channel.recipients.length !== 1) {
    return { error: "That Discord conversation isn't a one-to-one DM — this reads DMs, where the other person is the only one in the chat." }
  }

  const rows: any[] = []
  let before: string | null = null
  let pages = 0
  let kept = 0
  let note: string | null = null
  let reachedEnd = false
  while (pages < MAX_PAGES) {
    let page: any
    try {
      page = await api(`/channels/${channelId}/messages?limit=${PAGE}${before ? `&before=${before}` : ''}`)
    } catch (e) {
      note = `stopped early: ${(e as Error).message}`
      break
    }
    if (!Array.isArray(page)) {
      return { error: "Discord gave an answer this doesn't understand. It may have changed its API." }
    }
    pages++
    // The end is an empty page, not a short one: the docs promise at most
    // `limit` messages, not that a page is full whenever more remain.
    if (!page.length) {
      reachedEnd = true
      break
    }
    for (const m of page) {
      rows.push(m)
      if (SPOKEN.has(m.type)) kept++
    }
    // Pages run newest-first, so having enough of them means having the tail.
    // Everything fetched is returned and the caller trims: the overshoot is what
    // resolves a reply quoting a message just outside the window.
    if (args.last && kept >= args.last) {
      reachedEnd = true
      break
    }
    before = page[page.length - 1].id
    // No pause between pages, unlike the other two request loops, and on purpose.
    // The tab being read is in the background — the user is in this app — and a
    // hidden tab's timers are throttled: measured here, `setTimeout(350)` took a
    // second for the first few, then 23s, then a full minute once a handful had
    // chained, so a pause per page turned a long history into a page a minute. A
    // request's own round trip (~400ms, about 2.6 a second, 12 in a row without a
    // 429) is the pacing; the 429 handling in `api` is the brake.
  }
  // Only when the loop ran out of allowance rather than out of history: a thread
  // that ends on its last permitted page has nothing older, and saying otherwise
  // sends the user hunting for messages that don't exist. `??` so an error caught
  // on that same page keeps its own, more specific message.
  if (!reachedEnd && pages >= MAX_PAGES) {
    note = note ?? `stopped at ${MAX_PAGES} pages — older history remains`
  }

  const clock = (secs: number) => {
    const s = Math.round(Number(secs) || 0)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // A call is a row with no text. Who started it is the author; whether anyone
  // picked up is whether a second person joined, and how long it ran is the gap to
  // the moment it ended. Read from the documented `call` object, and every part is
  // optional so a payload that differs still comes back as a plain "call".
  const callLabel = (m: any) => {
    const c = m.call || {}
    const answered = (c.participants || []).length > 1
    const secs = c.ended_timestamp ? (Date.parse(c.ended_timestamp) - Date.parse(m.timestamp)) / 1000 : 0
    return ['call', answered ? null : 'not answered', answered && secs > 0 ? clock(secs) : null].filter(Boolean).join(', ')
  }

  // What one message says, separated from who said it and when — because a reply
  // quotes another message, and that quote is read the same way. A forward is an
  // empty message wrapping a snapshot of the original, so the snapshot is what is
  // read; without that every forward came back with nothing in it.
  const read = (x: any) => {
    const snap = x.message_snapshots?.[0]?.message
    const src = snap || x
    const names = new Map<string, string>((src.mentions || []).map((u: any) => [u.id, u.global_name || u.username]))
    // Raw content carries `<@id>` and `<:name:id>` for things the app draws as a
    // name and an image; left alone they are noise in the one place a model reads.
    const text: string = (src.content || '')
      .replace(/<@!?(\d+)>/g, (s: string, id: string) => (names.has(id) ? `@${names.get(id)}` : s))
      .replace(/<a?:(\w+):\d+>/g, ':$1:')

    const labels: string[] = []
    if (x.type === 3) labels.push(callLabel(x))
    const files = new Map<string, number>()
    for (const a of src.attachments || []) {
      const type = String(a.content_type || '')
      const label =
        src.flags & VOICE
          ? `voice message ${clock(a.duration_secs)}`
          : type === 'image/gif'
            ? 'gif'
            : type.startsWith('image/')
              ? 'image'
              : type.startsWith('video/')
                ? 'video'
                : type.startsWith('audio/')
                  ? 'audio'
                  : `file ${a.filename || ''}`.trim()
      files.set(label, (files.get(label) || 0) + 1)
    }
    for (const [label, n] of files) labels.push(n > 1 ? `${n} × ${label}` : label)
    for (const s of src.sticker_items || []) labels.push(`sticker ${s.name || ''}`.trim())
    // A GIF from the picker is sent as its link, which renders as an animation
    // and is otherwise indistinguishable from any other url in the text.
    if ((src.embeds || []).some((e: any) => e.type === 'gifv')) labels.push('gif')

    // The page title of a shared link — what the other person actually put in
    // front of you, where the text holds only the url.
    const shared = (src.embeds || []).filter((e: any) => e.type !== 'gifv').map((e: any) => e.title).find(Boolean)
    return { text, media: labels.join(' + ') || null, shared: shared || null, forwarded: !!snap }
  }

  const messages: RawMessage[] = []
  for (const m of rows) {
    if (!SPOKEN.has(m.type)) continue
    const said = read(m)
    // A quoted reply carries its own copy of what it quotes, so it resolves
    // without the fetched window having to contain the original. Absent when the
    // original was deleted. Cut by code point for the reason `whatsapp.ts` is:
    // `slice`'s UTF-16 units can orphan half an emoji.
    const quoted = m.referenced_message ? read(m.referenced_message) : null
    const quote = quoted ? quoted.text || quoted.media || '' : ''
    const reactions = (m.reactions || [])
      .map((r: any) => (r.emoji?.id ? `:${r.emoji.name}:` : r.emoji?.name || ''))
      .join('')
    // Milliseconds, and enough: two messages in one DM cannot be created in the
    // same one. The snowflake id can't stand in — 19 digits is past what a number
    // holds exactly.
    const at = Date.parse(m.timestamp)
    messages.push({
      id: m.id,
      order: at,
      ts: at,
      out: m.author?.id !== other.id,
      text: said.text,
      media: said.media,
      reply: quote ? Array.from(quote).slice(0, 60).join('') : null,
      via: said.forwarded ? 'forwarded' : null,
      reactions: reactions || null,
      shared: said.shared,
    })
  }

  return {
    peer: other.global_name || other.username || null,
    messages,
    done: true,
    note,
  }
}
