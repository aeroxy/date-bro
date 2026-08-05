# Project Overview

**Date Bro** is a full-page Chrome extension that helps someone understand a dating situation they
are already in: who the other person appears to be, how they themselves are showing up, and what to
do next. All input is manual — there is no scraping, no site integration, no content script.

## What It Does

1. **Stores people.** One record per person, with a free-text seed context about them, a seed
   context about the user *in relation to them*, and a stated goal.
2. **Stores conversation turns.** Typed one at a time, or bulk-imported by pasting a labelled log.
3. **Rebuilds their context** — an evidence-cited portrait derived from seed + transcript.
4. **Rebuilds the user's context** — the same, turned inward.
5. **Suggests the next move** — 2–3 differentiated options with sendable drafts.

## Tech Stack

| Layer | Technology |
|---|---|
| Extension Framework | WXT |
| Language | TypeScript |
| UI | React 19 |
| Styling | Tailwind CSS 4, custom design tokens |
| Icons | Lucide React |
| Storage | IndexedDB (`idb`) for records · `chrome.storage.local` for settings |
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
- **The knowledge base is versioned as prose.** `docs/dating-research.md` is the source;
  `src/coach/knowledge.ts` is its condensed prompt-injected form. Edit the doc first.
