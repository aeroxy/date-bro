import type { FetchArgs, RawMessage } from './render'

/**
 * The Telegram Web A chat you have open, read off the message list as the app
 * pages it in.
 *
 * Telegram speaks MTProto from a web worker, so there is no request to replay the
 * way Instagram's GraphQL one can be. The app itself is the API: scrolling makes
 * it load history, and every loaded message is in the DOM.
 *
 * Two strategies, because the app only keeps one window of the thread mounted and
 * drops what falls behind:
 *
 *   - **whole history** — rewind to the first message, then ride the bottom edge
 *     down, harvesting each chunk as it arrives. Slow, and the reliable one: the
 *     app pages *forward* in whole chunks, so this is the direction it is happy in.
 *   - **last N** — scroll up from where the chat already sits and stop once N are
 *     in hand. Much faster, and how anyone actually wants the recent tail. Reading
 *     backwards is the direction Telegram is careless in, though, so over a long
 *     climb it can skip; the result is offered for review rather than imported
 *     blind, and a gap is visible in the text.
 *
 * Resumable across calls via `window.__dbTgImport`. Everything is inlined:
 * `chrome.scripting` serialises this function, so it cannot close over an import.
 */
export async function fetchTelegram(args: FetchArgs) {
  if (!location.hostname.endsWith('web.telegram.org')) {
    return { error: 'That tab is not on web.telegram.org.' }
  }
  if (!location.pathname.startsWith('/a')) {
    return { error: 'This only knows the /a/ web app — open the chat at web.telegram.org/a/.' }
  }
  const chatId = (location.hash.match(/-?\d+/) || [])[0]
  if (!chatId) {
    return { error: 'No Telegram chat is open — click into the conversation you want, then try again.' }
  }

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
  const list = () => document.querySelector(`.MessageList[data-list-key^="${chatId}_"]`) as HTMLElement | null
  // Outside `budgetMs` on purpose, and it can be the longer of the two: waiting
  // on a cold tab isn't work that can be resumed next pass, since there is
  // nothing to resume until the app exists. Only the scroll loop is budgeted.
  for (let i = 0; i < 60 && !list(); i++) await sleep(500)
  if (!list()) return { error: `Telegram chat ${chatId} is not open in that tab.` }

  const w = globalThis as Record<string, any>
  let st = w.__dbTgImport
  if (args.restart || !st || st.chatId !== chatId || st.last !== args.last) {
    st = w.__dbTgImport = {
      chatId,
      last: args.last,
      seen: new Map<string, any>(),
      sent: new Set<string>(),
      // `last` climbs from where the chat sits; a whole history rewinds first.
      phase: 'up',
      idle: 0,
      done: false,
    }
  }
  const IDLE_LIMIT = 8

  // Text, with the trailing time/status stamp and the quoted reply left out.
  // Custom emoji are <img> carrying the character in alt, so childNodes beats
  // textContent.
  const SKIP_IN_TEXT = ['MessageMeta', 'Reactions', 'EmbeddedMessage', 'message-title', 'WebPage', 'Avatar']
  const textOf = (el: Element): string => {
    let out = ''
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        out += n.nodeValue
        continue
      }
      if (n.nodeType !== 1) continue
      const e = n as Element
      if (SKIP_IN_TEXT.some((c) => e.classList.contains(c))) continue
      if (e.tagName === 'IMG') out += (e as HTMLImageElement).alt || ''
      else if (e.tagName === 'BR') out += '\n'
      else out += textOf(e)
    }
    return out
  }

  // Labels are stitched from adjacent nodes with no whitespace between them
  // ("Forwarded from" + the name, a reaction emoji + its count), so unlike
  // message text they read best as trimmed pieces joined by a space.
  const labelOf = (el: Element): string => {
    const parts: string[] = []
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) parts.push((n.nodeValue || '').trim())
      else if (n.nodeType !== 1) continue
      else {
        const e = n as Element
        if (SKIP_IN_TEXT.some((c) => e.classList.contains(c))) continue
        parts.push((e.tagName === 'IMG' ? (e as HTMLImageElement).alt || '' : labelOf(e)).trim())
      }
    }
    return parts.filter(Boolean).join(' ')
  }

  // A quoted reply is a whole little message inside the bubble, and its text and
  // sender come first in document order — so anything about the bubble itself has
  // to skip past it.
  const ownPart = (el: Element, selector: string): Element | null => {
    for (const n of Array.from(el.querySelectorAll(selector))) if (!n.closest('.EmbeddedMessage')) return n
    return null
  }

  const mediaOf = (el: Element, content: Element | null): string | null => {
    if (el.querySelector('.AnimatedSticker, .Sticker, .sticker-wrapper')) {
      const alt = ((el.querySelector('img[alt]') as HTMLImageElement | null)?.alt || '').trim()
      return alt ? `sticker ${alt}` : 'sticker'
    }
    const album = el.querySelector('.Album')
    if (album) return `album, ${album.querySelectorAll('.media-inner').length || album.children.length} items`
    if (el.querySelector('.RoundVideo, .round-video')) return 'video message'
    if (el.querySelector('.Audio .voice, .voice-message, .waveform')) return 'voice message'
    if (el.querySelector('.Audio')) return 'audio'
    const file = el.querySelector('.File, .document-wrapper')
    if (file) {
      const name = (file.querySelector('.file-title, .file-name')?.textContent || '').trim()
      return name ? `file: ${name}` : 'file'
    }
    if (el.querySelector('.Poll')) return 'poll'
    if (el.querySelector('.Contact')) return 'contact'
    if (el.querySelector('.Game')) return 'game'
    // A link preview brings its own image; the message itself is just the link.
    if (el.querySelector('.WebPage')) return null
    if (el.querySelector('video')) return 'video'
    if (el.querySelector('.media-inner, .full-media')) return 'photo'
    if (content && content.classList.contains('media')) return 'media'
    return null
  }

  const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i

  /**
   * Telegram writes these headers in its own UI language, and a label we can't
   * read costs every message under it its timestamp. So rebuild the same three
   * shapes out of `Intl` in the page's locale rather than widening the English
   * patterns — the names come from the browser, so nothing here is a word list.
   */
  const localised = (label: string, now: Date): Date | null => {
    const loc = document.documentElement.lang || navigator.language || 'en'
    const norm = label.toLowerCase().trim()
    const rel = (n: number) => {
      try {
        return new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(n, 'day').toLowerCase()
      } catch {
        return null
      }
    }
    if (norm === rel(0)) return new Date(now)
    if (norm === rel(-1)) {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      return d
    }
    // A leading four-digit year makes the rest unambiguous, which is the one
    // numeric shape worth reading: "2023年5月20日", "2023-05-20". Day-first
    // numerics stay unread on purpose — 05.06 is two different days depending on
    // a locale the label doesn't carry, and a guess puts messages months out.
    const ymd = label.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))

    // Year first, then the day out of what's left, so a year can't be read as one.
    const year = Number((label.match(/\d{4}/) || [])[0]) || now.getFullYear()
    const day = Number((label.replace(/\d{4}/, ' ').match(/\d{1,2}/) || [])[0])
    if (!day) return null
    for (const month of ['long', 'short'] as const) {
      for (let mo = 0; mo < 12; mo++) {
        let name: string
        try {
          // Formatted as part of a whole date, not alone: inflected languages
          // write a different word in a date than they do standalone, and it is
          // the date form Telegram prints ("20 мая", not "май").
          const parts = new Intl.DateTimeFormat(loc, {
            day: 'numeric',
            month,
            year: 'numeric',
          }).formatToParts(new Date(2000, mo, 15))
          name = parts.find((p) => p.type === 'month')?.value ?? ''
        } catch {
          return null
        }
        name = name.replace(/\.$/, '').toLowerCase()
        // A locale that numbers its months gives back "5", which every label
        // carrying a day would match. Those are the ones `ymd` above covers.
        if (name.length > 2 && norm.includes(name)) return new Date(year, mo, day)
      }
    }
    return null
  }

  const whenOf = (dateLabel: string, time: string): number | null => {
    const now = new Date()
    let d: Date
    if (/^today$/i.test(dateLabel)) d = new Date(now)
    else if (/^yesterday$/i.test(dateLabel)) {
      d = new Date(now)
      d.setDate(d.getDate() - 1)
    } else if (MONTH.test(dateLabel)) {
      // Telegram drops the year inside the current one: "May 20" vs "May 20, 2023".
      d = new Date(/\d{4}/.test(dateLabel) ? dateLabel : `${dateLabel}, ${now.getFullYear()}`)
    } else {
      const alt = localised(dateLabel, now)
      if (!alt) return null
      d = alt
    }
    if (isNaN(d.getTime())) return null
    const m = String(time || '')
      .trim()
      .match(/^(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?/i)
    // A date with no time would read as midnight and sort wrong.
    if (!m) return null
    let h = Number(m[1])
    if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0)
    d.setHours(h, Number(m[2]), 0, 0)
    if (d.getTime() > now.getTime() + 864e5) d.setFullYear(d.getFullYear() - 1)
    return d.getTime()
  }

  const harvest = () => {
    const l = list()
    if (!l) return
    for (const group of Array.from(l.querySelectorAll('.message-date-group'))) {
      const dateLabel = (group.querySelector('.sticky-date span, .sticky-date')?.textContent || '').trim()
      for (const el of Array.from(group.querySelectorAll('.Message.message-list-item'))) {
        const id = (el as HTMLElement).dataset.messageId
        if (!id) continue
        // Ordering rests on the id being a number, and a comparator handed NaN
        // stops ordering without saying so — a scrambled transcript with nothing
        // in the note. Dropped like a bubble with no id at all, since a turn in
        // the wrong place reads as something the person said next.
        const order = Number(id)
        if (!Number.isFinite(order)) continue
        // A bubble caught mid-mount can be missing its stamp; keep what we have
        // but re-read it later once the meta is there.
        const had = st.seen.get(id)
        if (had && (had.time || !el.querySelector('.message-time'))) continue
        // This re-read is about to gain the stamp the first one missed, so the
        // message has to be allowed out a second time — the caller keys on id
        // and overwrites, but `sent` would otherwise hold the untimed version
        // in place and the repair would never leave the page.
        if (had) st.sent.delete(id)
        const body = ownPart(el, '.text-content, .message-text')
        const reply = el.querySelector('.EmbeddedMessage')
        const web = el.querySelector('.WebPage')
        const reactions = el.querySelector('.Reactions')
        const title = ownPart(el, '.message-title')
        const time = (el.querySelector('.message-time')?.textContent || '').trim()
        st.seen.set(id, {
          id,
          order,
          ts: whenOf(dateLabel, time),
          time,
          out: el.classList.contains('own'),
          text: body ? textOf(body).replace(/\s+$/, '') : '',
          media: mediaOf(el, el.querySelector('.message-content')),
          reply: reply ? textOf(reply).replace(/\s+/g, ' ').trim() : null,
          via: title ? labelOf(title) || null : null,
          // The footer holds the reaction chips and the timestamp; textOf drops
          // the latter.
          reactions: reactions ? labelOf(reactions) || null : null,
          shared:
            (web?.querySelector('.WebPage-text .site-title, .site-name')?.textContent || '').trim() ||
            (web?.querySelector('a') as HTMLAnchorElement | null)?.href ||
            null,
        })
      }
    }
  }

  const start = Date.now()
  while (!st.done && Date.now() - start < args.budgetMs) {
    const l = list()
    if (!l) break
    // Enough of the tail in hand is the answer, not a truncation.
    if (args.last && st.seen.size >= args.last) {
      st.done = true
      break
    }
    const before = st.seen.size
    harvest()
    const edge = st.phase === 'up' ? l.scrollTop <= 4 : l.scrollHeight - l.scrollTop - l.clientHeight <= 4
    if (edge) {
      await sleep(600) // at the edge the app is fetching; give it a beat
    } else {
      const step = l.clientHeight * 0.75
      l.scrollTop = st.phase === 'up' ? Math.max(0, l.scrollTop - step) : l.scrollTop + step
      await sleep(160)
    }
    harvest()
    if (st.seen.size > before) st.idle = 0
    else if (edge) st.idle++
    if (st.idle >= IDLE_LIMIT) {
      // The edge held with nothing new: the first message, or the last one.
      if (st.phase === 'up' && !args.last) {
        st.phase = 'down'
        st.idle = 0
      } else st.done = true
    }
  }

  const messages: RawMessage[] = []
  for (const m of Array.from(st.seen.values()) as any[]) {
    if (st.sent.has(m.id)) continue
    st.sent.add(m.id)
    messages.push(m as RawMessage)
  }
  messages.sort((a, b) => a.order - b.order)

  const result = {
    peer: (document.querySelector('.MiddleHeader .ChatInfo .fullName')?.textContent || '').trim() || null,
    messages,
    done: st.done,
    note: null,
  }
  // The state exists to survive *between* passes. Once the walk is finished it
  // is a Map holding every message harvested, parked on the user's Telegram tab
  // until they reload it — 40k objects for a 40k history. `messages` already
  // holds what it needs, so this frees the rest.
  if (st.done) delete w.__dbTgImport
  return result
}
