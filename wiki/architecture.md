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
├── docs/dating-research.md      # The evidence base
├── docs/logo/                   # Mark exploration + the shipped icon's proof sheet
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
                                          header rewrite + 10s keep-alive)
```

**Why Qwen is bridged and the keyed backends aren't.** Both `chrome.cookies` and
`declarativeNetRequest` are reachable from the app page, so the bridge isn't about permissions — it's
that the Qwen call is a long SSE stream that the service worker keeps alive with its own `QWEN_PING`
heartbeat, and the background is where that machinery already lives. The keyed paths are a plain
`fetch` from the app page and need none of it — including Anthropic's, which streams SSE but does so
from a page with no lifetime limit, so there's nothing to keep alive.

## Messages

Only three, all app page → background:

| Message | Payload | Response |
|---|---|---|
| `QWEN_CHAT_REQUEST` | `{ requestId, messages, qwenModel }` | `{ ok, result }` or `{ ok: false, error, isAbort }` |
| `QWEN_CHAT_CANCEL` | `{ requestId }` | `{ ok: true }` — aborts the tracked controller |
| `QWEN_PING` | — | `{ ok: true }`; fired by `sendQwenChatStream` every 10s to keep the worker alive |

## Storage Layout

| Store | Key | Contents |
|---|---|---|
| IndexedDB `date-bro` v1 | `dates` (keyPath `id`, index `by-updated`) | `DateRecord[]` — the person, both seed contexts, all turns, both rebuilt contexts, suggestion history, accumulated research notes, per-engine feedback threads |
| `chrome.storage.local` | `dateBroLLMProfiles` | `LLMProfile[]` |
| `chrome.storage.local` | `dateBroActiveProfileId` | `string` |
| `chrome.storage.local` | `dateBroSettings` | `CoachSettings` (the house-rules prompt) |
| `chrome.storage.local` | `dateBroLastOpened` | last-selected date id, so the app reopens where you left it |
| `chrome.storage.local` | `qwen_device_id` | cached device id for the Qwen fingerprint |

A `DateRecord` holds everything for one person, turns included. The whole dataset is text measured
in hundreds of KB, so there is no separate turns store and no pagination — `useDates` loads all
records once and writes each mutation straight through.

## Freshness

Rebuilt contexts and suggestions carry a `generatedAt`. The UI compares it to the record's
`updatedAt` and shows a "conversation has moved on" chip when turns were added after the rebuild.
Nothing is invalidated automatically — a stale read is still useful, and re-running costs a model
call.
