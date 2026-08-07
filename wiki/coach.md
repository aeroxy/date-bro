# The Coach

Three engines, one shape: build messages → one LLM call → parse → validate → retry once → store.
The two rebuild engines never deviate from that — no tool loop, no multi-stage pipeline. `suggestMove`
is the one exception: on the keyed backends (`openai`, `anthropic`) it can run a bounded tool-calling
loop (web search + read page) before producing its answer — see [lib.md](lib.md#agentts--tools) for
the mechanics.

## `knowledge.ts`

The evidence base, and the source of record for it — token-budgeted prose that goes verbatim into
the prompt. Split so each engine only pays for what it uses:

| Module | Used by | Contents |
|---|---|---|
| `KB_EVIDENCE` | both rebuilders | Inference discipline: separate observation from inference, confidence is part of the claim, one message is never a pattern, prefer the boring explanation, unknowns are output |
| `KB_READ_THEM` | rebuild-them | Attachment markers (as hypotheses), Big Five over MBTI/love-languages, bids for connection, honest interest signals ranked by diagnostic value, red/amber/green flags |
| `KB_READ_ME` | rebuild-you | Responsiveness quality, bid response rate, investment asymmetry, interview mode, disclosure level, voice, stated vs revealed goals |
| `KB_MOVES` | suggest | The PPR recipe (understanding → validation → caring → then your own), the depth ladder, cheap well-evidenced wins, texting pragmatics, set pieces (asking out, exclusivity, repair, taking a no, ending it), calibration rules |
| `KB_RESEARCH` | suggest, only when tools are attached | Scopes web research to logistics plus specific-claim safety verification (not open-ended profiling), and says to check `<research_notes>` before searching again |

**Editing rule:** edit the module directly — it is the source, not a rendering of one. Two things
to preserve when you do. Keep it written as instructions rather than as a survey: the model needs
the rule a finding implies, not the finding. And keep the exclusions excluded — Dutton & Aron's
misattribution study, MBTI, love languages as a typology, and Gottman's prediction percentages are
absent on purpose, so a well-meaning addition is a regression.

## `prompts.ts`

Every engine sends the same five strata, ordered slowest-changing first. The order is the whole
design: it's what makes the transcript — nearly all of the request — a stable cacheable prefix.

| | Stratum | Contents | Changes when |
|---|---|---|---|
| `system` | L0 | `IDENTITY` + orientation line + `KB_EVIDENCE` + the user's standing instructions | app release / settings edit |
| `user[0]` | L1 | `<the_person>`, `<the_user>` | the profile is edited |
| `user[1]` | L2 **[cache]** | `<transcript>` + `<counts>` | any transcript mutation — a turn added, edited, deleted, or a log imported |
| `user[2]` | L3 **[cache]** | `<task>` + this engine's knowledge modules + `OUTPUT_RULES` + shape sketch | never (constant per engine) |
| `user[3]` | L4 | `<research_notes>`, prior contexts, `<notes_from_the_user>`, `<the_situation>`, closing instruction | every run |

L0 is identical across all three engines, and L3 sits *after* the transcript rather than in the
system prompt. Both facts exist so the three engines share **one** L2 cache entry instead of each
writing its own copy of the transcript — and instructions-after-material is the better layout for a
long input anyway. See [lib.md](lib.md) for how the strata reach the wire.

**The invariant:** nothing above a `[cache]` mark may change more often than the mark itself, or the
entry gets written and never read. That is why `<research_notes>` lives in L4 despite reading like
material — one researched `suggestMove` rewrites it, and it used to sit above the transcript, which
silently invalidated the prefix for all three engines.

- **Turns are numbered** so the model can cite `[4]` rather than paraphrase vaguely. The UI shows
  the same numbers, so a citation is checkable.
- **`<research_notes>`** carries `record.researchNotes` — durable facts kept from earlier
  `suggestMove` runs (see `lib/research-notes.ts`) — with an instruction to reuse them instead of
  re-searching. Shown to all three engines, not just `suggestMove`: it's already-vetted factual
  content by the time it lands here, no different from anything else the user could have typed into
  the seed context by hand.
- **`<counts>`** gives raw turn/word/question ratios per side, immediately followed by the caveat
  that they're a starting point for reading investment symmetry, not a verdict — the user may have
  entered only part of the conversation.
- **`<notes_from_the_user>`** carries `record.feedback[engine]` — the running thread the user writes
  back to *that* engine from the panel footer, oldest first, injected into every later run of it.
  The surrounding prose is the point: later notes outrank earlier ones, a fact the user asserts
  about their own life is taken as true, but a note cannot make the evidence say something it
  doesn't — an unsupportable ask goes in the honest note or open questions instead. Notes are
  per-engine, so correcting the read of them doesn't quietly steer the drafts.
- **`priorContext(record)`** feeds previously rebuilt contexts back in as a *prior*, explicitly
  outranked by the transcript. This is what makes a second rebuild an update rather than a
  from-scratch re-read, and it's why the suggestion engine can write in the user's voice.
- **`sharedSystem`** builds L0 and appends the user's house rules, scoped to override the style
  preferences in the task block but never the non-negotiables.

## `schemas.ts`

Every engine has three descriptions of its output, because different backends need different things:

- **`*_SHAPE`** — a TypeScript-ish sketch pasted into the prompt with inline comments. Models follow
  this far more reliably than raw JSON Schema, and it's the only thing the Qwen backend ever sees.
- **`*_SCHEMA`** — strict JSON Schema (`additionalProperties: false`, everything `required`), sent as
  `response_format.json_schema` (`openai`) or `output_config.format` (`anthropic`) only when the user
  enables structured output on a provider that supports it.
- **`validate*`** — coarse structural checks that run on every path. A failure produces one specific
  complaint that goes back to the model with its own bad output attached.

`validateSuggestion` additionally rejects an empty `draft`, because the failure mode worth catching
isn't malformed JSON — it's a model that describes what to say instead of saying it.

## `run.ts`

`rebuildPersonContext` and `rebuildSelfContext` are identical in shape: resolve config + house
rules, build messages, call `completeJSON` with the matching validator and schema. Deliberately
never given tools of their own — they're pure re-reads of material the user already provided (plus
whatever's already landed in `<research_notes>`); only `suggestMove` ever initiates a new search.

`suggestMove` branches on `resolveSuggestionOutput(config)`:

- **Qwen, or `tools_enabled: false`** → the same `completeJSON` path as the rebuild engines.
- **Either keyed backend (`openai` or `anthropic`) with tools on (the default)** → `ALL_TOOLS` (`web_search`, `read_page`) plus
  `buildVerdictSchema(SUGGESTION_SCHEMA)` as the `provide_verdict` channel, run through
  `runAgentWithValidation`. An optional `onActivity` callback fires a human-readable line
  (`"Searching: …"` / `"Reading: …"`) per tool call, which `App.tsx` shows live under the spinner.

Each stamps `generatedAt` and `turnsAt` (the record's `turnsUpdatedAt` as the run saw it — see
[architecture.md](architecture.md#freshness)); `suggestMove` also mints an id and records the
situation the user typed.
Suggestion history is capped at 20 per person, newest first.

## Output contracts

| Engine | Returns | Notable fields |
|---|---|---|
| `rebuildPersonContext` | `PersonContext` | `interest_read` with `signals_for` / `signals_against` / `honest_note`; `flags`; `attachment_hypothesis` (explicitly a hypothesis, with its own confidence); `open_questions` |
| `rebuildSelfContext` | `SelfContext` | `your_voice` (what drafts must sound like); `patterns` with their likely effect; `working` and `costing_you`; `goal_read` splitting stated from revealed |
| `suggestMove` | `Suggestion` | `options[]` — each a verbatim `draft`, a `why`, a `then` for reading the response, and a risk level; plus `avoid`, `timing`, `honest_note`, `research_notes` (durable findings, merged into the record — see `lib/research-notes.ts`) |

Every `Claim` is `{ claim, evidence, confidence }`. The UI renders confidence as a three-bar mark,
so a low-confidence guess never gets to look like a finding.
