import type { RawMessage } from './render'

/**
 * The WhatsApp Web chat you have open, paged in through the app's own store.
 *
 * WhatsApp keeps message bodies encrypted at rest — the IndexedDB rows are
 * AES-CBC under a key that never leaves the page — so reading the database gives
 * ciphertext. The running app holds the decrypted models and its module loader
 * sits on `window.require`, so this asks the app instead: `loadEarlierMsgs` pages
 * history in exactly as scrolling up would.
 *
 * Resumable across calls. Progress lives on `window.__dbWaImport` and each call
 * returns only what it found since the last one, so a long history is many short
 * injections rather than one that outstays its welcome.
 *
 * Everything is inlined: `chrome.scripting` serialises this function, so it
 * cannot close over an import or a module constant.
 */
export async function fetchWhatsApp(args: { last: number; budgetMs: number; restart: boolean }) {
  if (!location.hostname.endsWith('web.whatsapp.com')) {
    return { error: 'That tab is not on web.whatsapp.com.' }
  }
  const req = (globalThis as Record<string, any>).require
  if (typeof req !== 'function') {
    return { error: 'WhatsApp changed its bundle — window.require is gone, so this can no longer ask the app for the chat.' }
  }

  let Collections: any
  let LoadMessages: any
  try {
    Collections = req('WAWebCollections')
    LoadMessages = req('WAWebChatLoadMessages')
  } catch (e) {
    return { error: `WhatsApp module missing (${(e as Error).message}) — the bundle moved.` }
  }

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
  // A cold tab boots its collections asynchronously and starts with none.
  for (let i = 0; i < 60 && !Collections.Chat.getModelsArray().length; i++) await sleep(500)

  // Which chat is on screen. `Cmd.activeChat` is the app's own answer; the
  // `active` flag on the models is the fallback for when that module moves.
  let chat: any = null
  try {
    chat = req('WAWebCmd').Cmd.activeChat || null
  } catch {
    chat = null
  }
  if (!chat) chat = Collections.Chat.getModelsArray().find((c: any) => c.active) || null
  if (!chat) {
    return { error: 'No WhatsApp chat is open — click into the conversation you want, then try again.' }
  }

  const chatId = chat.id?._serialized || String(chat.id)
  const w = globalThis as Record<string, any>
  let st = w.__dbWaImport
  if (args.restart || !st || st.chatId !== chatId) {
    st = w.__dbWaImport = { chatId, sent: new Set<string>(), done: false }
  }

  // For media the model's `body` is the base64 thumbnail, not anything a human
  // wrote — the caption is the only text, and a bare photo has none.
  const MEDIA: Record<string, string> = {
    image: 'photo',
    video: 'video',
    ptt: 'voice message',
    audio: 'audio',
    document: 'document',
    sticker: 'sticker',
    album: 'album',
    location: 'location',
    vcard: 'contact card',
    multi_vcard: 'contact cards',
    product: 'product',
    poll_creation: 'poll',
    gif: 'gif',
  }
  // Encryption notices, group housekeeping, and messages whose keys never
  // arrived. None of them are things either person said.
  const SKIP = new Set(['e2e_notification', 'ciphertext', 'gp2', 'protocol', 'notification_template', 'groups_v4_invite'])

  const clock = (secs: number) => {
    const s = Math.round(Number(secs) || 0)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const mediaLabel = (m: any): string => {
    if (m.type === 'call_log') {
      const kind = m.isVideoCall ? 'video call' : 'voice call'
      const how = m.callOutcome && m.callOutcome !== 'Completed' ? `, ${m.callOutcome.toLowerCase()}` : ''
      const len = m.callDuration ? `, ${clock(m.callDuration)}` : ''
      return `${kind}${how}${len}`
    }
    if (m.type === 'revoked') return 'deleted'
    let label = MEDIA[m.type] || m.type
    if (m.isViewOnce) label = `view-once ${label}`
    if (m.duration && (m.type === 'ptt' || m.type === 'video' || m.type === 'audio')) label += ` ${clock(m.duration)}`
    if (m.type === 'document' && m.filename) label += ` ${m.filename}`
    if (m.type === 'album' && m.albumMessages) label += `, ${m.albumMessages.length} items`
    return label
  }

  const textOf = (m: any): string => {
    if (m.type === 'chat') return m.body || ''
    if (m.type === 'poll_creation') return m.pollName || ''
    if (m.type === 'location') return [m.loc, m.address].filter(Boolean).join(' ')
    if (m.type === 'vcard' || m.type === 'multi_vcard') return m.vcardFormattedName || ''
    return m.caption || ''
  }

  // loadEarlierMsgs pages roughly fifty at a time, the same call the UI makes on
  // scroll-up; noEarlierMsgs is how the app itself knows it reached the start.
  // Pages arrive newest-first, which is what makes `last` the cheap direction.
  const deadline = Date.now() + args.budgetMs
  while (!st.done && Date.now() < deadline) {
    if (args.last && chat.msgs.getModelsArray().length >= args.last) {
      st.done = true
      break
    }
    const before = chat.msgs.getModelsArray().length
    try {
      await LoadMessages.loadEarlierMsgs({ chat, msgCollection: chat.msgs })
    } catch (e) {
      return { error: `WhatsApp refused to page further back: ${(e as Error).message}` }
    }
    const after = chat.msgs.getModelsArray().length
    if (chat.msgs.msgLoadState?.noEarlierMsgs || after === before) st.done = true
  }

  const messages: RawMessage[] = []
  for (const m of chat.msgs.getModelsArray()) {
    const key = String(m.id)
    if (st.sent.has(key)) continue
    st.sent.add(key)
    if (SKIP.has(m.type)) continue
    const q = m.quotedMsg
    messages.push({
      id: key,
      order: m.t,
      ts: m.t * 1000,
      out: !!m.id.fromMe,
      text: textOf(m),
      media: m.type === 'chat' ? null : mediaLabel(m),
      reply: q ? (textOf(q) || MEDIA[q.type] || q.type || '').slice(0, 60) : null,
      via: m.isForwarded ? 'forwarded' : null,
    })
  }

  return {
    peer: chat.formattedTitle || chat.name || chatId,
    messages,
    done: st.done,
    note: null,
  }
}
