// HTML → markdown pipeline for the research tools. Uses htmlparser2 — a pure
// JS parser that never triggers resource loading (no script fetches, no
// preload) — rather than the DOM's own DOMParser, so parsing arbitrary
// fetched HTML can't cause the page to attempt any subresource loads.

import TurndownService from 'turndown'
import { parseDocument, DomUtils } from 'htmlparser2'
import render from 'dom-serializer'

const STRIP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'noscript',
  'form', 'nav', 'footer', 'aside', 'select', 'button',
])

// Drop non-content elements: scripts/styles/resource tags plus interactive
// chrome (forms, nav, footers, search boxes, dropdowns). On DuckDuckGo's
// results page this strips the header search form, region/time-filter
// <select>s, and the pagination form; on arbitrary read_page targets it strips
// nav bars and footers. <header> is left intact so article titles (often an
// <h1> inside it) survive.
function stripNonContent(html: string): string {
  const doc = parseDocument(html)
  DomUtils.findAll((el) => STRIP_TAGS.has(el.name), doc.children).forEach(DomUtils.removeElement)
  const body = DomUtils.findOne((el) => el.name === 'body', doc.children)
  // Serialize body children only so <title> doesn't leak in.
  return body ? render(body.children) : render(doc.children)
}

function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  // Images keep their alt text and lose their src. Turndown's default renders
  // `![alt](src)`, and a `data:` URI is tens of kilobytes of base64 that costs
  // the model context and tells it nothing; even a real URL is one it can only
  // fetch as HTML.
  td.addRule('imageAltOnly', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = (node as Element).getAttribute?.('alt')?.trim()
      return alt ? alt : ''
    },
  })
  return td.turndown(html)
}

// Strip non-content elements and convert the whole cleaned HTML to markdown.
// Used for both web_search (DuckDuckGo HTML results) and read_page — no
// anchor-based trimming; the model gets the whole page and picks what it needs.
export function parseHtmlToMarkdown(html: string): string {
  return htmlToMarkdown(stripNonContent(html))
}
