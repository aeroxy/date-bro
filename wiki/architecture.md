# Architecture

## Directory Structure

```text
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
│   ├── lib/                     # llm-client, agent, storage, db, transcript, cn, qwen/, tools/, import/
│   ├── types/                   # date, coach, settings, globals
│   └── assets/index.css         # Design tokens (@theme) + editorial layer
├── public/assets/icon.svg       # Toolbar icon master → icon-{16,32,48,128}.png
├── wxt.config.ts
└── wiki/
```

## Process Model

There are only two contexts, and almost everything happens in the first.

```text
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
          │    the coach's mind (coach/mind.ts assembles the knowledge
          │      exports into the editable document; knowledge.ts is only
          │      the shipped seed and what "revert" restores)
          │    + transcript (messages + NOTE entries)
          │    + whatever the rebuild engines last produced
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
| IndexedDB `date-bro` v1 | `dates` (keyPath `id`, index `by-updated`) | `DateRecord[]` — the person, the stated goal, all turns (messages, NOTE entries and COACH advice), both markdown profiles with their judgments, accumulated research notes, and the two clocks (`updatedAt` for any write, `turnsUpdatedAt` for evidence writes only — see Freshness) |
| `chrome.storage.local` | `dateBroLLMProfiles` | `LLMProfile[]` |
| `chrome.storage.local` | `dateBroActiveProfileId` | `string` |
| `chrome.storage.local` | `dateBroSettings` | `CoachSettings` (the house-rules prompt) |
| `chrome.storage.local` | `dateBroCoachMind` | `Mind` — the coach itself: its identity, its whole playbook, and what it has learned. Not a `DateRecord` field precisely because every record shares it; see [coach.md](coach.md#mindts) |
| `chrome.storage.local` | `dateBroLastOpened` | last-selected date id, so the app reopens where you left it |
| `chrome.storage.local` | `dateBroImportLast` | the "last N messages" the previous import fetched with; blank (the default) means the whole history |
| `chrome.storage.local` | `qwen_device_id` | cached device id for the Qwen fingerprint |

`normalize` in `lib/db.ts` runs four migrations and then `numberTurns`, on every read, under the same
rule: **derive everything, mint nothing** — with one deliberate exception, the last step, where the
thing allocated is derived from the array's own order and so comes out the same on every pass.
`normalize` runs on reads, not once at startup, so a record can be read a hundred times before its
next save — anything non-deterministic would churn on each pass. Every default in `normalize` reads
from the migrated value, never from the original record: reading the original would quietly undo
whatever a migration just did.

The order is load-bearing in two places, and the bullets below are grouped by subject rather than by
that order. `migrateSectionNames` rewrites headings inside `themProfile` / `meProfile`, which for a
legacy record is what `migrateContexts` creates — rename first and it finds nothing to rename in
exactly the documents it exists for. And `numberTurns` runs last, after both of the steps that add
turns.

- `migrateSeed` — records written when `seedThem`/`seedMe` existed come back carrying them, and
  their text moves into `turns` as `context` entries ahead of turn one. Nothing written under the
  old model is lost; it just enters the pool like anything else. Ids are derived from the record id
  rather than minted, so it can't re-add a note after the first save persists it.
- `migrateSectionNames` — renames profile headings that were renamed after profiles had already been
  written under the old name (`Open threads` → `Threads to pick back up`). Matching is by heading, so
  skipping this would give a profile two sections holding the same thing.
- `migrateSuggestions` — the newest entry of the retired `suggestions` array becomes the `coach`
  turn it would be today, appended at the end. Only the newest: a suggestion records `turnsAt` as a
  wall clock rather than a position, so there is no way to work out where in the transcript the
  older ones were given, and inventing an order for twenty of them would put fabricated chronology
  into the one list this app treats as fact. The newest is the exception worth making — it was
  generated from the transcript as it then stood — and it means the panel isn't empty after the
  upgrade. Idempotent by taking the suggestion's own id for the turn.
- `migrateContexts` — records carrying the retired `themContext`/`meContext` schemas get them
  rendered into the markdown profiles by `personToMarkdown` / `selfToMarkdown`, with the structured
  half (`interest_read`, flags, `goal_read`, open questions) lifted into the profile's `judgment`.
- `numberTurns` (`lib/transcript.ts`) — last, and the one step that allocates rather than derives. A
  turn written before `Turn.number` existed hasn't got one, so it gets one here, counted from 1 in
  the order the **migrated** array ends up in. That is exactly what the positional numbering this
  replaced computed — `normalize` has always run before anything rendered a turn — so a `[4]` written
  into a profile back then still resolves to the turn it meant. Hence the ordering: numbering before
  `migrateSeed` prepends its seed notes or `migrateSuggestions` appends its `coach` turn would number
  the same prose two turns off. Idempotent, so the guarantee is free on every subsequent read — a
  turn that already carries a number keeps it, and a record needing nothing comes back by identity.
  Also applied on the way *in* (`saveDate`), so "anything persisted has its numbers" holds without
  every caller remembering.
  Pure and total: every old field has a home in the new layout, since the canonical headings were
  derived from those very fields.

A `DateRecord` holds everything for one person, turns included. The whole dataset is text measured
in hundreds of KB, so there is no separate turns store and no pagination — `useDates` loads all
records once and writes each mutation straight through.

## The turn pool

`turns` is the context pool, not only the messages. Two of the four speakers aren't speakers:

- **`context`** — something the user knows that nobody typed. It lives in the same array so there is
  one chronology and one numbering to cite, and so a fact learned today lands where it was learned.
  Chronology is the array's job; identity is `Turn.number`'s, handed out once from
  `DateRecord.nextTurnNumber` and never reused — so the two can't drift when a turn is inserted.
- **`coach`** — what this app advised, at the point it advised it, carrying the whole `Suggestion` in
  `Turn.advice`. It replaced `DateRecord.suggestions`, a parallel history with its own pills, its own
  20-cap and its own delete button, all describing a timeline the conversation was already keeping.
  Advice in a side list is advice no later run can see; in the pool it sits directly above whatever
  the user did next, which is the only evidence that exists about whether it worked. Only the
  two-line summary reaches the prompt — `formatTurn` renders `text` and nothing else, so the panel
  gets three drafts and later requests pay for two lines.

**`turnsUpdatedAt` tracks evidence, not writes to `turns`.** Adding a `context` entry or a message
bumps it and marks every existing read stale, which is right — a new fact is exactly what should
trigger a rebuild. Adding a `coach` turn does not, and `useDates.update` takes `{ evidence: false }`
to say so: a line the coach wrote itself is not something either person said, and without the
opt-out every "What do I say?" would immediately flag both profiles as out of date.

## Freshness

Every read carries two stamps: `generatedAt` for "Rebuilt 2h ago", and `turnsAt` — the record's
`turnsUpdatedAt` at the moment the run was built, i.e. the transcript the model actually saw. The
"conversation has moved on" chip compares the record's current `turnsUpdatedAt` against it.

A profile carries two more, because its halves age separately. An amendment rewrites the prose
without regenerating the judgment, so `amendedAt`/`amendedTurnsAt` describe the prose and
`generatedAt`/`turnsAt` describe the judgment. One pair could only ever be right about one half: with
just `turnsAt`, an amendment that had read every current turn still reported "conversation has moved
on".

**Why not `updatedAt`.** `updatedAt` moves on *every* write, so comparing against it marked a read
stale when the user rebuilt the other tab, saved the profile, or merged in research notes — in
normal use at least one tab was always wrongly flagged. `turnsUpdatedAt` is stamped when a write carries
`turns` *as evidence* — a write may pass `{ evidence: false }` to say it doesn't, and appending or
deleting a `coach` turn does, because the coach's own line is not something either person said.
Without that, asking "what do I say?" marked both profiles stale the moment it answered. So the signal
means what it says. Comparing two turn-stamps rather than a turn-stamp against
a wall-clock time also catches the case where a turn was added *during* the run: the model didn't see
it, so the read is genuinely stale the moment it lands.

Records written before the field existed read back with `turnsUpdatedAt: 0` and no `turnsAt`, which
`isStale` treats as "nothing to compare" — no chip until the next real turn edit.

Nothing is invalidated automatically — a stale read is still useful, and re-running costs a model
call.
