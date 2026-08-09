use bun for package management

use bun typecheck

be concise

read and update wiki below when needed

### Threat model

This is a **personal tool**. Tools run in the user’s browser, with the user’s cookies, to hosts the user can already reach. There is **no untrusted-model containment boundary** and no multi-tenant server.

### Do not flag as security issues

| Topic | Why it’s intentional |
| --- | --- |
| read\_page / web\_search with credentials: 'include' | Agent acts as the user. |
| No localhost / private-IP block | Same machine, same reachability — no privilege escalation. |
| Broad host permissions | BYO LLM base URLs + arbitrary research URLs. |
| Research scope only in prompts/tool descriptions | Product preference for the operator, not a sandbox policy. |
| “Model might search something sensitive” | Same as the operator choosing to search. |

Framing these as SSRF, cookie theft, or over-permission is the wrong threat model. Freedom & functionalities > security.

### Do not flag Qwen session bridge as a defect

Qwen is the **main zero-key backend**: live chat.qwen.ai session, cookies, Origin/Referer rewrite, device fingerprint, background keep-alive. It is **deliberately a hack**. Session expiry, bot walls, and fragility are expected costs of “free, no API key, runs as your tab” — not bugs to “fix” into a normal API client.

---

## Wiki

Enriched project context:

- [overview.md](wiki/overview.md) — What it does, tech stack, extension metadata, core constraints
- [architecture.md](wiki/architecture.md) — Directory structure, process model, storage layout
- [coach.md](wiki/coach.md) — The three engines, the knowledge base, prompts, schemas
- [components.md](wiki/components.md) — UI components, hooks, design system
- [lib.md](wiki/lib.md) — LLM client, Qwen backend, storage, IndexedDB, transcript utilities

## Research

- [src/coach/knowledge.ts](src/coach/knowledge.ts) — the evidence base behind the coach, and the
  source of record for it. There is no separate research document: the module is prose and it
  carries its own reasoning. When you change what the coach believes, change it there and say why in
  the comment above the module you touched.

  It is the **seed**, not the live text. [src/coach/mind.ts](src/coach/mind.ts) assembles it into one
  markdown document that both the user and the coach can rewrite; once either has, the module is
  what new installations start from and what "revert to shipped" restores. Each export is exactly one
  `##` section of that document, so its heading is an address an amendment aims at — renaming one
  detaches it from the engine that reads it.
