# Project Overview

**Date Bro** is a full-page Chrome extension that helps someone understand a dating situation they
are already in: who the other person appears to be, how they themselves are showing up, and what to
do next. All input is manual — there is no scraping, no site integration, no content script.

## What It Does

1. **Stores people.** One record per person: name, stage, and what the user wants out of it.
2. **Stores the conversation.** Turns typed one at a time or bulk-imported from a pasted log, plus
   `NOTE` entries for anything the user knows that nobody typed. One pool — there is no separate
   "what you know about them" field, and no fact about the connection lives outside this list. The
   one thing that does is `goal`, which isn't a fact about them: it's what the user is asking the
   coach to optimise for, so nothing the conversation does can make it stale.
3. **Keeps a profile of them** — an evidence-cited portrait derived from that pool, amended section
   by section rather than regenerated from zero, so detail accumulates instead of being thrown away.
4. **Keeps a profile of the user** — the same, turned inward.
5. **Lets you correct either one.** Tell it what to change — "drop the avoidant read, she works
   nights" — and it amends the profile and says what it did. The instruction is applied once and
   discarded; the profile is the thing that's kept.
6. **Suggests the next move** — 2–3 differentiated options with sendable drafts. The advice is
   written into the conversation as a `COACH` line where it was given, and "I sent this" puts a
   draft back in as a message, so the next run can see what was tried and what came of it. Click a
   `COACH` bubble to read that suggestion in full again.
7. **Evolves.** The coach — its voice, everything it believes about reading people and about what
   to do next — is one editable markdown document, not a fixed prompt. You can rewrite any of it,
   and it amends itself after a next move when something it advised actually landed or didn't.

## Tech Stack

| Layer | Technology |
|---|---|
| Extension Framework | WXT |
| Language | TypeScript |
| UI | React 19 |
| Styling | Tailwind CSS 4, custom design tokens |
| Icons | Lucide React |
| Storage | IndexedDB (`idb`) for records · `chrome.storage.local` for settings and the coach |
| LLM | OpenAI-compatible HTTP (BYOK) · Anthropic `/v1/messages` (BYOK) · Qwen Chat (delegated agent via the user's `chat.qwen.ai` session) |
| Build | Vite (via WXT) |
| Package Manager | Bun |

## Extension Metadata

- **Manifest:** V3
- **Permissions:** `storage`, `tabs`, `scripting`, `cookies`, `declarativeNetRequest`
- **Host Permissions:** `*://*/*` (the user's chosen LLM endpoint + `chat.qwen.ai`)
- **UI Entry:** `app.html`, opened as a full tab from the toolbar action
- **Version:** see `package.json` (source of truth — do not mirror here)

## Core Constraints

- **The app page does the orchestration.** It's a long-lived extension page with full `chrome.*`
  access, so unlike `job-bro` there is no offscreen document and no service-worker lifetime problem.
  The background worker exists only to open the app tab and to proxy Qwen.
- **No Chrome built-in AI.** Gemini Nano can't hold a transcript plus a knowledge base and return
  structured judgement. Deliberately omitted rather than offered and broken.
- **Everything is local.** Nothing leaves the browser except the model call the user triggers.
- **The knowledge base is versioned as prose, and is only the seed.** `src/coach/knowledge.ts` is
  the source of record for what ships — no separate research document — but it is assembled into an
  editable document (`src/coach/mind.ts`) that the user and the coach both rewrite. Editing the
  module changes what new installations start from and what "revert to shipped" restores.
