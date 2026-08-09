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
| `Select` | Styled stand-in for `<select>`, since a native dropdown can't be restyled past a point. The list **decides its own direction and height on open**: `clipBounds` walks up for the nearest ancestors that don't have `overflow: visible` and intersects them with the viewport, because the viewport alone is the wrong limit — this control appears in the conversation composer, pinned to the bottom of an `overflow-hidden` app shell, and inside a modal body that scrolls at `max-h-[70vh]`, and both clip an absolutely-positioned child. It flips up only when the list's *measured* height doesn't fit below and there is more room above; comparing against the 256px cap instead made three options flip any time the control sat near the bottom, moving the list away from where the eye already was |
| `Modal` | Escape-to-close, scroll-contained body, optional footer |
| `Spinner` | — |

`ConfidenceMark` is the one bespoke primitive: a three-bar meter rendered next to every claim, so a
low-confidence guess can never look like a finding.

## Feature components

| Component | Role |
|---|---|
| `DateRail` | Left rail — people list, inline add, stage/turn-count/last-updated summary |
| `ProfileModal` | Name, stage, meta, research notes (auto-filled by "What do I say?", with a `Clear` button riding in the field's hint slot), and what you want from this. **Birthday, not age** — a `type="date"` input storing ISO: this record is read on every call for months, so a number typed once is wrong by the time it matters, and `lib/birthday.ts` derives the age (and "it's in nine days") at request time instead. Setting one clears the legacy `age`, which is the only thing that ever does; until then the hint shows what's still stored. It used to hold the two seed blobs as well; those are gone — what the user knows is entered in the conversation as `NOTE` entries, so this modal is now identity and intent only. The draft is seeded on open only, so `save` omits `researchNotes` from the patch unless the user touched it — otherwise saving the profile would roll back notes a run merged in while the modal was open. "Touched" is a `notesDirty` ref set by `setNotes`, which every edit path routes through, **not** a comparison against the opening value: a user who edits and then deliberately reverts is not untouched, and inferring it from equality silently dropped the revert. |
| `ConversationPanel` | Turn list (numbered, side-aligned, hover edit/delete), composer, `EditTurnModal`, and `ImportModal` with a live parse preview. After an add the composer clears the text, the per-turn note **and the `when` field** — that timestamp described the message just added, and leaving it filled meant the next turn silently inherited it. The speaker deliberately **stays put**: it used to flip on the theory that conversations alternate, but people send three messages in a row and then read four back, so the flip was wrong about as often as it was right — and a wrong speaker is worse than an unset one, because it's silent and it puts words in the other person's mouth in the one list this app treats as fact. The composer's third option, **NOTE**, adds a `context` turn — something known that nobody typed. It renders centred and dashed rather than as a bubble from either side, because a note that looked like a message would be read back as one, and it drops the channel and per-turn-note fields (they describe how something was *said*). A hover-revealed row of `+ BARA` / `+ ME` / `+ NOTE` pills sits in the gap above every line and inserts *before* it, so anything missed can land where it happened rather than only at the end — the composer covers the end. All three speakers rather than NOTE alone: inserting a missed message was always possible via NOTE-then-change-the-who, but that's a modal round trip to correct something the thread can just offer. They open the same `EditTurnModal` with `isNew`, and pointer-events are gated on hover for the same reason the edit/delete controls are: invisible isn't gone. **`coach` turns** are the fourth kind and can't be composed — they're written by a `suggestMove` run. Centred like a note for the same reason, but rendered as a *button*: the bubble is the two-line summary and clicking it opens the full suggestion in the insight panel (switching tab, because a click that visibly changes nothing reads as a dead control). Not editable — it records what was said to the user, and rewriting it would leave the panel showing drafts the summary no longer describes. Delete still works, and takes the suggestion with it, since they were never two things |
| `ContextView` | `PersonContextView` and `SelfContextView` — three blocks each now, not nine: the headline, the structured judgment, and the profile as prose via `ProfileBody`. Nothing here knows what sections a profile contains, which was the point: a section the model decided this connection needed used to have nowhere to render, and therefore nowhere to be written down. Shared `Block` / `Bullets` / `HonestNote` internals, plus `OpenQuestions` — the judgment's `open_questions`, each answerable inline via an optional `answer` prop. The answer becomes a `context` turn carrying the question, so the model gets the pairing and the user gets a much lower bar than a blank box. Answered questions are filtered out by looking for a turn whose `asked` matches, so no separate 'done' state exists to drift. |
| `AskComposer` | **The footer, on all three tabs** — one box, one-shot, in the same place. Them/You send an instruction to amend the profile; `next` sends the situation and runs. One component because all three are now the same interaction; the differences are copy plus two optional extras. `blocked` is Them/You before the first rebuild (nothing to amend, and a reply would answer from the transcript and throw its amendment away) and doubles as the "this tab needs text" marker — `next` runs on an empty box, since "what do I say?" is a complete request. `onSend` resolves false when the run failed and the box keeps what was typed: `next`'s note used to be written to storage before the call for exactly that reason, and nothing persists it now. `EditResult` shows an amendment's reply once, with the headings it changed, then dismisses. Replaced `ProfileChat` and `FeedbackThread` |
| `MindModal` | **The coach, editable** — its identity, its whole playbook, and what it has learned. Section list on the left, one raw-markdown box on the right, plus `MindButton` for the header. One section at a time because the document is ~5k tokens and a box that long is one nobody scrolls to the bottom of; the list doubles as the only honest picture of what each engine actually receives, since every row says which calls its section is sent to. The heading stays *out* of the box — it's the section's address, and an editable copy would let a typo silently detach a section from the engine that reads it. Raw markdown with no rendered-view toggle, on purpose: this is the document the user is meant to argue with. Per-section `Revert to shipped` and a whole-document `Reset all`. Loaded on open rather than held in App state, because a next-move run rewrites it underneath the UI |
| `Markdown` | Renders the markdown the coach actually writes, and nothing else: `## headings`, bullets, **numbered lists**, short paragraphs, `**bold**`. A CommonMark parser would be hundreds of kilobytes to handle link reference definitions that will never appear. Anything unrecognised falls through as plain text rather than vanishing — a fact the user is relying on must never be silently swallowed by a parser. No `dangerouslySetInnerHTML` anywhere, so markup inside a profile renders as the characters it is. A trailing `(high\|medium\|low)` on a bullet is lifted out into a `ConfidenceMark`, bound to the preceding text so it can't wrap onto a line of its own, and keeping any turn citation that follows it. Ordered items (`1.` / `2)`, three digits at most so a paragraph opening "2026." stays a paragraph) keep the number the model wrote rather than being recounted, so the render always agrees with the markdown behind it; a run of `-` and a run of `1.` are separate lists. Without this an ordered list fell through to the paragraph branch and every item was joined into one run-on line — the models write them often enough that it was the most visible thing wrong with a profile. |
| `SuggestionView` | The read, the priority callout, option cards with a copyable draft, `avoid`, `timing`, and the honest note on an inverted panel. Message options also carry **"I sent this"**, which appends the draft to the conversation as a turn of the user's — the other half of putting advice in the pool, and free, since entering what you sent was a manual step right after copying it anyway. Whether an option is sent is *derived*, not flagged: a draft is sent when some turn of the user's holds that exact text, which survives a reload and can't drift from the transcript. Edit the wording before sending and it won't match, which is correct — what's in the pool is then not the draft. Messages only; an action isn't sendable text and doesn't belong in the transcript as a message |
| `SettingsModal` | LLM profiles, backend switch, BYOK presets, Qwen model + device refresh, the web-research toggle (`tools_enabled`), house rules |

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
- `panelRef` exists to reset the insight column's scroll to the top on every tab and person change.
  The three tabs share one scroll container, so React kept its offset across a switch: leaving Them
  halfway down dropped you into the middle of option three on Next move. `useLayoutEffect`, not
  `useEffect` — the wrong position would otherwise be visible for a frame.
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
- `run(tab, message?)` and `sendChat` both **return whether they succeeded**, so `AskComposer` can
  keep what was typed when a run fails. An abort counts as success — the user stopped it on purpose,
  and handing their text back as if the app had broken is just noise.
- `viewingAdvice` holds which `coach` turn the `next` panel is showing; null means the newest, so a
  new run doesn't have to reach back and clear it and switching people lands on their latest. The
  advice history *is* the conversation — no parallel list, no cap, no pills.
- `sentDrafts` is derived per render from the turns, like `answered`. See `SuggestionView`.
- **Writes derived from a pre-call snapshot go through `update`'s function form.** A model call takes
  half a minute, and the user can edit the profile or delete a suggestion while it runs — a patch
  built from the snapshot `run` started with silently reverts them. `suggestMove`'s write was doing
  exactly that to `researchNotes`, which is the one field both the model and the user write.
- `ConversationPanel` is keyed on `active.id`: its drafts and import box are per-person, and a key is
  cheaper than lifting five pieces of draft state into `App`.
- `staleness(record, profile)` returns `fresh` / `judgment` / `stale`, comparing `turnsUpdatedAt`
  against two basis stamps — `amendedTurnsAt` for the prose, `turnsAt` for the judgment. Both sides
  are turn-stamps, so only a transcript edit can trip either. The middle state exists because an
  amendment reads every turn but regenerates none of the judgment: without it, correcting a profile
  from the newest messages still left the panel saying "conversation has moved on". See
  [architecture.md](architecture.md#freshness) for why `updatedAt` couldn't carry any of this.
- `Freshness` (the "Rebuilt/Suggested Xh ago" bar above a context) takes an optional `onClear` (plus
  `label`/`clearLabel` to match the wording to what's being deleted) — wired up on all three tabs:
  Them/You call it with no args beyond the default ("Rebuilt" / "Delete this rebuild"), clearing
  `themProfile`/`meProfile` back to `undefined`. That is a bigger action than it was under the old
  regenerate-every-time model — it discards accumulated notes rather than a cache — so it doubles as
  the deliberate "start over from a blank page", and the confirm copy says so. The `next` tab passes `label="Suggested"` and
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
