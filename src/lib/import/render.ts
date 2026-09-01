/**
 * Turning a source's messages into the `Me [Wed Oct 30, 7:08pm]: text` lines
 * `parsePastedLog` already reads.
 *
 * Shared across the three sources because they differ in how they *reach* a
 * message, not in what one looks like once reached: every one of them ends up
 * with a side, a time, some text, and a handful of things that only exist as
 * bracketed asides — media, a quoted reply, a forward, reactions, a shared link.
 * The extraction has to live inside each source's injected function, which can't
 * import anything; this is the half that doesn't, so it's written once.
 */

/**
 * What every source's injected function is handed. It lives here rather than in
 * `sources.ts` so the three drivers can name it without importing the module
 * that imports them — and because a type import is erased at build, taking it
 * costs the injected functions nothing at runtime.
 *
 * All three take the whole thing even where they don't read all of it: the
 * shape is the contract `SourceDef.fetch` is checked against, and a parameter
 * narrowed to what one driver happens to use today is a rename waiting to go
 * unnoticed, since function parameters compare bivariantly.
 */
export type FetchArgs = {
  /** How many recent messages the user asked for; 0 means the whole history. */
  last: number
  /** How long this pass may run before yielding, for the resumable sources. */
  budgetMs: number
  /** First pass of a fetch — discard any state a previous one left behind. */
  restart: boolean
}

export type RawMessage = {
  id: string
  /**
   * Conversation order. Not the timestamp: Telegram's bubbles don't all carry a
   * time but their ids are sequential, so each source picks whichever of the two
   * it can always supply, and ordering never depends on the one it can't.
   */
  order: number
  /** Epoch ms, or null when the source had only a date label to go on. */
  ts: number | null
  /** True when the message is mine. */
  out: boolean
  text: string
  media?: string | null
  reply?: string | null
  via?: string | null
  reactions?: string | null
  /** A link preview's site name, or the bare url. */
  shared?: string | null
}

// "Wed Oct 30, 7:08pm" in the browser's own zone, matching what the standalone
// exporters produce so a fetched log and a hand-pasted one read identically.
// Deliberately en-US, and deliberately *not* the page locale that
// `telegram.ts` reads its date headers in. Those two solve opposite problems:
// there we parse whatever language Telegram happened to render, here we emit
// the one shape `parsePastedLog` reads back. Tying this to the browser's locale
// would make a fetched log unparseable on a non-English machine.
const WHEN = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

function when(ms: number): string {
  const p: Record<string, string> = {}
  for (const { type, value } of WHEN.formatToParts(ms)) p[type] = value
  const period = (p.dayPeriod ?? '').toLowerCase().replace(/\s/g, '')
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute}${period}`
}

/**
 * Clip to `max` characters, never through the middle of one. `slice` counts
 * UTF-16 units, so a cut that lands inside an emoji's surrogate pair leaves an
 * orphaned half — which `JSON.stringify` emits as `\ud83d` and strict parsers
 * (serde_json, i.e. the proxy and the Anthropic API) reject outright, failing
 * the whole request rather than the one character.
 */
export function clip(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('')
}

function body(m: RawMessage): string | null {
  let text = m.text.replace(/\s+/g, ' ').trim()
  if (m.media) text = `[${m.media}] ${text}`.trim()
  if (m.shared && !text.includes(m.shared)) text = `${text} [shared] ${m.shared}`.trim()
  // A bare photo has no caption and nothing else to say; a media label is the
  // only thing that makes such a message worth a line at all.
  if (!text) return null
  if (m.reply) text = `[re: ${clip(m.reply, 40)}] ${text}`
  if (m.via) text = `[${m.via}] ${text}`
  if (m.reactions) text = `${text} [${m.reactions}]`
  // One turn per line is the whole format, and shared-post titles arrive with
  // newlines in them.
  return text.replace(/\s+/g, ' ').trim()
}

export function renderLog(messages: RawMessage[]): string {
  const lines: string[] = []
  // An untimed message sits between its neighbours, so it borrows the last stamp
  // we saw and is marked `~`. The bracket is free-form as far as the parser is
  // concerned, so the tilde survives the round trip and reads as the guess it is.
  let last = 0
  for (const m of messages) {
    const text = body(m)
    if (text === null) continue
    let stamp = ''
    if (m.ts) {
      last = m.ts
      stamp = ` [${when(m.ts)}]`
    } else if (last) {
      stamp = ` [~${when(last)}]`
    }
    lines.push(`${m.out ? 'Me' : 'Them'}${stamp}: ${text}`)
  }
  return lines.join('\n')
}
