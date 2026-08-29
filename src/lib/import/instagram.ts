import type { RawMessage } from './render'

/**
 * One Instagram DM thread, read the way the web app reads it: repeated POSTs to
 * /api/graphql, twenty messages a page, newest first.
 *
 * Runs in the page's MAIN world because the only copy of the auth tokens is in
 * Instagram's own module registry. Pages arriving newest-first is what makes
 * `last` cheap here — it stops as soon as it has enough, and that *is* the tail.
 *
 * Everything is inlined: `chrome.scripting` serialises this function, so it
 * cannot close over an import or a module constant.
 */
export async function fetchInstagram(args: { last: number }) {
  const QUERY = 'IGDMessageListOffMsysQuery'
  // The last id seen in the wild, for when resolution comes up empty.
  const FALLBACK_DOC = '27502152406082940'
  const MAX_PAGES = 500

  if (!location.hostname.endsWith('instagram.com')) {
    return { error: 'That tab is not on instagram.com.' }
  }
  const threadId = (location.pathname.match(/\/direct\/t\/(\d+)/) || [])[1]
  if (!threadId) {
    return { error: 'No Instagram DM is open — go to the conversation itself, so the address bar reads /direct/t/…' }
  }

  const req = (globalThis as Record<string, any>).require
  const mod = (name: string) => {
    try {
      return req(name)
    } catch {
      return null
    }
  }
  const dtsg = (mod('DTSGInitialData') || {}).token || (mod('DTSG_ASYNC') || {}).token
  const lsd = (mod('LSD') || {}).token
  const av = (mod('CurrentUserInitialData') || {}).ACCOUNT_ID
  // `av` is sent with every request, so a missing one goes out as the literal
  // "undefined" and comes back as a GraphQL error about nothing in particular.
  if (!dtsg || !lsd || !av) return { error: 'Instagram auth tokens not found — is that tab logged in?' }

  // jazoest is a checksum of fb_dtsg; the server rejects a mismatch.
  let sum = 0
  for (const c of dtsg as string) sum += c.charCodeAt(0)
  const jazoest = '2' + sum

  // Relay's persisted-query id lives in the generated artifact the page already
  // downloaded, as {id:"<doc_id>",…,name:"<QUERY>"} — verbatim, even minified.
  // Instagram rotates it on deploy, so read it back rather than pinning one.
  async function resolveDocId(): Promise<string | null> {
    for (const cand of [`${QUERY}.graphql`, `${QUERY}$Parameters`, `${QUERY}_facebookRelayOperation`]) {
      const m = mod(cand)
      const id = m?.params?.id ?? m?.default?.params?.id ?? m?.id
      if (id) return String(id)
    }
    // Route chunks load after the main bundle, so newest-first finds the DM
    // artifact early.
    const byRecency = performance
      .getEntriesByType('resource')
      .filter((e) => /\.js(\?|$)/.test(e.name))
      .sort((a, b) => b.startTime - a.startTime)
      .map((e) => e.name)
    const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).src)
    const urls = Array.from(new Set([...byRecency, ...scripts]))
    const scan = async (url: string) => {
      // credentials omitted: these are CDN statics and answer from the HTTP cache.
      const txt = await fetch(url, { credentials: 'omit' })
        .then((r) => (r.ok ? r.text() : ''))
        .catch(() => '')
      const at = txt.indexOf(`"${QUERY}"`)
      if (at < 0) return null
      const ids = Array.from(txt.slice(Math.max(0, at - 400), at).matchAll(/"?id"?\s*:\s*"(\d{6,})"/g))
      return ids.length ? ids[ids.length - 1]![1]! : null
    }
    for (let i = 0; i < urls.length; i += 8) {
      const hit = (await Promise.all(urls.slice(i, i + 8).map(scan))).find(Boolean)
      if (hit) return hit
    }
    return null
  }

  const docId = (await resolveDocId().catch(() => null)) || FALLBACK_DOC

  const page = async (after: string | null) => {
    const body = new URLSearchParams({
      av,
      __d: 'www',
      __user: '0',
      __a: '1',
      __comet_req: '7',
      fb_dtsg: dtsg,
      jazoest,
      lsd,
      __crn: 'comet.igweb.PolarisDirectInboxRoute',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: QUERY,
      server_timestamps: 'true',
      doc_id: docId,
      variables: JSON.stringify({
        after,
        before: null,
        first: 20,
        last: null,
        newer_than_message_id: null,
        older_than_message_id: null,
        id: threadId,
        __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
      }),
    })
    const r = await fetch('/api/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-fb-friendly-name': QUERY,
        'x-csrftoken': (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '',
        'x-fb-lsd': lsd,
        'x-ig-app-id': '936619743392459',
      },
      body,
    })
    const txt = await r.text()
    return JSON.parse(txt.startsWith('for (;;);') ? txt.slice(9) : txt)
  }

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
  const byId = new Map<string, any>()
  let after: string | null = null
  let pages = 0
  let note: string | null = null
  while (pages < MAX_PAGES) {
    let j: any
    try {
      j = await page(after)
    } catch (e) {
      note = `stopped early: ${(e as Error).message}`
      break
    }
    const thread = j?.data?.fetch__SlideThread?.as_ig_direct_thread
    if (!thread) {
      return { error: `Instagram gave an answer this doesn't understand (doc_id ${docId}). It may have changed its API.` }
    }
    for (const e of thread.slide_messages.edges) byId.set(e.node.message_id, e.node)
    pages++
    // Pages run newest-first, so having enough of them means having the tail.
    // Everything fetched is returned and the caller trims: the overshoot is what
    // resolves a reply quoting a message just outside the window.
    if (args.last && byId.size >= args.last) break
    if (!thread.slide_messages.page_info.has_next_page) break
    after = thread.slide_messages.page_info.end_cursor
    await sleep(350)
  }
  if (pages >= MAX_PAGES) note = `stopped at ${MAX_PAGES} pages — older history remains`

  // Instagram sends one node type per attachment kind; only text carries a
  // text_body. The pluralisation is theirs: Image is singular, Videos is not.
  const MEDIA: Record<string, string> = {
    SlideMessageImageContent: 'image',
    SlideMessageRavenImageContent: 'disappearing photo',
    SlideMessageVideosContent: 'video',
    SlideMessageStickerContent: 'sticker',
  }
  const clock = (ms: number) => {
    const sec = Math.round((ms || 0) / 1000)
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  }

  const nodes = Array.from(byId.values()).sort((a, b) => a.timestamp_ms - b.timestamp_ms)
  const quoted = new Map<string, string>(
    nodes.map((n) => [n.message_id, (n.text_body || '').replace(/\s+/g, ' ').trim()]),
  )

  const messages: RawMessage[] = []
  for (const n of nodes) {
    const type = n.content?.__typename || n.content_type
    // Join/leave notices are not something either person said.
    if (type === 'SlideMessageAdminText') continue
    const audio = (n.content?.audio_attachments || []) as any[]
    let media: string | null = null
    if (audio.length) media = `voice message ${audio.map((a) => clock(a.playable_duration_ms)).join(' + ')}`
    else if (MEDIA[type]) media = MEDIA[type]!
    const replyId = n.replied_to_message?.message_id || n.replied_to_message_id || null
    const reactions = (n.reactions || []).map((r: any) => r.reaction).filter(Boolean).join('')
    messages.push({
      id: n.message_id,
      order: Number(n.timestamp_ms),
      ts: Number(n.timestamp_ms),
      // The id in the URL is the other participant's fbid, so anyone else is me.
      out: n.sender_fbid !== threadId,
      text: n.text_body || '',
      media,
      reply: replyId ? quoted.get(replyId) || null : null,
      reactions: reactions || null,
      shared: n.content?.xma?.title_text || n.content?.xma?.header_title_text || n.content?.xma?.target_url || null,
    })
  }

  const peerName = nodes.find((n) => n.sender_fbid === threadId)?.sender
  return {
    peer: peerName?.username || peerName?.name || null,
    messages,
    done: true,
    note,
  }
}
