use bun for package management

use bun typecheck

be concise

read and update wiki below when needed

---

## Wiki

Enriched project context:

- [overview.md](wiki/overview.md) — What it does, tech stack, extension metadata, core constraints
- [architecture.md](wiki/architecture.md) — Directory structure, process model, storage layout
- [coach.md](wiki/coach.md) — The three engines, the knowledge base, prompts, schemas
- [components.md](wiki/components.md) — UI components, hooks, design system
- [lib.md](wiki/lib.md) — LLM client, Qwen backend, storage, IndexedDB, transcript utilities

## Research

- [docs/dating-research.md](docs/dating-research.md) — the evidence base behind the coach, with
  citations and caveats. `src/coach/knowledge.ts` is its condensed, prompt-injected form. Change
  the research doc first, then the knowledge module.
