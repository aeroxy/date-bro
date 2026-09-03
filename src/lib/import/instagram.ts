import type { FetchArgs, RawMessage } from './render'

/**
 * One Instagram DM thread, read the way the web app reads it: repeated POSTs to
 * /api/graphql, twenty messages a page, newest first.
 *
 * Runs in the page's MAIN world because the only copy of the auth tokens is in
 * Instagram's own module registry. Pages arriving newest-first is what makes
 * `last` cheap here — it stops as soon as it has enough, and that *is* the tail.
 *
 * The one source that runs to completion in a single pass, so it ignores
 * `budgetMs`/`restart` and always answers `done: true`. Nothing here needs the
 * cooperative yield the other two have: this is a plain request loop with no
 * page to keep mounted and no scroll position to hold, so a pass that stopped
 * early would only have to re-derive the cursor it just threw away. The cost is
 * that a whole history on a very long thread reports no progress until it
 * finishes — visible, and cheaper than page-global cursor state.
 *
 * Everything is inlined: `chrome.scripting` serialises this function, so it
 * cannot close over an import or a module constant.
 */
export async function fetchInstagram(args: FetchArgs) {
  const QUERY = 'IGDMessageListOffMsysQuery'
  // Only for when resolution comes up empty. Instagram rotates this on deploy,
  // so treat it as a stale guess worth one try rather than a pinned constant —
  // when the API-shape error below starts appearing, this is what's out of date.
  const FALLBACK_DOC = '27502152406082940'
  const MAX_PAGES = 500
  const REQUEST_TIMEOUT_MS = 20_000

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
  //
  // It is *not* the user's fbid, however much the name suggests otherwise:
  // measured on a logged-in page, `ACCOUNT_ID` is the string "0", matching no
  // sender in the thread. So `out` cannot be derived from it — the id in the
  // url is the only thing here that identifies a person. Written down because
  // "compare sender_fbid against av" is the obvious improvement to reach for,
  // and it would mark every message as the other person's.
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
      // Timed out short, and it is the whole batch's protection: `.catch` only
      // sees a fetch that *fails*, and one that stalls with headers received and
      // no body never settles at all — so `Promise.all` below would wait on it
      // forever, inside the one pass this driver ever gets. Five seconds is
      // generous for a cached static, and giving up costs only `FALLBACK_DOC`.
      const txt = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5_000) })
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
      // A stalled request has nowhere to be interrupted from: this driver does
      // everything in pass 0, so `sources.ts` never reaches another `aborted`
      // check and Stop cannot end it. The timeout is the only exit, and the
      // paging loop turns it into an honest "stopped early" note.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  let reachedEnd = false
  while (pages < MAX_PAGES) {
    let j: any
    try {
      j = await page(after)
    } catch (e) {
      // `AbortSignal.timeout` reports itself as "signal timed out", which in a
      // note about an import reads as a bug in the extension rather than the
      // network stalling. Named for what it was.
      const why =
        (e as Error).name === 'TimeoutError'
          ? `Instagram did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`
          : (e as Error).message
      note = `stopped early: ${why}`
      break
    }
    const thread = j?.data?.fetch__SlideThread?.as_ig_direct_thread
    // `slide_messages` is read unguarded twice below, so it belongs in the same
    // check as the thread: a shape that answers with one but not the other is
    // the same "they changed the API" problem, and throwing here would surface
    // as `sources.ts`'s "returned nothing" instead of saying so.
    if (!thread?.slide_messages) {
      return { error: `Instagram gave an answer this doesn't understand (doc_id ${docId}). It may have changed its API.` }
    }
    for (const e of thread.slide_messages.edges) byId.set(e.node.message_id, e.node)
    pages++
    // Pages run newest-first, so having enough of them means having the tail.
    // Everything fetched is returned and the caller trims: the overshoot is what
    // resolves a reply quoting a message just outside the window.
    if (args.last && byId.size >= args.last) {
      reachedEnd = true
      break
    }
    if (!thread.slide_messages.page_info.has_next_page) {
      reachedEnd = true
      break
    }
    after = thread.slide_messages.page_info.end_cursor
    await sleep(350)
  }
  // Only when the loop ran out of allowance rather than out of history: a thread
  // that happens to end on its last permitted page has nothing older, and
  // saying otherwise sends the user hunting for messages that don't exist. `??`
  // so an error caught on that same page keeps its own, more specific message.
  if (!reachedEnd && pages >= MAX_PAGES) {
    note = note ?? `stopped at ${MAX_PAGES} pages — older history remains`
  }

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

  // `out` rests on the id in the url being the other participant's fbid, which
  // holds for a 1:1 DM and not for a group, where it is nobody's. A 1:1 thread
  // can have at most two senders, so a third means that footing is gone — and
  // the failure would be silent in the worst direction: every message comes back
  // as mine and the coach reads a monologue as if the other person never spoke.
  // Normalised on both sides of every comparison, not just here. `threadId` is
  // a string off the url, and a numeric `sender_fbid` would make `!==` true for
  // everyone — the exact monologue above, with two senders in this set and the
  // backstop looking straight through it.
  // Counted over the same rows the render loop keeps. An admin row — a call
  // notice, a vanish-mode banner — is not a participant and often carries no
  // sender at all, and `String(undefined)` made it a third "person": a 1:1
  // thread refused outright, with copy sending the user to look for a group
  // that does not exist. A guard against silent misattribution must not be
  // trippable by rows it does not govern.
  const said = nodes.filter((n) => (n.content?.__typename || n.content_type) !== 'SlideMessageAdminText')
  const senders = new Set(
    said.map((n) => String(n.sender_fbid)).filter((id) => id && id !== 'undefined'),
  )
  if (senders.size > 2) {
    return {
      error: `That Instagram thread has ${senders.size} people in it — this reads one-to-one DMs, where the id in the url is the other person.`,
    }
  }
  // Two people spoke and neither is the id in the url, so that id is a thread
  // id and not a participant's — the same monologue, reached a different way.
  // Only checked at two senders: one sender who isn't the url id is the ordinary
  // shape of an opener nobody has answered yet, where every message really is
  // mine and there is nothing wrong to report.
  if (senders.size === 2 && !senders.has(threadId)) {
    return {
      error: `Neither sender in that Instagram thread matches the id in the url, so this can't tell which side is you. It reads one-to-one DMs, where that id is the other person.`,
    }
  }
  // One sender, and the id in the url isn't them. Two threads look identical
  // from here and the payload holds nothing that separates them:
  //
  //   - an opener nobody has answered, where the url id *is* the other person
  //     and every line really is mine;
  //   - an unanswered inbound DM read through a url whose id is the thread's
  //     rather than a participant's, where every line is theirs and `out` has
  //     the whole conversation backwards.
  //
  // So this can't be refused the way the two-sender case is — the honest opener
  // is far too ordinary to break, and the checks above would have caught the
  // bad footing if anyone had replied. It is said out loud instead: the wrong
  // reading hands the coach a monologue the user never wrote, and unlike the
  // errors above there is nothing else on screen that would show it. `peer`
  // comes back null in this case too, for the same reason — nobody matched.
  const oneSided =
    senders.size === 1 && !senders.has(threadId)
      ? 'only one person has spoken in that thread and the id in the url is not theirs, so every line is marked as yours — check that before importing'
      : null

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
      out: String(n.sender_fbid) !== threadId,
      text: n.text_body || '',
      media,
      reply: replyId ? quoted.get(replyId) || null : null,
      reactions: reactions || null,
      shared: n.content?.xma?.title_text || n.content?.xma?.header_title_text || n.content?.xma?.target_url || null,
    })
  }

  const peerName = nodes.find((n) => String(n.sender_fbid) === threadId)?.sender
  return {
    peer: peerName?.username || peerName?.name || null,
    messages,
    done: true,
    // Kept apart rather than folded into `note`: a thread can both stop early
    // and be one-sided, and letting either stand in for the other would hide
    // the one fact that changes what the transcript is worth.
    note: [note, oneSided].filter(Boolean).join(' · ') || null,
  }
}
