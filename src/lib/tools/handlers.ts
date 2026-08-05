// Tool handlers. Runs directly in the app page — a normal extension page with
// `fetch` and full `chrome.*` access, so there's no offscreen document or
// cross-context bridging to worry about (unlike a service worker).

import { parseHtmlToMarkdown } from '@/lib/html-to-markdown'
import type { ToolHandlerContext } from './types'

const FETCH_TIMEOUT_MS = 20_000

function fetchWithTimeout(
  url: string,
  signal?: AbortSignal,
  credentials: RequestCredentials = 'omit',
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Fetch timed out', 'TimeoutError')), FETCH_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  // 'include' on both current callers: web_search needs DuckDuckGo's bot-
  // verification cookie; read_page acts as the user against their own
  // sessions (see its comment below for the tradeoff).
  return fetch(url, { signal: combined, redirect: 'follow', credentials }).finally(() => clearTimeout(timer))
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
  const res = await fetchWithTimeout(url, ctx.signal, 'include')
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`)
  const html = await res.text()
  if (isDdgBotChallenge(html)) {
    await openDdgChallengeTab(url)
    throw new Error(
      'DuckDuckGo is showing a bot-verification page. A browser tab has been opened — ' +
        'ask the user to complete the verification there, then retry this search.',
    )
  }
  return cleanDdgRedirects(parseHtmlToMarkdown(html))
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
      if (targetUrl.hostname.endsWith('duckduckgo.com') && targetUrl.pathname === '/y.js') {
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
  const res = await fetchWithTimeout(parsed.toString(), ctx.signal, 'include')
  if (!res.ok) throw new Error(`Fetch returned HTTP ${res.status}`)
  return parseHtmlToMarkdown(await res.text())
}
