# Libraries & Utilities

## `llm-client.ts`

Three backends behind one `chatCompletion`.

| Export | Purpose |
|---|---|
| `chatCompletion(config, messages, options)` | Dispatches on `config.backend`. Returns the assistant string. |
| `completeJSON(config, messages, validate, options)` | The plain-call path: call → `parseJSON` → `validate` → on failure, resend with the bad output and the specific complaint → validate again → throw. Used by all three engines when no research tools are in play. |
| `chatCompletionWithTools(config, messages, options)` | Tool-calling variant, used by `lib/agent.ts`'s loop. Returns `{ content, tool_calls? }`. Qwen short-circuits to a plain completion (see below); `openai` and `anthropic` both genuinely participate in the tool-calling protocol. |
| `parseJSON<T>(raw)` | Fence → outermost `{…}` → `JSON.parse` → `jsonrepair` → descriptive throw. Rejects a bare `null`/array, which would otherwise crash the validators with an opaque message. |

**`sessionId` is not optional in practice.** Cache entries are partitioned by session, and if the
client doesn't name one, whatever sits in front of the API invents one.
[claude-proxy](https://github.com/aeroxy/claude-proxy) invents it
by hashing the first user message — and since we send one user message carrying every stratum, that
hash changed on every call, so a byte-identical system block was read *zero* times against 22,620
tokens of cache creation. Every engine now passes `sessionId: record.id` (immutable for the life of a
record) and the Anthropic path sends it as `x-claude-code-session-id`, which the proxy honours in
place of deriving one. `AgentOptions` carries it too, so every turn of a research loop shares it.
Ignored by api.anthropic.com directly, so it costs nothing when no proxy is in front.

**Truncation is caught before parsing.** A response cut off at `max_tokens` mid-object still has
content, so the "was it truncated" checks — which only fired on an *empty* response — used to pass it
straight through. `jsonrepair` then closed the dangling braces into a perfectly valid object with its
trailing fields missing, and validation complained about whatever happened to be last in the shape,
naming a field the model never had trouble with. Every path now throws on `finish_reason: 'length'` /
`stop_reason: 'max_tokens'` whether or not content arrived, and says which setting to raise. Latent
rather than observed — found while chasing a *different* missing-field bug (see
[coach.md](coach.md#profilets)) that had nothing to do with truncation.
| `stripThinkBlock(content)` | Strips a leading `<think>…</think>`. An unclosed block returns `''` rather than half-written reasoning — otherwise `parseJSON`'s brace regex latches onto a brace *inside* the reasoning and yields garbage that parses cleanly. |
| `layeredUser(segments)` | A user turn built from strata (see [coach.md](coach.md)). Derives `content` by joining the segments rather than taking it as an argument, so the flat string and the segmented one can't drift. |

**Message strata.** `ChatMessage.content` is still the flat string every backend sends; `segments` is
an optional refinement only `anthropic-messages.ts` reads, so it can place `cache_control` at the
boundary between stable and volatile text. OpenAI and Qwen get identical bytes from `content` —
which is all OpenAI's automatic prefix caching needs, and it's free there, unlike Anthropic's. Both
OpenAI bodies go through `toOpenAIMessages`, which strips `segments`: the array is passed to `fetch`
verbatim, and strict providers reject unknown message fields.

**Shared HTTP.** Two transports, one policy. `postJSON` (OpenAI) and `postSSE` (Anthropic) both retry
`[3s, 10s]` on 429/5xx and on transient network/timeout errors, never on a user abort or on an error we
threw ourselves, and both build headers through `withCustomHeaders`, which merges the profile's
`custom_headers` JSON over the auth headers and ignores malformed JSON rather than blocking the call.

They differ on two points, both forced by streaming. `postJSON`'s **120s** timeout is total; `postSSE`
rearms it on every chunk, so it means *120s of silence* — a model that thinks for five minutes is fine,
a dead socket still fails. And `postSSE` stops retrying once it has delivered an event: reasoning is
already on screen and state already accumulated by then, so a replay would double it. A failure before
the first event (including a non-2xx, whose body arrives whole) retries normally.

**OpenAI path.** POSTs `{base_url}/chat/completions` with `Authorization: Bearer`. `response_format`
is `json_schema` when the user enabled structured output and a schema was passed, `json_object`
otherwise. `temperature` is omitted entirely when unset so the provider's own default applies —
some reasoning models reject an explicit one.

**Anthropic path.** POSTs `{base_url}/messages` with `x-api-key` + `anthropic-version` +
`anthropic-dangerous-direct-browser-access` (api.anthropic.com refuses browser-origin requests
without that last one; other endpoints ignore it). Any Anthropic-shaped endpoint works — the API, a
gateway, a local proxy. Strict output is `output_config.format`, and there is no `json_object`
equivalent, so with structured output off the shape comes from the prompt alone. `temperature` is
likewise omitted when unset, which matters more here: Opus 5, Sonnet 5, and Opus 4.7+ reject an
explicit one with a 400. `stop_reason: 'refusal'` becomes an error naming the `stop_details`
category, rather than surfacing as an empty response.

**Always `stream: true`**, tool loop included, for a reason that holds even when nobody watches the
reasoning: it's what makes the timeout idle-based, and a full transcript at high effort can outlast any
sane wall-clock limit. The answer is still assembled before anyone sees it — every engine wants one
complete JSON object — so streaming buys the timeout and the reasoning panel, not incremental output.

**`thinking` is opt-in** (`anthropic_thinking` on the profile, default off) because `display:
'summarized'` only exists *inside* a thinking config: sending one turns thinking **on** for models
where it defaults off (Opus 4.8, 4.7), and models that never had adaptive thinking (Haiku 4.5) plus
proxies that don't know the field reject it with a 400. Left unset, Opus 5 still thinks — adaptive is
its default — it just doesn't hand back a summary. The flag is also ignored when no `onThinking`
callback was passed, so nothing pays for a summary no one reads.

**Truncation.** `finish_reason: 'length'` with no content throws an actionable error naming the
max-tokens setting, rather than returning `''` and tripping a JSON parse error downstream. Reasoning
models spend the budget on reasoning first, so this is the common failure on a low limit.

**Qwen path.** Always bridged to the background via `QWEN_CHAT_REQUEST` (see
[architecture.md](architecture.md) for why). The abort signal is handled by racing the response
against an abort promise that fires `QWEN_CHAT_CANCEL` — the background holds the real controller.

The answer itself is not streamed — every engine wants one complete JSON object, so the background
accumulates and resolves once. What *is* streamed is the reasoning: `options.onThinking` registers a
`chrome.runtime.onMessage` listener for `QWEN_CHAT_THINKING` broadcasts carrying the same
`requestId`, since `sendResponse` only fires at the end.

**`onThinking` is shared with the Anthropic backend** — one `ThinkingSummary` (`types/coach.ts`), same
replace-state contract, so `App.tsx`'s `Thinking` panel doesn't care which backend is running. Qwen
fills `titles` and `thoughts`; Anthropic summarises without headings, so it sends one thought and no
titles, and the panel's step list falls through to tool activity. On the OpenAI backend it never fires.

There is no request queue: the three actions are user-triggered, one at a time.

## `anthropic-messages.ts`

Pure translation between our OpenAI-shaped `ChatMessage` / `ToolDefinition` types and the Anthropic
wire format, so `lib/agent.ts` and the `provide_verdict` channel work across backends unchanged. No
runtime imports — the fetch and error handling stay in `llm-client.ts`, which is also why the two
modules can reference each other's types without a cycle.

`toAnthropicMessages` bridges three shape differences: `system` turns are hoisted to the top-level
field (multiple ones joined with a blank line), `tool` turns become `tool_result` blocks on a *user*
turn, and assistant `tool_calls` become `tool_use` blocks with `arguments` re-parsed into an object.
Same-role turns are merged, which is what puts a whole round of parallel tool results into one user
turn — splitting them trains the model out of calling tools in parallel. Blank text blocks are
dropped rather than sent (the API rejects them), which is incidentally what keeps the merge legal
when the agent loop's nudge path pushes a whitespace-only assistant turn.

**Prompt caching.** A `ChatMessage` may carry `segments` — the same text as `content`, split at its
mutation-rate boundaries (see [coach.md](coach.md) for the strata). This path is the only consumer:
each segment becomes its own `text` block, and segments marked `cache` get
`cache_control: {type: 'ephemeral'}`. The split is the point — `cache_control` attaches to a block,
so a turn sent as one block would key its entry on the volatile tail and never read back. Three
breakpoints per request (last transcript turn, end of task block, end of the injected profile),
against a limit of four; nesting them costs nothing extra, since cache-creation billing counts the
prefix once. Note that the transcript is many blocks with the mark on the last of them, not one
block — entries are *written* at a breakpoint but *read* by longest matching prefix, so appending a
block preserves the previous entry while rewriting one destroys it. The default 5-minute
TTL is deliberate but not free: writes are 1.25× base input and reads 0.1×, so a breakpoint that is
never read back is 25% *worse* than sending nothing.

`readAnthropicResponse` folds the content blocks back the other way: `text` blocks concatenated,
`tool_use` blocks re-serialised as `tool_calls`, `thinking` and anything else unrecognised ignored.

**The stream accumulator** (`newAnthropicStreamState` → `applyAnthropicStreamEvent` →
`finishAnthropicStream`) exists so `readAnthropicResponse` stays the *only* code that interprets a
reply: `finishAnthropicStream` rebuilds the exact shape a non-streaming response would have had, and
the streaming and blocking paths converge there. `applyAnthropicStreamEvent` returns whether the
reasoning summary grew, so the caller pushes UI updates without diffing.

Streamed tool calls are why this can't be interpreted incrementally: a `tool_use` block's arguments
arrive as `input_json_delta` fragments that are only valid JSON once concatenated (`{"que` + `ry":"…"}`),
so blocks are accumulated raw and parsed at `message_stop`. A stream cut mid-fragment yields `{}` rather
than throwing — the `tool_use` keeps its `tool_result` and the handler's own "requires a non-empty query"
error goes back to the model as something it can act on. Dropping the block would strand it instead.

## `agent.ts` + `tools/`

Only `suggestMove` uses this — the two rebuild engines are pure transcript analysis and deliberately
never get tools (see [coach.md](coach.md) for why). `runAgent` drives an OpenAI-shaped tool-calling
loop on **both** keyed backends — Anthropic participates for real, with `anthropic-messages.ts`
translating the tool calls and results in each direction, which is the whole reason the loop is
written against one shape: model → tool calls → append results → loop, capped at
`MAX_AGENT_ITERATIONS` (10), with research tools stripped after `MAX_TOOL_ROUNDS` (5) so the model is
forced to answer instead of researching forever. `runAgentWithValidation<T>` wraps it with the same
parse-validate-retry contract as `completeJSON`.

The **`provide_verdict` structured-output channel** (`lib/tools/definitions.ts`) is how the final
answer comes back once real tools are on the table: strict `response_format.json_schema` is mutually
exclusive with `tool_calls` on most providers, so `buildVerdictSchema(SUGGESTION_SCHEMA)` is appended
to `tools` as a fake tool declaration whose `parameters` *are* the schema. It has no handler; the
agent loop intercepts the call and returns its arguments as the final JSON. Survives past
`MAX_TOOL_ROUNDS` — only the research tools get stripped.

| Export | Purpose |
|---|---|
| `webSearch(query)` / `readPage(url)` (`tools/handlers.ts`) | Fetch (20s timeout, 4MB body cap) → `parseHtmlToMarkdown`. `web_search` hits DuckDuckGo's HTML endpoint and strips its redirect-wrapper hrefs down to the real URL; a bot-verification page opens a `chat.qwen.ai`-style challenge tab via `chrome.tabs` (available directly — the app page isn't a service worker, so no offscreen bridge is needed) and throws so the model knows to retry after the user clears it. |
| `parseHtmlToMarkdown(html)` (`lib/html-to-markdown.ts`) | `htmlparser2` + `dom-serializer` + `turndown` — deliberately not the DOM's own `DOMParser`, so parsing arbitrary fetched HTML can't trigger a subresource load. Strips scripts/styles/nav/forms before converting. |
| `createCachedExecutor()` | Wraps the executor with a per-run cache keyed by normalized query/URL, so the model re-searching the same thing across loop iterations hits one fetch, not several. |
| `ALL_TOOLS` | `[WEB_SEARCH_TOOL, READ_PAGE_TOOL]` — both descriptions carry the same privacy scope note as the prompt (see below), so the model sees the boundary twice. |

**Where the research scope actually draws the line.** `web_search` / `read_page` cover three lanes:
date logistics (venues, events, opening hours, etiquette), whatever the person has said about
themselves followed outward (the studio they named, the field they work in, the race they're
training for — this is what makes a specific plan possible), and whether those claims hold up, for
safety. Confirming someone is who they say they are before meeting a stranger is normal safety
practice, not surveillance, and a tool that refused to help wouldn't stop the user from doing it in
a browser tab anyway. Inside those lanes the instruction is to search what would change the advice,
taking as many calls as that needs — but still not for its own sake, and with the query built from
the *current* state of the thread. "Most good answers need zero searches" survived the widening: it
only ever contradicted profile-every-date-every-run, and it is what stops a search for a café in the
city they left four turns ago, which is the failure mode that costs more than the missing search
would have.

The line is **where a search starts**, not whether it includes their name — legitimate checks
routinely do. Outward from something they disclosed is research; starting from the name to see what
falls out ("everything about \[name]", their address, family, old accounts, whereabouts) is a file
on a private individual. Each fact in it may be public; the assembly is the thing that isn't, and no
answer this app gives needs one. Same for monitoring someone already trusted, and for anything aimed
at finding leverage rather than understanding. That boundary is stated in three places on purpose: the tool descriptions themselves,
`KB_RESEARCH` in `coach/knowledge.ts` (injected only when tools are actually attached), and the
"Web research" checkbox in `SettingsModal` — the last one matters most, because it's the only one
the user reads, and it's read at the moment they turn the capability on.

## `research-notes.ts`

`mergeResearchNotes(existing, additions)` folds new facts (`Suggestion.research_notes`, populated by
the model when a run finds something durable — a venue's hours, a confirmed claim) into the record's
persistent `researchNotes` string, skipping lines already present (case-insensitive) so repeat runs
don't pile up duplicates. `App.tsx` calls it right after every `suggestMove`; the result is fed back
into every future prompt via `<research_notes>` (see `coach/prompts.ts`) so the same fact isn't
re-searched next time. It's plain user-editable text — `ProfileModal` exposes it with a `Clear`
button — so a wrong or stale note can be fixed by hand as easily as any other entry.

## `qwen/`

Carried over from `job-bro`, with the thinking channel added on top. Delegates to the user's live `chat.qwen.ai` session rather
than calling a model API — Qwen is an *agent* on the far side, and it does its own thinking (and its
own web search — `feature_config.auto_search` in `buildQwenMessagesPayload`) server-side. That's why
`resolveSuggestionOutput` in `coach/run.ts` never sends it `ALL_TOOLS`: forwarding our tool schemas
to an agent that already researches on its own would be meaningless.

| Module | Role |
|---|---|
| `qwen-service.ts` | Token lookup (cookie, falling back to a tab's localStorage), device-id resolution and refresh, session creation, SSE streaming, anti-bot retry |
| `cookie-generator.ts` | LZW-compresses a 37-field fingerprint into the `ssxmod_itna` / `ssxmod_itna2` cookies Qwen's anti-bot checks require |
| `fingerprint.ts` | The fingerprint template, with per-platform presets |

**Thinking phases.** We request `output_schema: 'phase'` + `thinking_format: 'summary'`, so the SSE
stream interleaves reasoning with the answer, tagged by `delta.phase`. `handleDelta` splits them:
`think` / `thinking_summary` events go to `onThinking` as a `QwenThinking` (the `extra.summary_title`
/ `extra.summary_thought` arrays), everything else is answer content for `onChunk`. Those arrays are
**cumulative** — each event repeats the full history, so consumers replace rather than append. The
split is also what keeps reasoning out of the accumulated answer string.

**Anti-bot retry.** Qwen's WAF can answer with an Alibaba "punish" body instead of an SSE stream,
either as a non-2xx or as a 200 with no `data:` deltas. `isQwenAntiBotChallenge` sniffs the markers;
on a hit the *same* `chat_id` is re-sent after 30s with fresh cookies, up to 3 times. Session
creation happens once up front, because the throttled request never reached the model.

**Header timeout.** `QWEN_HEADER_TIMEOUT_MS` gives the completions endpoint **60s** to answer at all.
It covers headers only: once a stream has started the reader's idle watchdog takes over, so a thinking
model that goes quiet before the first delta isn't cut off.

**Device ID.** Read from Qwen's own `qwen_chat_device_id` in an open tab's localStorage and cached,
so the fingerprint correlates with Qwen's native cookies as one session. Two different device IDs
from one IP is itself a bot signal. Settings exposes a Refresh button that opens/focuses a tab,
waits for it to settle, invalidates the cache, and re-reads.

## `ago.ts`

One `ago(ts?)` for every relative timestamp in the UI — `DateRail`'s row subtitles and `App`'s
staleness lines both call it. Tiers: `never` for a missing or zero timestamp, then `just now`,
`Nm ago`, `Nh ago`, `Nd ago`, and `Nmo ago` past 30 days. It exists because the rail and the panel
had grown separate copies that disagreed at the tail — the rail's stopped at days, so the same
timestamp read `45d ago` in one place and `2mo ago` in the other.

## `birthday.ts`

`describeBirthday(iso, now)` → `"14 March 1997 — 29 years old, and it is in 9 days"`, or `null` if the
string isn't a real ISO date. Replaced `meta.age`, a free-text number that was wrong the moment it
was written: a record is read on every call for months, so a stored "28" quietly becomes a lie and
nothing corrects it.

Derived in code rather than handed to the model as a date plus `<right_now>` — that is arithmetic
across a calendar, which models get wrong in the quiet way this app can't afford, and every other
fact in the request is stated rather than inferred. Dates are built in local time (`new Date(iso)`
reads as UTC and lands a day early west of Greenwich) and round-trip-checked, so `2001-02-30` is
rejected rather than rolling into March. Age is compared as `(month, day)` so a leap year or a
daylight-saving hour can't shift it; 29 February falls forward to 1 March in a common year, the only
convention that doesn't skip three years in four. The countdown appears only within 30 days — a
birthday coming up is a set piece, a birthday in August is standing noise.

## `storage.ts`

Thin wrappers over `chrome.storage.local`. `ensureActiveProfile()` creates a default profile on
first run and repairs a dangling active id; `getActiveConfig()` is what `coach/run.ts` calls.

`getMind()` / `saveMind()` hold the coach itself — see [coach.md](coach.md#mindts). Here rather
than on a `DateRecord` because every record shares it: filing it under one would mean choosing which
record owns the coach, and losing it when that record is deleted. Empty `markdown` means "still
tracking the shipped seed", so an installation nobody has edited keeps getting knowledge-base
improvements from releases. `saveMind` is the fork, **per section**: it records in `Mind.forked` the
headings whose bodies differ from the seed *as it stands at that write*, and `mindText` refreshes the
rest from the current seed on read, so one edited section doesn't freeze the other five. A document
stored before the field existed migrates to the canonical headings it actually contains
(`legacyForked`) — the full list would fork sections the document never had and strand every section
shipped after the upgrade.

## `db.ts`

IndexedDB via `idb`. Database `date-bro` v1, one store `dates` keyed by `id` with a `by-updated`
index. `listDates()` returns newest-first. `saveDate()` stores `updatedAt` **as given** rather than
re-stamping it — both callers already set it, and a second stamp landed a millisecond or two after the
value the in-memory list was ordered on, so the rail's order and `listDates()`'s order were computed
from different numbers. `normalize()`
runs on every read instead of a migration step, filling fields that post-date a stored record —
including `turnsUpdatedAt`, which defaults to `0` rather than `updatedAt` because 0 is the value that
can't produce a false staleness chip. It also runs the four migrations; see
[architecture.md](architecture.md#storage-layout) for what each one moves and why every default in
`normalize` reads from the migrated value rather than the original record.

## `transcript.ts`

| Export | Purpose |
|---|---|
| `formatTurn(record, turn)` | One turn as the model sees it — number, speaker label, optional time/channel, and the user's own note inline. Takes a **`NumberedTurn`**, so it cannot be handed a turn without a number and has no fallback to invent one. It briefly did fall back to `index + 1`, which quietly reinstated the positional scheme and could *collide*: an unnumbered turn dropped at index 60 of a record already holding 60 and 61 rendered as `[61]`, giving two turns one citation. A type that can't be satisfied without a number is cheaper than a test for every route into that state. A pure function of `(turn, name)`, which is what makes the prefix cache work: the prompt sends one block per turn, so appending turn n+1 leaves the first n byte-identical. Dropping the positional dependency strengthened that — inserting a turn mid-transcript used to renumber and so rewrite every block below it, invalidating the cache from there down for a one-line change. There is deliberately no `formatTranscript` joining them — the prompt is the only consumer and needs them separate |
| `numberTurns(record)` | Gives every turn a citation number and remembers the next one to hand out, returning a `NumberedRecord` so the invariant travels in the type rather than in a comment. Uniqueness of numbers *already* stored is assumed, not enforced — a duplicate is carried rather than repaired, because which turn an existing `[12]` meant is unanswerable and renumbering one silently re-aims it; what is enforced is that the counter clears every number any turn holds, so a duplicate can't become a triplicate. Pure, total, idempotent — returns the record by identity when there is nothing to do, like the `db.ts` migrations, so a hundred reads render the same bytes and nothing churns React. Two sources for "next", and the persisted `nextTurnNumber` is allowed to win: the turns can only say what survives, the counter says what has ever been handed out, which is exactly what deletion breaks (`max(number) + 1` re-issues a deleted number, and a profile citing it then points at different content). A record with no numbers at all is pre-field and gets 1…n **by position** — what the old renderer showed, so every `[4]` in a stored profile keeps its meaning. Applied in `normalize` (read), `saveDate` (write) and `useDates.update` (so memory matches what the UI renders) |
| `speakerLabel(record, speaker)` | `ME`, `NOTE`, `COACH`, or the person's name uppercased — the same label in prompts, UI, and pasted logs |
| `adviceTurn(suggestion)` | A suggestion as the `coach` turn that goes in the pool: the priority plus the option labels, two lines out of a four-hundred-word generation. Derived here rather than asked of the model — no output field to get wrong, no tokens spent, and the same suggestion always renders the same way. The whole `Suggestion` rides along in `Turn.advice` for the panel; only `text` reaches the prompt. The turn takes the suggestion's own id, so the two can't drift apart |
| `parsePastedLog(raw, theirName)` | `Name: text` lines with the common label variants plus the person's own name, plus an optional bracketed timestamp right after the label — `Name [Tue 9pm]: text`. The bracket is free-form, same string the manual composer's "when" field takes; omit it and the line parses exactly as before. Unlabelled lines join the previous turn, so multi-line messages survive. Anything before the first recognised label is dropped. |
| `transcriptStats(record)` | Turn, word, and question counts per side — the UI header, and nothing else. The prompt used to carry them as `<counts>`; it doesn't, and the reasoning is in `transcriptSegments`. Built by *selecting* `them` and `me` rather than by excluding the rest, so anything that isn't one of the two people showing up stays out by construction: a `context` entry is the user writing something down, a `coach` entry is this app talking to itself |
