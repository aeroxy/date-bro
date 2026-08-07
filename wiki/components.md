# Components & Design System

## Design tokens (`src/assets/index.css`)

Defined in a Tailwind 4 `@theme` block. The rules that matter:

- **Two accent roles, not interchangeable.** `action` (orange) is for things you can click;
  `status` (blue) is for things that are true. Keeping them apart is why a "Rebuild" button and a
  "live" dot never get confused.
- **Warm paper, cool neutrals.** The background is warm off-white (hue ~106); the neutrals stay
  cool zinc (hue ~286). That contrast is what keeps the off-white reading as paper rather than grey.
- **One addition over the original:** a `yes` (green) role, so the green/amber/red flag scale reads
  as one deliberate ramp instead of three stray hues.
- **Shadows travel down, not out** — that's the "sitting on paper" lift.
- **Editorial layer:** `.grid-bg` (28px engineering grid, edge-faded, on a positioned
  pointer-events-none element only), `.eyebrow` (mono micro-label with wide tracking — reads as an
  instrument label, not shrunken body copy), `.display`, `.dot-live`, `.scroll-slim`.

## `components/ui/`

| Component | Notes |
|---|---|
| `Button` | `primary` (ink) is the default affirmative; `accent` (orange) is reserved for the one call-to-action per view, or it stops meaning anything. Radius matches the fields so adjacent controls share an edge language. |
| `Card` | Plus `CardInvert` (dark counterweight with its own grid), `Eyebrow`, `SectionHead` (the numbered rule), `Chip`, and `ConfidenceMark` |
| `Field` | `Input` / `Textarea` / `Select` / `Label` / `Field` — one `base` string, so every control focuses identically |
| `Modal` | Escape-to-close, scroll-contained body, optional footer |
| `Spinner` | — |

`ConfidenceMark` is the one bespoke primitive: a three-bar meter rendered next to every claim, so a
low-confidence guess can never look like a finding.

## Feature components

| Component | Role |
|---|---|
| `DateRail` | Left rail — people list, inline add, stage/turn-count/last-updated summary |
| `ProfileModal` | The seed context: name, stage, meta, what you know about them, research notes (auto-filled by "What do I say?", with a `Clear` button riding in the field's hint slot), you in this one, what you want. Placeholders do real work here — they're the instructions for writing a useful seed. The draft is seeded on open only, so `save` omits `researchNotes` from the patch unless the user touched it — otherwise saving the profile would roll back notes a run merged in while the modal was open. "Touched" is a `notesDirty` ref set by `setNotes`, which every edit path routes through, **not** a comparison against the opening value: a user who edits and then deliberately reverts is not untouched, and inferring it from equality silently dropped the revert. |
| `ConversationPanel` | Turn list (numbered, side-aligned, hover edit/delete), composer that auto-flips speaker after each add, `EditTurnModal`, and `ImportModal` with a live parse preview |
| `ContextView` | `PersonContextView` and `SelfContextView`. Shared `Block` / `ClaimList` / `Bullets` / `HonestNote` internals. |
| `SuggestionView` | The read, the priority callout, option cards with a copyable draft, `avoid`, `timing`, and the honest note on an inverted panel |
| `SettingsModal` | LLM profiles, backend switch, BYOK presets, Qwen model + device refresh, the web-research toggle (`tools_enabled`), house rules |
| `FeedbackThread` | The insight column's footer, one per tab: the notes already in play (× to drop one) plus a box whose button both appends the note and re-runs that engine. Keyed on `date:tab` in `App.tsx`, so the draft never follows you to another tab or person. The thread only grows and the footer steals height from the analysis above it, so the list collapses to a one-line count (open by default up to 2 notes) and the open list is capped at `max-h-[124px]` with its own scroll — footer height is flat regardless of note count. |

## `App.tsx`

Three columns: rail | conversation | insight. The three actions live in the header; each switches
the insight tab and runs. The insight column's tab strip has its own re-run button — which becomes a
**Stop** button whenever *any* run is in flight, this tab's or another profile's, since it's the only
way to cancel — so a tab can be refreshed without leaving it.

State worth knowing about:

- `busy` is a single run at a time — every button that *starts* work disables while any is running,
  with the tab strip's Stop the one control left live, since it's the only way out — but it carries the
  *date id* alongside the tab, and only `busyTab` (the id matching `activeId`) renders as thinking. A
  run keeps going when you switch people, and writes to the id captured when it started; it just
  doesn't make the profile you switched to look like it's loading.
- `runningRef` is the actual mutex, not `busy`. State lands on the next render, so two calls in the
  same tick — a fast double-click, or Enter held down on the situation field — both read `busy` as
  null and both start. When that happened, the second aborted the first, and the *first*'s `finally`
  cleared `busy` while the second was still running: spinner gone, buttons live, a third run one
  click away. A ref is set synchronously, so it can't happen.
- `error` is tagged the same way, so a failure shows only on the panel and person that caused it.
- `abortRef` holds the in-flight controller, and the tab strip's Stop button is what reaches it.
  Without that button the whole abort chain — the `AbortSignal` threaded through `postJSON`/`postSSE`,
  `QWEN_CHAT_CANCEL` back to the controller the background holds, `abortableDelay` collapsing the
  anti-bot back-off — was unreachable, and a Qwen throttle (three 30s waits) had no exit but closing
  the tab.
- `activity` and `thinking` are the two live-progress feeds, and a run can have both. `activity`
  accumulates one line per tool call, so it only appears on the keyed backends that run tools;
  `thinking` is the model's reasoning summary — Qwen always, Anthropic when `anthropic_thinking` is
  on — replaced wholesale on each event. On Anthropic both arrive at once, so `Thinking` picks:
  `activity` wins the struck-through step list and `thinking.titles` is the fallback, while the
  newest `thinking.thoughts` paragraph renders below either way, clamped to four lines so a
  streaming think can't shove the page around. Both reset at the top of `run`.
- `run(tab, note?)` appends `note` to that tab's `feedback` thread *before* the call, so the run sees
  it and a network failure doesn't eat what the user typed.
- **Writes derived from a pre-call snapshot go through `update`'s function form.** A model call takes
  half a minute, and the user can edit the profile or delete a suggestion while it runs — a patch
  built from the snapshot `run` started with silently reverts them. `suggestMove`'s write was doing
  exactly that to `researchNotes`, which is the one field both the model and the user write.
- `ConversationPanel` is keyed on `active.id`: its drafts and import box are per-person, and a key is
  cheaper than lifting five pieces of draft state into `App`.
- `isStale` compares the record's `turnsUpdatedAt` against the context's `turnsAt` — two turn-stamps,
  so only a transcript edit trips the "conversation has moved on" chip. See
  [architecture.md](architecture.md#freshness) for why `updatedAt` couldn't carry this.
- `Freshness` (the "Rebuilt/Suggested Xh ago" bar above a context) takes an optional `onClear` (plus
  `label`/`clearLabel` to match the wording to what's being deleted) — wired up on all three tabs:
  Them/You call it with no args beyond the default ("Rebuilt" / "Delete this rebuild"), clearing
  `themContext`/`meContext` back to `undefined`. The `next` tab passes `label="Suggested"` and
  deletes only the *currently-viewed* suggestion — `active.suggestions.filter(s => s.id !==
  suggestion.id)`, then falls back to whatever's now first (or the blank slate if that was the last
  one). Deliberately per-item, not bulk: switch to the one you want gone via the history pills, then
  delete just that one. Exists so replacing the whole conversation doesn't leave stale prior reads
  or suggestions from a different conversation still sitting around.

## `hooks/useDates.ts`

Loads every record once, keeps a `datesRef` mirror, and writes each mutation straight through to
IndexedDB. The mirror exists because reading state inside a `setState` updater and assigning out of
it isn't safe under StrictMode's double-invocation — every mutation needs the current record to
merge into.

**Order is an invariant, not a coincidence.** `listDates()` reads through the `by-updated` index
newest-first, `create()` prepends, and `update()` moves the touched record to the front — the rail
renders `dates` as given, so all three paths have to agree or the visible order drifts from what a
reload produces. `update()` was replacing in place, which left a record showing "just now" from
below people last touched days ago until you reloaded. It moves to the front rather than re-sorting:
the written record's `updatedAt` is `Date.now()`, so it *is* the newest, and a defensive sort would
hide a broken invariant instead of keeping one.
