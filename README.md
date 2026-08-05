# Date Bro

A dating coach that works from evidence instead of vibes. Chrome extension, full-page, everything
local.

You write down what you know about the person you're seeing and what you're like around them, then
type or paste in your conversation. Three buttons do the rest:

| Button | What it does |
|---|---|
| **Rebuild them** | Re-derives the picture of your date from the seed context plus everything said since — who they are, what they care about, how they communicate, whether they're actually interested, and what you still don't know |
| **Rebuild you** | The same read, turned on you: how you're landing, what's working, what's costing you, and whether your messages match what you say you want |
| **What do I say?** | Two or three genuinely different options for the next move, each with the actual text to send, why it works, and how to read what comes back |

Every claim cites the turn it came from and carries a confidence level. Anything the model doesn't
know goes in "what you still don't know" rather than getting invented.

**"What do I say?" can research.** With either bring-your-own-key backend, it can search the web and
read pages — for a date idea, a venue, whether a place is open Sundays, etiquette for a culture the
user mentioned, or to verify a specific claim about the person for safety (does their stated job
check out, does their photo turn up elsewhere as a catfish signal). That last one is ordinary,
widely recommended practice before meeting someone from the internet — the line isn't whether a
search includes their name, it's whether it's answering one stated claim versus fishing for an
open-ended profile ("everything about \[name]", their social media, their whereabouts). Anything
durable it finds — a venue's hours, a confirmed fact — gets kept in a per-person research note so it
isn't re-searched next time; edit or clear it from the profile anytime. (The Qwen backend already
researches on its own, server-side, as part of its normal chat behavior.)

## What it won't do

Encoded as hard constraints in the system prompt, not as suggestions:

- No manipulation. No negging, manufactured jealousy, false scarcity, strategic withdrawal, love
  bombing, or pressure of any kind.
- No engineering around a "no". A no, a slow-down, or a non-answer is an answer.
- No flattery about interest that isn't there. If it's one-sided, it says so, and offers the
  dignified exit as a real option.
- No invented facts about you. Drafts use your voice and your actual history, or they don't exist.

The reasoning behind those, and everything else the coach knows, is in
[src/coach/knowledge.ts](src/coach/knowledge.ts) — attachment markers held as hypotheses rather
than labels, Gottman's bids and turning-toward, perceived partner responsiveness, self-disclosure
reciprocity, the question-asking speed-dating work, Big Five over MBTI, and the romance-scam
patterns worth flagging. It's plain prose, and it's exactly what gets injected into the prompt, so
what you read is what the model is told.

## Models

Three backends, all zero-install:

- **Qwen** (default) — runs on your logged-in [chat.qwen.ai](https://chat.qwen.ai) browser session.
  No API key, no cost. Log in there first and keep a tab open the first time.
- **Bring your own key, OpenAI-compatible** — any `/chat/completions` endpoint. Presets for OpenAI,
  OpenRouter, DeepSeek, Groq, Ollama, and LM Studio; anything else works with a base URL and a model
  name.
- **Bring your own key, Anthropic** — any `/v1/messages` endpoint: the Anthropic API itself, a
  gateway, or a local proxy. Same deal — base URL plus model name. Streams, so "Show reasoning" can
  put Claude's thinking on screen while you wait.

Chrome's built-in Gemini Nano is deliberately absent — it's far too small to hold a transcript plus
a knowledge base and return structured judgement.

## Privacy

Everything lives in this browser. Dates, conversations, and rebuilt contexts go to IndexedDB;
settings and your API key go to `chrome.storage.local`. Nothing is uploaded anywhere except the
model endpoint you choose, when you press one of the three buttons.

## Development

```bash
bun install
bun run dev        # hot-reload dev build
bun run build      # production build → .output/chrome-mv3/
bun run typecheck
bun run zip
```

Load it via `chrome://extensions` → Developer mode → Load unpacked → `.output/chrome-mv3`. Then
click the toolbar icon; it opens as a full tab.

## Tech

WXT · React 19 · Tailwind 4 · IndexedDB (`idb`) · TypeScript · Bun.

## License

MIT
