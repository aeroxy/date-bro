# Architecture

## Directory Structure

```
date-bro/
├── src/
│   ├── entrypoints/
│   │   ├── background.ts        # Opens the app tab; Qwen proxy + header rules
│   │   └── app/
│   │       ├── index.html       # → app.html
│   │       ├── main.tsx
│   │       └── App.tsx          # Layout, the three actions, tab state
│   ├── components/              # UI, with ui/ holding the design-system primitives
│   ├── coach/                   # knowledge.ts, prompts.ts, schemas.ts, run.ts
│   ├── hooks/useDates.ts
│   ├── lib/                     # llm-client, agent, storage, db, transcript, cn, qwen/, tools/
│   ├── types/                   # date, coach, settings, globals
│   └── assets/index.css         # Design tokens (@theme) + editorial layer
├── public/assets/icon.svg       # Toolbar icon master → icon-{16,32,48,128}.png
├── wxt.config.ts
└── wiki/
```

## Process Model

There are only two contexts, and almost everything happens in the first.

```
Toolbar click ──► background.ts ──► opens/focuses app.html (one tab, reused)

app.html (extension page — full chrome.* access, no lifetime limit)
  │
  ├─ useDates ──► IndexedDB (dates store)
  ├─ storage.ts ──► chrome.storage.local (LLM profiles, settings)
  │
  └─ one of three actions
        coach/run.ts
          ├─ loads active LLMConfig + custom prompt
          ├─ coach/prompts.ts builds [system, user] from
          │    knowledge module + seed context + transcript + prior contexts
          └─ lib/llm-client.completeJSON
                ├─ backend 'openai'    ─► fetch → {base_url}/chat/completions
                ├─ backend 'anthropic' ─► fetch SSE → {base_url}/messages
                └─ backend 'qwen-chat' ─► chrome.runtime.sendMessage
                                            │
                                            ▼
                                       background.ts
                                         sendQwenChat → chat.qwen.ai
                                         (cookies + declarativeNetRequest
                                          header rewrite + 10s idle-timer poke)
```

**Why Qwen is bridged and the keyed backends aren't.** Both `chrome.cookies` and
`declarativeNetRequest` are reachable from the app page, so the bridge isn't about permissions — it's
that the Qwen call is a long SSE stream and the service worker is the context with a 30-second idle
timeout to worry about, so the keep-alive machinery lives where the lifetime problem is. The keyed
paths are a plain `fetch` from the app page and need none of it — including Anthropic's, which
streams SSE but does so from a page with no lifetime limit, so there's nothing to keep alive.

**How the keep-alive actually works.** `sendQwenChatStream` runs *inside* the worker, so it can't
ping itself: `chrome.runtime.sendMessage` from the worker never reaches the worker's own listener.
What resets the idle timer is making an extension API call at all, so it calls
`chrome.runtime.getPlatformInfo()` every 10s and discards the result. (An earlier version sent a
`QWEN_PING` message to a handler that could never receive it — the timer was being reset by the
`sendMessage` call itself, not by anything answering it.)

## Messages

Only two, both app page → background:

| Message | Payload | Response |
|---|---|---|
| `QWEN_CHAT_REQUEST` | `{ requestId, messages, qwenModel }` | `{ ok, result }` or `{ ok: false, error, isAbort }` |
| `QWEN_CHAT_CANCEL` | `{ requestId }` | `{ ok: true }` — aborts the tracked controller |

Plus one background → app page broadcast, `QWEN_CHAT_THINKING` (`{ requestId, thinking }`), because
`sendResponse` only fires once and reasoning has to arrive while the model is still working.

## Storage Layout

| Store | Key | Contents |
|---|---|---|
| IndexedDB `date-bro` v1 | `dates` (keyPath `id`, index `by-updated`) | `DateRecord[]` — the person, both seed contexts, all turns, both rebuilt contexts, suggestion history, accumulated research notes, per-engine feedback threads, and the two clocks (`updatedAt` for any write, `turnsUpdatedAt` for transcript writes only — see Freshness) |
| `chrome.storage.local` | `dateBroLLMProfiles` | `LLMProfile[]` |
| `chrome.storage.local` | `dateBroActiveProfileId` | `string` |
| `chrome.storage.local` | `dateBroSettings` | `CoachSettings` (the house-rules prompt) |
| `chrome.storage.local` | `dateBroLastOpened` | last-selected date id, so the app reopens where you left it |
| `chrome.storage.local` | `qwen_device_id` | cached device id for the Qwen fingerprint |

A `DateRecord` holds everything for one person, turns included. The whole dataset is text measured
in hundreds of KB, so there is no separate turns store and no pagination — `useDates` loads all
records once and writes each mutation straight through.

## Freshness

Every read carries two stamps: `generatedAt` for "Rebuilt 2h ago", and `turnsAt` — the record's
`turnsUpdatedAt` at the moment the run was built, i.e. the transcript the model actually saw. The
"conversation has moved on" chip compares the record's current `turnsUpdatedAt` against it.

**Why not `updatedAt`.** `updatedAt` moves on *every* write, so comparing against it marked a read
stale when the user rebuilt the other tab, saved the profile, or left a feedback note — in normal use
at least one tab was always wrongly flagged. `turnsUpdatedAt` is stamped only when a write carries
`turns`, so the signal means what it says. Comparing two turn-stamps rather than a turn-stamp against
a wall-clock time also catches the case where a turn was added *during* the run: the model didn't see
it, so the read is genuinely stale the moment it lands.

Records written before the field existed read back with `turnsUpdatedAt: 0` and no `turnsAt`, which
`isStale` treats as "nothing to compare" — no chip until the next real turn edit.

Nothing is invalidated automatically — a stale read is still useful, and re-running costs a model
call.
