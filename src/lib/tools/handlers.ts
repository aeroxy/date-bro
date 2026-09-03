// Tool handlers. Runs directly in the app page — a normal extension page with
// `fetch` and full `chrome.*` access, so there's no offscreen document or
// cross-context bridging to worry about (unlike a service worker).

import { parseHtmlToMarkdown } from '@/lib/html-to-markdown'
import type { ToolHandlerContext } from './types'

const FETCH_TIMEOUT_MS = 20_000

// read_page follows a URL the *model* chose, and whatever comes back is fed
// straight into the next request as a tool message. Without a ceiling one
// oversized page blows the context window and fails the run.
//
// Exported for `capped`'s test, which has to place an emoji exactly astride the
// cut to exercise the surrogate trim: with the number spelled twice, changing
// it here would leave that test green while it straddled nothing.
export const MAX_PAGE_CHARS = 100_000

// The ceiling on what we'll pull off the wire at all. MAX_PAGE_CHARS bounds the
// markdown we keep, but it can only be applied *after* the whole body has been
// buffered and parsed — so a model-chosen URL serving a 200MB text/plain dump
// would be read and walked in full before 99.9% of it was thrown away. HTML
// shrinks heavily on the way to markdown, so 4MB of source comfortably covers
// 100k chars of output.
const MAX_PAGE_BYTES = 4_000_000
const READABLE_TYPES = /^(?:text\/html|text\/plain|application\/xhtml\+xml)/i

interface Fetched {
  res: Response
  /**
   * Reads the body, capped at MAX_PAGE_BYTES. Separate from the fetch so the
   * caller can reject on `content-type` or status *before* paying for a body,
   * and `discard()` exists for when it does.
   */
  read: () => Promise<{ text: string; truncated: boolean }>
  discard: () => Promise<void>
}

/**
 * Fetch under one timeout that spans the body read, not just the headers: a
 * server that answers instantly and then trickles bytes would otherwise hold
 * the request open indefinitely (`FETCH_TIMEOUT_MS` was previously cleared the
 * moment headers arrived).
 *
 * `credentials: 'include'` on both callers — web_search needs DuckDuckGo's
 * bot-verification cookie, and read_page acts as the user against their own
 * sessions (see its comment below for the tradeoff).
 */
async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Fetched> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(new DOMException('Fetch timed out', 'TimeoutError')),
    FETCH_TIMEOUT_MS,
  )
  const done = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal

  let res: Response
  try {
    res = await fetch(url, { signal: combined, redirect: 'follow', credentials: 'include' })
  } catch (e) {
    done()
    throw e
  }

  // Advertised oversize: refuse before spending the bandwidth. A missing or
  // lying header just falls through to the streaming cap in `read`.
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
    done()
    await res.body?.cancel().catch(() => {})
    throw new Error(
      `Page is too large to read (${Math.round(declared / 1_000_000)}MB). Find a more specific source.`,
    )
  }

  return {
    res,
    read: async () => {
      try {
        return await readCapped(res)
      } finally {
        done()
      }
    },
    discard: async () => {
      done()
      await res.body?.cancel().catch(() => {})
    },
  }
}

/**
 * The declared charset, or utf-8. Pages in iso-8859-1, windows-1252 and the CJK
 * encodings are still out there, and decoding them as utf-8 hands the model
 * mojibake it will happily quote back. An unknown label throws in `TextDecoder`,
 * so fall back rather than fail the read.
 */
function decoderFor(res: Response): TextDecoder {
  const declared = /charset=["']?([^"';,\s]+)/i.exec(res.headers.get('content-type') ?? '')?.[1]
  if (!declared) return new TextDecoder()
  try {
    return new TextDecoder(declared)
  } catch {
    return new TextDecoder()
  }
}

/** Read a body incrementally, stopping once MAX_PAGE_BYTES have arrived. */
async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false }
  const reader = res.body.getReader()
  const decoder = decoderFor(res)
  let text = ''
  let bytes = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (bytes >= MAX_PAGE_BYTES) {
      await reader.cancel().catch(() => {})
      return { text: text + decoder.decode(), truncated: true }
    }
  }

  return { text: text + decoder.decode(), truncated: false }
}

// DDG serves its anti-bot page with HTTP 200, so detect it by content.
function isDdgBotChallenge(html: string): boolean {
  return html.includes('Unfortunately, bots use DuckDuckGo too')
}

// Open the DDG search URL in a tab so the user can clear the challenge. Reuse
// an existing html.duckduckgo.com tab instead of stacking new ones on retries.
async function openDdgChallengeTab(url: string): Promise<void> {
  try {
    const existing = await chrome.tabs.query({ url: 'https://html.duckduckgo.com/*' })
    const tabId = existing[0]?.id
    if (tabId != null) {
      await chrome.tabs.update(tabId, { active: true, url })
      return
    }
    await chrome.tabs.create({ url, active: true })
  } catch (e) {
    console.warn('[Date Bro] Failed to open DuckDuckGo challenge tab:', e)
  }
}

export async function webSearch(query: string, ctx: ToolHandlerContext = {}): Promise<string> {
  const q = encodeURIComponent(query.trim().replace(/\s+/g, ' '))
  // DuckDuckGo's HTML endpoint — no JS required, no rate-limit wall.
  const url = `https://html.duckduckgo.com/html?q=${q}`
  const { res, read, discard } = await fetchWithTimeout(url, ctx.signal)
  if (!res.ok) {
    await discard()
    throw new Error(`DuckDuckGo returned HTTP ${res.status}`)
  }
  const { text: html, truncated } = await read()
  if (isDdgBotChallenge(html)) {
    await openDdgChallengeTab(url)
    throw new Error(
      'DuckDuckGo is showing a bot-verification page. A browser tab has been opened — ' +
        'ask the user to complete the verification there, then retry this search.',
    )
  }
  return capped(cleanDdgRedirects(parseHtmlToMarkdown(html)), truncated)
}

// DDG wraps every result href in a redirector: //duckduckgo.com/l/?uddg=<encoded
// target>&rut=…. Pull the real URL out of `uddg` so the model sees a clean,
// fetchable link instead of ~1.5KB of tracking blob per result. Organic
// results decode straight to the target; ad results decode to a
// duckduckgo.com/y.js redirect (real target double-encoded in `u3`) — drop those.
function cleanDdgRedirects(md: string): string {
  return md.replace(/(?:https?:)?\/\/duckduckgo\.com\/l\/\?[^\s)]+/g, (match) => {
    try {
      const urlString = match.startsWith('//') ? 'https:' + match : match
      const target = new URL(urlString).searchParams.get('uddg')
      if (!target) return match
      const targetUrl = new URL(target)
      // Suffix-matched on a label boundary, not a bare `endsWith` — that also
      // matched `notduckduckgo.com`, so an attacker-controlled host could get its
      // `u3` param unwrapped instead of being handed to the model as-is.
      const host = targetUrl.hostname.toLowerCase()
      const isDdg = host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')
      if (isDdg && targetUrl.pathname === '/y.js') {
        return targetUrl.searchParams.get('u3') ?? ''
      }
      return target
    } catch {
      return match
    }
  })
}

// Two deliberate choices, both trading a little safety for usefulness:
//   1. credentials: 'include' — read_page fetches with the user's cookies so
//      it can read pages behind their own authenticated sessions (an event
//      listing behind a login, a venue's members page).
//   2. No localhost / private-IP blocking. The fetch runs in the user's own
//      browser on their own machine, so it can only reach what the user can
//      already reach — no privilege boundary is crossed.
export async function readPage(url: string, ctx: ToolHandlerContext = {}): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`)
  }
  const { res, read, discard } = await fetchWithTimeout(parsed.toString(), ctx.signal)
  if (!res.ok) {
    await discard()
    throw new Error(`Fetch returned HTTP ${res.status}`)
  }

  // Refuse binaries up front rather than running a PDF or an image through the
  // HTML parser and handing the model the wreckage. Checked before `read()`, so
  // a binary costs the headers and nothing else.
  const contentType = res.headers.get('content-type')
  if (contentType && !READABLE_TYPES.test(contentType.trim())) {
    await discard()
    throw new Error(`Not a readable page (content type: ${contentType.split(';')[0]!.trim()})`)
  }

  const { text: html, truncated } = await read()
  return capped(parseHtmlToMarkdown(html), truncated)
}

// Exported for its own test: the surrogate trim below is the kind of line that
// reads as a pointless `replace` and gets "simplified" back into a bare slice.
// Says so explicitly, so the model treats it as a partial read instead of
// concluding the page simply ends there. Both tools go through this: a search
// results page is normally small, but "normally" isn't a bound, and a silently
// clipped result reads to the model as the complete set.
export function capped(markdown: string, truncated: boolean): string {
  if (markdown.length <= MAX_PAGE_CHARS && !truncated) return markdown
  // `slice` counts UTF-16 units, and pages are full of emoji: a cut landing
  // inside a surrogate pair leaves an orphaned half that strict JSON parsers
  // reject, failing the whole turn rather than the one character. Trimming the
  // trailing high half is enough — no other position can be left unpaired.
  const head = markdown.slice(0, MAX_PAGE_CHARS).replace(/[\uD800-\uDBFF]$/, '')
  return `${head}\n\n[Truncated: the page was longer than this tool returns. Search for a more specific source if what you need isn't above.]`
}
