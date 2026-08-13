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
| `DateRail` | Left rail — people list, inline add, stage/turn-count/last-updated summary. A row with a run in flight shows a spinner and "thinking…" in place of that summary: runs are per-person and lock nobody else, so a rebuild started and switched away from has nothing else on screen saying it exists |
| `ProfileModal` | Name, stage, meta, research notes (auto-filled by "What do I say?", with a `Clear` button riding in the field's hint slot), and what you want from this. **Birthday, not age** — a `type="date"` input storing ISO: this record is read on every call for months, so a number typed once is wrong by the time it matters, and `lib/birthday.ts` derives the age (and "it's in nine days") at request time instead. Setting one clears the legacy `age`, which is the only thing that ever does; until then the hint shows what's still stored. It used to hold the two seed blobs as well; those are gone — what the user knows is entered in the conversation as `NOTE` entries, so this modal is now identity and intent only. The draft is seeded on open only, so `save` omits `researchNotes` from the patch unless the user touched it — otherwise saving the profile would roll back notes a run merged in while the modal was open. "Touched" is a `notesDirty` ref set by `setNotes`, which every edit path routes through, **not** a comparison against the opening value: a user who edits and then deliberately reverts is not untouched, and inferring it from equality silently dropped the revert. |
| `ConversationPanel` | Turn list (side-aligned, hover edit/delete), composer, and a gutter carrying **`turn.number`** — the same number `formatTurn` cites into the prompt, so a `[14]` in a profile is findable here. It was `hiddenCount + i + 1`, which agreed with the prompt only because the prompt was equally positional: both re-aimed together the instant a turn was inserted above. The column is in **allocation order, not transcript order** — 60, 62, 61 down the page is correct, and tidying it into sequence would mean renumbering stored citations. No positional fallback: every path into `record.turns` numbers them, and a guessed number would sit beside citations the coach wrote and disagree with them, so an empty cell is the honest failure. Also `EditTurnModal`, and `ImportModal` with a live parse preview. After an add the composer clears the text, the per-turn note **and the `when` field** — that timestamp described the message just added, and leaving it filled meant the next turn silently inherited it. The speaker deliberately **stays put**: it used to flip on the theory that conversations alternate, but people send three messages in a row and then read four back, so the flip was wrong about as often as it was right — and a wrong speaker is worse than an unset one, because it's silent and it puts words in the other person's mouth in the one list this app treats as fact. The composer's third option, **NOTE**, adds a `context` turn — something known that nobody typed. It renders centred and dashed rather than as a bubble from either side, because a note that looked like a message would be read back as one, and it drops the channel and per-turn-note fields (they describe how something was *said*). A hover-revealed row of `+ BARA` / `+ ME` / `+ NOTE` pills sits in the gap above every line and inserts *before* it, so anything missed can land where it happened rather than only at the end — the composer covers the end. All three speakers rather than NOTE alone: inserting a missed message was always possible via NOTE-then-change-the-who, but that's a modal round trip to correct something the thread can just offer. They open the same `EditTurnModal` with `isNew`, and pointer-events are gated on hover for the same reason the edit/delete controls are: invisible isn't gone. **`coach` turns** are the fourth kind and can't be composed — they're written by a `suggestMove` run. Centred like a note for the same reason, but rendered as a *button*: the bubble is the two-line summary and clicking it opens the full suggestion in the insight panel (switching tab, because a click that visibly changes nothing reads as a dead control). Not editable — it records what was said to the user, and rewriting it would leave the panel showing drafts the summary no longer describes. Delete still works, and takes the suggestion with it, since they were never two things |
| `ContextView` | `PersonContextView` and `SelfContextView` — three blocks each now, not nine: the headline, the structured judgment, and the profile as prose via `ProfileBody`. Nothing here knows what sections a profile contains, which was the point: a section the model decided this connection needed used to have nowhere to render, and therefore nowhere to be written down. Shared `Block` / `Bullets` / `HonestNote` internals, plus `OpenQuestions` — the judgment's `open_questions`, each answerable inline via an optional `answer` prop. The answer becomes a `context` turn carrying the question, so the model gets the pairing and the user gets a much lower bar than a blank box. Answered questions are filtered out by looking for a turn whose `asked` matches, so no separate 'done' state exists to drift. |
| `AskComposer` | **The footer, on all three tabs** — one box, one-shot, in the same place. `next` sends the situation and runs. Them/You have two modes: with a profile, an instruction that amends it; **before the first rebuild, it seeds that rebuild** with whatever the user pasted in — it used to be disabled there, a dead control in the one place a new user looks to say who these two people are. One component because all of them are now the same interaction; the differences are copy plus two optional extras. `needsText` is the "this tab needs text" marker — `next` runs on an empty box, since "what do I say?" is a complete request. `onSend` resolves false when the run failed and the box keeps what was typed: `next`'s note used to be written to storage before the call for exactly that reason, and nothing persists it now. `EditResult` shows an amendment's reply once, with the headings it changed, then dismisses. App keys it on person **and tab and mode** — the two Them/You modes are the same component in the same slot, so without the mode React carried a half-typed amendment into the seed box that Start over had just switched on. Replaced `ProfileChat` and `FeedbackThread` |
| `MindModal` | **The coach, editable** — its identity, its whole playbook, and what it has learned. Section list on the left, one raw-markdown box on the right, plus `MindButton` for the header. One section at a time because the document is ~5k tokens and a box that long is one nobody scrolls to the bottom of; the list doubles as the only honest picture of what each engine actually receives, since every row says which calls its section is sent to. The heading stays *out* of the box — it's the section's address, and an editable copy would let a typo silently detach a section from the engine that reads it. Raw markdown with no rendered-view toggle, on purpose: this is the document the user is meant to argue with. Per-section `Revert to shipped` — which also un-forks, so that section resumes taking releases — and a `Reset beliefs` (`resetBeliefs` in `mind.ts`) that restores every shipped section and **keeps exactly two kinds**: "What you've learned", and any section the user added themselves. Neither has a shipped version to be restored *to* — the learned section's seed is the empty placeholder and a user's own section was never in the seed at all — so resetting either would be deletion wearing a restore's label, with nothing else to recover it from. Everything else goes back to what shipped, including the coach's own amendments to belief sections. The confirmation names both survivors. Loaded on open rather than held in App state, because a next-move run rewrites it underneath the UI. Closing with unsaved edits asks first — nothing here is written until Save. The box writes through `writeMindSection`, not `applyProfileUpdate`: the model's contract drops a `replace` carrying nothing, on the grounds that an empty amendment is a failed generation, which left a section impossible to clear. It is also **uncontrolled**, keyed on section and document revision — round-tripping every keystroke through a parsed document trims, so a trailing newline was deleted as fast as it was typed and Enter at the end of a section did nothing |
| `Markdown` | Renders the markdown the coach actually writes, and nothing else: `## headings`, bullets, **numbered lists**, short paragraphs, `**bold**`. A CommonMark parser would be hundreds of kilobytes to handle link reference definitions that will never appear. Anything unrecognised falls through as plain text rather than vanishing — a fact the user is relying on must never be silently swallowed by a parser. No `dangerouslySetInnerHTML` anywhere, so markup inside a profile renders as the characters it is. A trailing `(high\|medium\|low)` on a bullet is lifted out into a `ConfidenceMark`, bound to the preceding text so it can't wrap onto a line of its own, and keeping any turn citation that follows it. Ordered items (`1.` / `2)`, three digits at most so a paragraph opening "2026." stays a paragraph) keep the number the model wrote rather than being recounted, so the render always agrees with the markdown behind it; a run of `-` and a run of `1.` are separate lists. Without this an ordered list fell through to the paragraph branch and every item was joined into one run-on line — the models write them often enough that it was the most visible thing wrong with a profile. |
| `SuggestionView` | The read, the priority callout, option cards with a copyable draft, `avoid`, `timing`, and the honest note on an inverted panel. Message options also carry **"I sent this"**, which appends the draft to the conversation as a turn of the user's — the other half of putting advice in the pool, and free, since entering what you sent was a manual step right after copying it anyway. Whether an option is sent is *derived*, not flagged: a draft is sent when some turn of the user's holds that exact text, which survives a reload and can't drift from the transcript. Edit the wording before sending and it won't match, which is correct — what's in the pool is then not the draft. Messages only; an action isn't sendable text and doesn't belong in the transcript as a message |
| `ExportModal` | **The whole record as one markdown document**, to keep or paste elsewhere — `lib/export-markdown.ts` builds it, this shows it, and `ExportButton` opens it from the header. It shows the text rather than just offering two buttons, which is why the modal exists at all: this is everything the app knows about a person, about to leave it, and seeing it is what makes handing it to another chat a decision rather than a guess. Read-only, because the document is derived and an edit here would have nowhere to go. Built on render rather than held in state — a rebuild replaces `record` wholesale, and a copy taken on open would quietly hand over the version from before it landed. Copy reuses the clipboard pattern from `SuggestionView` (a rejection when the document isn't focused says nothing: the text is on screen to select by hand); Download is an `<a download>` on a blob URL, revoked on the next tick because the click is synchronous and the browser's read of the blob behind it isn't. Unkeyed, unlike `ProfileModal` — it holds no draft, so a rail switch underneath it just re-derives the document for whoever is selected |
| `SettingsModal` | LLM profiles, backend switch, BYOK presets, Qwen model + device refresh, the web-research toggle (`tools_enabled`), house rules |

## `App.tsx`

Three columns: rail | conversation | insight. The three actions live in the header; each switches
the insight tab and runs. The insight column's tab strip has its own re-run button — which becomes a
**Stop** button while this person has a run in flight, on any of their tabs, since it's the only way
to cancel — so a tab can be refreshed without leaving it.

State worth knowing about:

- **A run belongs to one person, and so does everything it owns.** `runs`, `errors`, `activity` and
  `thinking` are all `Record<dateId, …>`, and `busyTab` / `shownError` read only `activeId`'s entry.
  One run *per person*, several people at once: two profiles share nothing but the backend, so a
  single global slot meant a rebuild on Mira disabled every control on Sam. The maps would have to be
  keyed regardless — one `thinking` would be overwritten by whichever profile streamed last, and
  switching to the other one would show its thoughts.
- `runsRef` (a `Map<dateId, AbortController>`) is the actual mutex, not `runs`, and holds the abort
  handles. State lands on the next render, so two calls in the same tick — a fast double-click, or
  Enter held down on the situation field — both read the slot as free and both start. When that
  happened, the second aborted the first, and the *first*'s `finally` cleared the slot while the
  second was still running: spinner gone, buttons live, a third run one click away. A ref is set
  synchronously, so it can't. `claim(id, tab)` takes the slot or returns null; `release(id)` gives it
  back in `finally`.
- The tab strip's Stop reaches `runsRef.get(id)`. Without it the whole abort chain — the
  `AbortSignal` threaded through `postJSON`/`postSSE`, `QWEN_CHAT_CANCEL` back to the controller the
  background holds, `abortableDelay` collapsing the anti-bot back-off — is unreachable, and a Qwen
  throttle (three 30s waits) has no exit but closing the tab. It stops **this** person only; someone
  else's is stopped from their own panel, which is now live. Deleting a record calls it first, or the
  run outlives the person and returns to write a profile onto nobody.
- **`DateRail` shows who is running.** With other profiles no longer locked, a run you started and
  switched away from has nothing else on screen saying it exists; the row is where it shows and the
  way back to the panel that can stop it.
- `panelRef` exists to reset the insight column's scroll to the top on every tab and person change.
  The three tabs share one scroll container, so React kept its offset across a switch: leaving Them
  halfway down dropped you into the middle of option three on Next move. `useLayoutEffect`, not
  `useEffect` — the wrong position would otherwise be visible for a frame.
- `activity` and `thinking` are the two live-progress feeds, and a run can have both. `activity`
  accumulates one line per tool call, so it only appears on the keyed backends that run tools;
  `thinking` is the model's reasoning summary — Qwen always, Anthropic when `anthropic_thinking` is
  on — replaced wholesale on each event. On Anthropic both arrive at once, so `Thinking` picks:
  `activity` wins the struck-through step list and `thinking.titles` is the fallback, while the
  newest `thinking.thoughts` paragraph renders below either way, in `ThinkingStream`. Nothing caps
  the reasoning anywhere else — `joinThinking` accumulates every delta and `thinking` is sent as
  `{type: 'adaptive'}` with no token budget — so that paragraph *is* the whole Anthropic summary.
  It used to be clamped to four lines, which held the layout still by hiding every think worth
  reading; it now has its own max-height scroll box that follows the stream while the reader is at
  the bottom and stops following the moment they scroll back. `claim` clears both feeds for that
  person, along with their last error — all three described something no longer happening.
- `run(tab, message?)` and `sendChat` both **return whether they succeeded**, so `AskComposer` can
  keep what was typed when a run fails. An abort counts as success — the user stopped it on purpose,
  and handing their text back as if the app had broken is just noise.
- `viewingAdvice` holds which `coach` turn each `next` panel is showing, keyed by person like the
  run maps; no entry means that person's newest, so a run doesn't have to reach back and clear it
  and a first visit lands on their latest. Keyed rather than a single slot because a next-move run
  finishing on one person wrote it: reading an older suggestion of someone else's, you were jumped
  to their newest by a run you weren't watching. Switching people no longer resets it either — the
  selection is theirs. The advice history *is* the conversation — no parallel list, no cap, no pills.
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
  deletes only the *currently-viewed* suggestion — which is now one delete, not two, because the
  advice and its `coach` turn are one object: `turns.filter(t => t.id !== shownAdvice.id)`, with
  `{ evidence: false }` since removing the coach's own line doesn't change what either person said.
  Earlier advice isn't reached by history pills any more; it's in the conversation, in the position it
  was given. Deliberately per-item, not bulk: open the COACH bubble you want gone and delete that one.

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
