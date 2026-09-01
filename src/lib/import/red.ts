import type { FetchArgs, RawMessage } from './render'

/**
 * One Xiaohongshu (小红书 / RED) DM thread, read by paging the IM API the web
 * app itself pages: /api/im/web/messages/history, newest first.
 *
 * The API lives on edith.xiaohongshu.com and rejects unsigned calls — every
 * request needs x-s / x-t / x-s-common headers derived from the body by the
 * obfuscated signer the page ships. Reimplementing that is a losing game
 * against RED's next deploy, but the page patches `window.fetch` to sign
 * everything on the way out, so a plain fetch() from the MAIN world is signed
 * for free. That is the whole trick, and it is why this driver must run there.
 *
 * Like Instagram, a single pass runs to completion and ignores
 * `budgetMs`/`restart`: it is a plain request loop with no page to keep mounted
 * and no scroll position to hold, so a pass that stopped early would only
 * re-derive the cursor it threw away. Pages arriving newest-first is what makes
 * `last` cheap — it stops as soon as it has enough, and that *is* the tail.
 *
 * Everything is inlined: `chrome.scripting` serialises this function, so it
 * cannot close over an import or a module constant.
 */
export async function fetchRed(args: FetchArgs) {
  const API = 'https://edith.xiaohongshu.com'
  const PAGE = 100
  const MAX_PAGES = 200

  if (!location.hostname.endsWith('xiaohongshu.com')) {
    return { error: 'That tab is not on xiaohongshu.com.' }
  }
  const peerId = (location.pathname.match(/\/chat\/([^/?#]+)/) || [])[1]
  if (!peerId) {
    return { error: 'No RED chat is open — click into the conversation, so the address bar reads /chat/…' }
  }

  const api = async (path: string) => {
    const r = await fetch(API + path, { credentials: 'include' })
    const j = await r.json()
    if (j.code !== 0) throw new Error(`${path.split('?')[0]} → ${j.code} ${j.msg || ''}`)
    return j.data
  }

  // The conversation list is the only place carrying the peer's nickname, my own
  // id, and the store_id bounds of the thread — the history endpoint reports
  // none of the three, and there is no has_more flag to trust in its place.
  const chats: any[] = []
  try {
    for (let page = 0; page < 20; page++) {
      const d = await api(`/api/im/web/v3/chats?limit=100&complete=true&page=${page}&source=pc`)
      const rows = d.chats || []
      chats.push(...rows)
      // `rows.length < 100` is the reliable terminator; `total` only saves a
      // round trip. Falling back to 0 made the total the terminator instead —
      // `length >= 0` is always true, so a missing field ended the walk after
      // one page and a thread past the hundredth chat became "not in the list".
      if (rows.length < 100 || chats.length >= (d.total ?? Infinity)) break
    }
  } catch (e) {
    return { error: `Couldn't read the RED chat list (${(e as Error).message}) — is that tab logged in?` }
  }

  const chat = chats.find((c) => c.chat_user_id === peerId)
  if (!chat) {
    return { error: 'That conversation is not in RED\'s chat list — open it in RED once, then try again.' }
  }
  // Three fields the rest of this function trusts completely, so they are
  // checked here rather than failing quietly further down. `user_id` decides
  // which side every message is on: absent, it makes `out` false for every row
  // and hands the coach a conversation the user never spoke in — a full-looking
  // transcript with no error on it. The bounds decide whether the walk runs at
  // all: absent, it fetches zero pages and the caller reports "no messages for
  // that conversation", which reads as an empty chat rather than a field this
  // couldn't read.
  const meId = chat.user_id
  const top = Number(chat.max_store_id)
  const bottom = Number(chat.start_store_id || 0)
  if (!meId) {
    return { error: "Couldn't tell which side of that RED conversation is you — reload the tab and try again." }
  }
  if (!Number.isFinite(top) || top < 1 || !Number.isFinite(bottom)) {
    return { error: "RED didn't say how far that conversation goes back — reload the tab and try again." }
  }

  // `content` is a JSON string and `content_type` says how to read it; types 3
  // and 13 wrap a second JSON object inside it (so does 4, which is dropped
  // unread). `front_chain` — the one-line
  // preview the conversation list shows, carried *inside* that content payload
  // rather than on the message row — is what makes an unrecognised type still
  // render as the app's own label for it rather than a number.
  const parse = (raw: string) => {
    try {
      return JSON.parse(raw || '{}')
    } catch {
      // A body that isn't JSON is a body RED wrote as a plain string, so it is
      // claimed as text: anything else discards the one thing it was carrying.
      return { content: String(raw || ''), content_type: 1 }
    }
  }
  const nested = (c: any) => {
    try {
      return JSON.parse(c.content || '{}')
    } catch {
      return {}
    }
  }
  const read = (
    c: any,
  ): { text?: string; media?: string; shared?: string; system?: boolean; missing?: boolean } => {
    switch (c.content_type) {
      case 1:
        return { text: c.content || '' }
      // A shared post. The title is what the other person actually put in front
      // of you — the same thing `shared` carries for an Instagram xma — while
      // the app's own preview only wraps it in "[笔记]".
      case 3:
        return { shared: nested(c).title || c.front_chain || 'note' }
      case 4:
        return { system: true }
      case 13:
        return { media: `sticker ${nested(c).emojiKey || ''}`.trim() }
      // A store_id whose body the web tier does not have: the conversation
      // happened in the mobile app, and the app answers "[消息] 点击查看". RED
      // still fabricates a row for it, stamped with the time of *this* request
      // and with the caller as sender — so the gap is real but the speaker and
      // the clock on it are not, which is why these can never become turns.
      case 0:
        return { missing: true }
      default:
        // `front_chain` arrives already bracketed ("[图片]", "[笔记] …") and
        // `renderLog` adds its own, so the app's brackets are unwrapped rather
        // than doubled into "[[图片]]".
        return { media: (c.front_chain || `type ${c.content_type}`).replace(/^\[([^\]]*)\]\s*/, '$1 ').trim() }
    }
  }

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
  // History pages backwards on store_id, a per-conversation sequence number, and
  // last_id is an inclusive upper bound — so the next page asks for one below the
  // lowest seen, and the walk simply stops when it reaches the bottom of the range.
  const byId = new Map<string, any>()
  let cursor = top
  let pages = 0
  let kept = 0
  let note: string | null = null
  // `store_id` is 1-based, so a cursor below 1 has run off the bottom of the
  // conversation. Stopping at `bottom` alone wasn't enough: a thread whose
  // `start_store_id` is 0 sent one more request with `last_id=0`, which RED
  // answers with the oldest page again — indistinguishable, one line down, from
  // a server repeating itself.
  while (pages < MAX_PAGES && cursor >= Math.max(bottom, 1)) {
    let d: any
    try {
      d = await api(
        `/api/im/web/messages/history?chat_user_id=${peerId}&last_id=${cursor}&start_id=${bottom}&limit=${PAGE}`,
      )
    } catch (e) {
      note = `stopped early: ${(e as Error).message}`
      break
    }
    const rows: any[] = d.out_message_list || []
    pages++
    if (!rows.length) break
    let low = Infinity
    for (const m of rows) {
      // Counted before the row lands, so a page the server repeats can't inflate
      // the tally. What's counted is what will still be here after the drops
      // below: on a thread lived mostly in the mobile app the unreadable rows
      // outnumber the readable ones, and counting rows would have answered
      // "last 50" with a handful of lines.
      if (!byId.has(m.id)) {
        const r = read(parse(m.content))
        if (!r.missing && !r.system) kept++
      }
      byId.set(m.id, m)
      const id = Number(m.store_id)
      if (Number.isFinite(id)) low = Math.min(low, id)
    }
    // Pages run newest-first, so having enough of them means having the tail.
    // Everything fetched is returned and the caller trims: the overshoot is what
    // resolves a reply quoting a message just outside the window.
    if (args.last && kept >= args.last) break
    if (!(low < cursor)) {
      // Either the server repeated a page or no row carried a usable store_id.
      // Every other early exit says so; this one used to look like a clean
      // finish, which is the one thing a truncated import must never look like.
      note = note ?? 'stopped early: RED stopped handing back older messages'
      break
    }
    cursor = low - 1
    await sleep(150)
  }
  if (pages >= MAX_PAGES) note = note ?? `stopped at ${MAX_PAGES} pages — older history remains`

  // A quoted reply carries its own copy of what it quotes, so it resolves
  // without the fetched window having to contain the original.
  const quote = (m: any) => {
    const r = read(parse(m.content))
    return (r.text || r.shared || r.media || '').replace(/\s+/g, ' ').trim() || null
  }

  const rows = Array.from(byId.values()).sort((a, b) => Number(a.store_id) - Number(b.store_id))

  const messages: RawMessage[] = []
  let missing = 0
  let run = 0
  for (const m of rows) {
    const c = parse(m.content)
    const r = read(c)
    if (r.missing) {
      missing++
      run++
      continue
    }
    // RED's own notices — stranger-message limits and the like — are not
    // something either person said.
    if (r.system) continue
    let text = r.text || ''
    // A run of unreadable messages is marked in place on the next real turn
    // rather than becoming that many invented ones: attached to a line that has
    // an honest speaker and clock, it reads as "before this, N we couldn't get".
    if (run) {
      text = `[… ${run} message${run > 1 ? 's' : ''} not readable on web …] ${text}`.trim()
      run = 0
    }
    messages.push({
      id: m.id,
      order: Number(m.store_id),
      ts: Number(m.created_at),
      out: m.sender_id === meId,
      text,
      media: m.revoked ? 'deleted' : r.media || null,
      reply: m.ref_message ? quote(m.ref_message) : null,
      shared: r.shared || null,
    })
  }

  // A run at the very end has no next turn to attach to, and on a thread whose
  // recent exchange happened in the app that is the gap the coach most needs —
  // so it goes on the back of the last real message instead, reading forwards
  // as "after this, N we couldn't get".
  const tail = messages[messages.length - 1]
  if (run && tail) {
    tail.text = `${tail.text} [… ${run} message${run > 1 ? 's' : ''} not readable on web …]`.trim()
  }
  // Nothing readable at all, and unreadable rows to explain it: the caller's
  // "gave back no messages" would read as an empty conversation, which is the
  // one thing this is not.
  if (!messages.length && missing) {
    return {
      error: `All ${missing} message${missing > 1 ? 's' : ''} in that conversation were sent from the RED app, which can't be read on web. Nothing to import.`,
    }
  }

  return {
    peer: chat.info?.nickname || chat.info?.user_name || null,
    messages,
    done: true,
    note: [
      note,
      // Counted across everything fetched, which is a little wider than what the
      // caller trims to — so "in this fetch" rather than a count of what is on
      // screen. The magnitude is the part that matters: it says how much of the
      // thread the coach is not seeing, which changes what its read is worth.
      missing
        ? `${missing} message${missing > 1 ? 's' : ''} in this fetch ${missing > 1 ? 'were' : 'was'} sent from the RED app and can't be read on web`
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || null,
  }
}
