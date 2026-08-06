use bun for package management

use bun typecheck

be concise

read and update wiki below when needed

one user, one browser, no server — the operator is the owner, and the coach's LLM
is you. judge findings against that, not a multi-tenant product: no hostile input,
no untrusted callers, no data anyone else can see.

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
  source of record for it. There is no separate research document: the module is prose, it is what
  gets injected into the prompt, and it carries its own reasoning. When you change what the coach
  believes, change it there and say why in the comment above the module you touched.
