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
| `ProfileModal` | The seed context: name, stage, meta, what you know about them, research notes (auto-filled by "What do I say?", with a `Clear` button riding in the field's hint slot), you in this one, what you want. Placeholders do real work here — they're the instructions for writing a useful seed. |
| `ConversationPanel` | Turn list (numbered, side-aligned, hover edit/delete), composer that auto-flips speaker after each add, `EditTurnModal`, and `ImportModal` with a live parse preview |
| `ContextView` | `PersonContextView` and `SelfContextView`. Shared `Block` / `ClaimList` / `Bullets` / `HonestNote` internals. |
| `SuggestionView` | The read, the priority callout, option cards with a copyable draft, `avoid`, `timing`, and the honest note on an inverted panel |
| `SettingsModal` | LLM profiles, backend switch, BYOK presets, Qwen model + device refresh, the web-research toggle (`tools_enabled`), house rules |
| `FeedbackThread` | The insight column's footer, one per tab: the notes already in play (× to drop one) plus a box whose button both appends the note and re-runs that engine. Keyed on `date:tab` in `App.tsx`, so the draft never follows you to another tab or person. The thread only grows and the footer steals height from the analysis above it, so the list collapses to a one-line count (open by default up to 2 notes) and the open list is capped at `max-h-[124px]` with its own scroll — footer height is flat regardless of note count. |

## `App.tsx`

Three columns: rail | conversation | insight. The three actions live in the header; each switches
the insight tab and runs. The insight column's tab strip has its own re-run button, so a tab can be
refreshed without leaving it.

State worth knowing about:

- `busy` is a single run at a time — every button disables while any is running — but it carries the
  *date id* alongside the tab, and only `busyTab` (the id matching `activeId`) renders as thinking. A
  run keeps going when you switch people, and writes to the id captured when it started; it just
  doesn't make the profile you switched to look like it's loading.
- `error` is tagged the same way, so a failure shows only on the panel and person that caused it.
- `abortRef` holds the in-flight controller; starting a new action aborts the previous one.
- `activity` and `thinking` are the two live-progress feeds, and they're mutually exclusive by
  backend: `activity` accumulates one line per tool call (keyed backends), `thinking` is Qwen's
  reasoning summary, replaced wholesale on each event. `Thinking` renders whichever it has as the
  same struck-through step list, plus the newest summary paragraph clamped to four lines so a
  streaming think can't shove the page around. Both reset at the top of `run`.
- `run(tab, note?)` appends `note` to that tab's `feedback` thread *before* the call, so the run sees
  it and a network failure doesn't eat what the user typed.
- `ConversationPanel` is keyed on `active.id`: its drafts and import box are per-person, and a key is
  cheaper than lifting five pieces of draft state into `App`.
- `isStale` compares the record's `updatedAt` against a context's `generatedAt` to show the
  "conversation has moved on" chip.
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
