# The Coach

Three engines, one shape: build messages → one LLM call → parse → validate → retry once → store.
The two rebuild engines never deviate from that — no tool loop, no multi-stage pipeline. `suggestMove`
is the one exception: on the keyed backends (`openai`, `anthropic`) it can run a bounded tool-calling
loop (web search + read page) before producing its answer — see [lib.md](lib.md#agentts--tools) for
the mechanics.

## `knowledge.ts`

**The seed, not the live text.** Everything here is assembled by [`mind.ts`](#mindts) into one
markdown document — the coach — which is what actually reaches a prompt and which both the user and
the coach can rewrite. Once either has, this file stops being read for that installation. Editing it
still matters: it is what every new installation starts from, and what "revert to shipped" restores.

Each export is exactly one `##` section of that document, which is why the headings are what they
are — they're the addresses an amendment aims at. Split so each engine only pays for what it uses:

| Module | Used by | Contents |
|---|---|---|
| `KB_IDENTITY` | every engine | Who the coach is: voice, nerve, who the advice is for, and the one line that never bends |
| `KB_EVIDENCE` | both rebuilders | Inference discipline: separate observation from inference, confidence is part of the claim, one message is never a pattern, prefer the boring explanation, unknowns are output |
| `KB_READ_THEM` | rebuild-them | Attachment markers (as hypotheses), Big Five over MBTI/love-languages, bids for connection, honest interest signals ranked by diagnostic value, red/amber/green flags |
| `KB_READ_ME` | rebuild-you | Responsiveness quality, bid response rate, investment asymmetry, interview mode, disclosure level, voice, stated vs revealed goals |
| `KB_MOVES` | suggest | Attraction before rapport (lead, don't over-agree, escalate, flirt) and attention-as-the-product; then the PPR recipe (understanding → validation → caring → then your own) scoped to replying rather than billed as universal; the depth ladder, cheap well-evidenced wins, texting pragmatics, set pieces (asking out, exclusivity, repair, taking a no, ending it), calibration rules, and what early ambiguity actually means |
| `KB_RESEARCH` | suggest, only when tools are attached | Three lanes: what they've said about themselves, whether it holds up, and the logistics of the move. Search what would change the advice, as many times as that needs — but not for its own sake, and with the query built from the thread's current state, or it looks up a venue in the city they left four turns ago. Bounded by where it starts — outward from what the person disclosed, not a sweep for everything findable about them, which is the one scope limit any section carries. Check `<research_notes>` before searching again |

**Who the advice is for**, because it decides what a good answer is. The user almost always already
knows the other person is keener, or less keen, or unreadable — that is *why* they opened the app. An
answer whose substance is "they may not be that interested" hands back the premise and helps with
nothing. The module used to produce exactly that: a calibration line about one-sided interest, an
instruction to make "let this one go" one of the options, and an `interest_read` scale with no honest
slot for a young thread all fired at once on a four-message transcript. The default now leans toward
making the connection work, `too-early` exists as a first-class read, and the low-interest call has
to be earned by a sustained pattern over a meaningful window. That isn't a house style of optimism —
short, slow and non-initiating replies are the base rate for ordinary early texting, so reading them
as decline is a false positive far more often than it is insight. The floor that doesn't move: an
actual no, a request for space, or an ending is helped to land well and never worked around.

**Register**, corrected for the same reason. The module leaned on couples research — responsiveness,
validation, the depth ladder — which is about sustaining an established bond, and applied it to week
two of a dating-app thread; the output was attentive, agreeable and unattractive. The attraction
findings that were already present but buried now open the module: take the lead, don't agree with
everything, be a bit less available, escalate on purpose, flirt. Performed attention is explicitly
endorsed — nobody is certain in week two and warmth before certainty is how anyone finds out — while
*declarations* (love, a future, exclusivity) are held back, since the other person calibrates to them.
The prohibition that stays is invention, and the argument for it is practical: a shared memory that
never happened dies on the reply, and a persona the user didn't write collapses in person.

**Energy is causal, not reciprocal.** The old "match length and energy" line is gone. Two people
mirroring each other's flatness converge on nothing within a few exchanges, and the dead thread that
results then gets misdiagnosed as lost interest. Match length, never match energy downward, and treat
a flattening thread as something to lift rather than evidence about either person. See the comment
above `KB_MOVES`.

**Editing rule:** edit the module directly — it is the source, not a rendering of one. Two things
to preserve when you do. Keep it written as instructions rather than as a survey: the model needs
the rule a finding implies, not the finding. And keep the exclusions excluded — Dutton & Aron's
misattribution study, MBTI, love languages as a typology, and Gottman's prediction percentages are
absent on purpose, so a well-meaning addition is a regression.

## `prompts.ts`

Every request is ordered **strictly slowest-changing first**, because a cached prefix survives only
if every byte before it is unchanged.

| | Contents | Changes when |
|---|---|---|
| `system` **[cache]** | `IDENTITY` + `KB_EVIDENCE` + **this engine's `<task>`, update instructions, knowledge modules, `OUTPUT_RULES` and shape sketch** + the user's standing instructions | app release / settings edit — *never* per record |
| `user[0]` | `<the_person>` (name, stage, birthday-derived age) + `<the_user>` (the stated goal) | the profile is edited; the age line, yearly |
| `user[1]` **[cache]** | `<profile_of_them>` / `<profile_of_the_user>` — the markdown, injected whole | a rebuild changes the document |
| `user[2…n]` | `<transcript>`, **one segment per turn**, `[cache]` on the last | a turn added, edited, deleted, or a log imported |
| `user[n+1]` | `<research_notes>`, `<right_now>`, `<from_the_user>`, closing instruction | every run |

Three of Anthropic's four breakpoints, one spare. See [lib.md](lib.md) for how the strata reach the
wire.

**The task used to sit below the transcript, and that was wrong by ~5×.** The old layout kept
`system` byte-identical across all three engines so they shared one transcript entry. But the task
and its knowledge base are the largest block in the request (~3.9k of ~7.7k tokens) and never change,
while the transcript is a seventh of it and changes every time a turn is added — so a single new turn
invalidated the entire knowledge base along with it. Measured on a real payload, add-a-turn-then-run
cost 9,478 effective tokens under the old order and 1,874 under the new one. The cross-engine sharing
was real but only paid when several engines ran without the transcript moving, which is much rarer
than adding a turn.

**Why the task lives in `system` rather than a user block.** In a user block under `<the_person>` the
entry would be per-record. In `system` it is identical for a given engine across *every* record and
conversation, so a first call about a brand-new person reads ~4.6k tokens rather than writing them.
`buildSystem` carries the rule this depends on: **nothing record-specific may ever enter it** — one
name in there turns a global entry into a per-record one. The cost accepted is that the output shape
now sits far from the end of the prompt, where format compliance is weakest, which is why the closing
ask names the required top-level fields outright.

**The invariant:** nothing above a `[cache]` mark may change more often than the mark itself, or the
entry gets written and never read. That is why `<research_notes>` lives in the tail despite reading
like material — one researched `suggestMove` rewrites it.

**The coach amending itself invalidates the system entry**, and that is accepted rather than
optimised around. Splitting the document across two positions in the request — the stable playbook
above, the learned part below — would save a cache write by putting the coach's mind in two places.
Amendments are rare by construction: `changed: false` is stated as the expected answer.

**Why the transcript is one segment per turn.** Caching writes an entry *at* a breakpoint but reads by longest
matching prefix, so a cached entry survives only if every byte before it is unchanged. Appending a
block preserves it; rewriting a block does not. As a single segment the transcript was rewritten by
every added turn, so every added turn re-paid for the whole thing. Split per turn, an append leaves
the earlier blocks byte-identical and only the new turn is paid for — and editing an old turn still
correctly invalidates from that turn onward.

The mark sits on the last **turn**, not after `</transcript>`: put it after the closing tag and that
tag lands in the middle of the next request, matching nothing. The tag and the `NOTE` explainer ride
in an uncached segment below it.

- **Turns are numbered** so the model can cite `[4]` rather than paraphrase vaguely. The UI shows
  the same numbers, so a citation is checkable.
- **`NOTE:` lines are the transcript acting as the context pool.** A turn whose speaker is `context`
  (see `Speaker` in `types/date.ts`) is something the user knows that nobody typed — said on a call,
  heard from a friend, simply remembered — sitting at the point it was learned. `contextEntryNote`
  explains that to the model, and only when the record has one, so a record without any produces a
  transcript entry byte-identical to what it was before the feature existed. They're numbered and
  citable like anything else, and explicitly not evidence about how either person writes.
- **`COACH:` lines are the coach's own past advice, in the position it was given.** A `coach` turn
  carries a two-line summary — the priority and the option labels, derived in code by `adviceTurn`,
  never asked of the model — while the whole `Suggestion` rides along in `Turn.advice` for the UI
  and never reaches the prompt. `coachEntryNote` tells the model what to do with the pair: what
  follows a `COACH` line is either one of the drafts, meaning they took it and the reply is evidence
  about whether it worked, or something else, meaning they didn't and the read of their voice was
  off. Both are worth having, and neither costs anything to collect. Two guards ride with it —
  don't repeat a move that already failed in this thread, and *your own advice is not evidence about
  either person*. A run that has just read its own confident advice will otherwise cite itself.
- **Open questions are askable, not just readable.** Both schemas already end a run by naming what
  the engine doesn't know (`open_questions` — 3-6 for them, 2-5 for the user). `ContextView` renders
  each as a button: answer it in a few words and the answer lands in the pool as a `context` turn
  with the question stored on it (`Turn.asked`), rendered into the transcript as
  `[7] NOTE (asked: what does she do for work): product at a fintech`. Two problems fall out at once
  — a three-word reply is self-contained because the question travels with it, and attribution is
  free, since a question about her cannot produce an answer that gets filed under the user. Nothing
  tracks which questions are done: a question is hidden when a turn carries it in `asked`, and the
  list is replaced wholesale on the next rebuild, by which point the answer is in the material.
- **`<research_notes>`** carries `record.researchNotes` — durable facts kept from earlier
  `suggestMove` runs (see `lib/research-notes.ts`) — with an instruction to reuse them instead of
  re-searching. Shown to all three engines, not just `suggestMove`: it's already-vetted factual
  content by the time it lands here, no different from anything else the user could have written
  down as a `NOTE` by hand.
- **`<counts>` is gone, not moved.** It gave raw turn/word/question tallies per side, followed by a
  caveat that the numbers were unreliable because the user may only have entered part of a
  conversation. There was no source for it — no finding says "count the question marks"; it was a
  proxy for investment symmetry that someone invented and then hedged. A disclaimer doesn't stop a
  model anchoring on a number, and what it produced was arithmetic standing in for reading the
  thread, which is right there. `transcriptStats` still backs the count in the UI header, where the
  reader knows what they entered.
- **`<from_the_user>`** is whatever was typed into the footer box on the tab being run — one-shot
  on all three, and the same tag on all three, because it is the same thing. The surrounding prose
  is the point: a fact the user asserts about their own life is taken as true, but what they say
  cannot make the evidence say something it doesn't, and an unsupportable ask goes in the honest
  note instead.
- **`<right_now>`** is the user's local time with the weekday, and it sits last of the standing
  blocks because it is the single most volatile value in the request — above any mark it would
  invalidate the whole prefix, transcript included, on every call. It carries its own caveat:
  `Turn.at` is optional free text and nothing else stamps a turn, so elapsed time is often genuinely
  unknowable, and a model handed "now" without being told that will infer a plausible interval —
  the exact invention `KB_EVIDENCE` forbids everywhere else.
- **`profileBlock(record, engine)`** — the markdown profile(s), injected whole. Engines 1 and 2 get
  the one they are about to amend, framed as *what you are correcting*; engine 3 gets both, framed
  as *the read to work from*. Both framings end the same way: where the newer turns disagree, the
  transcript wins. Absent until the first rebuild, in which case the engine works from the
  transcript alone.
- **`updateInstructions(sections)`** — how a rebuild amends the document; rides in the system block
  with the rest of the task, so it is constant per engine and caches with it. Names the modes, pins the canonical headings, asks for bullets carrying confidence
  and a turn citation, states the ~1,500-word ceiling, and says plainly that `changed: false` is a
  real answer rather than a failure.
- **`buildSystem(task, customPrompt)`** assembles the whole instructional half — identity, inference
  discipline, the engine's task — and appends the user's house rules, scoped to override the style
  preferences in the task but never the non-negotiables. Nothing record-specific may enter it.

### Where user-authored input goes

There is no seed. Everything the user *knows* is in one pool; the only other channel is direction
about an engine's output. The split is by what the input is **about**, not when it was written:

| | Holds | Read by | Shape |
|---|---|---|---|
| `turns` (`them` / `me`) | what was actually said | all three | chronological, numbered, citable |
| `turns` (`context`) | what the user knows that nobody typed | all three, in the same list | same — a `NOTE:` line |
| `turns` (`coach`) | what this app advised, and when | all three, in the same list | same — a `COACH:` line |
| the coach's mind | what transfers to every person | all three, in the system block | markdown, amended by section |
| `goal` | what the user wants out of this | all three, in the first user block | one short field |

The rows are split by what the input is **about**, and that's why it isn't one list. "She works
nights" is a fact about this connection and belongs in the pool, in position. "Stop suggesting bars"
is a preference about the user — put that in the transcript and the rebuild engines read it as
evidence about the person; it belongs in the coach itself. And `goal` is a directive, not a claim the conversation can outdate,
which is why it's the one standing field left.

**There is no standing feedback thread any more.** `feedback: Record<Engine, string[]>` was a
per-engine list, every note re-sent on every later run of that engine. Them and You lost theirs when
amending a profile became a one-shot instruction: its whole effect lands in the profile, so keeping
the instruction too stores the same thing twice and re-sends the copy forever — the objection that
removed the seed blobs. `next` held on longer, because "stop suggesting bars" genuinely is standing
and had nowhere else to go.

It has somewhere now. A preference like that is a fact about the *user*, so it belongs in the
coach's own document, where it applies to everyone they're seeing rather than to whichever record it
happened to be typed under. Old records still carry the field; nothing reads it.

**Why the seed was removed.** `seedThem`/`seedMe` were a second input path doing the job the pool
and the rebuild engines already do: the user was expected to write good prose about each person and
keep it current, and it was re-read on every rebuild forever, from the top of the request. In practice it got a résumé
or a dating-app bio pasted into it once and never revised — poor-quality input in the highest-trust
position, which is the worst possible place for it, and `seedMe` especially, since engine 3 is asked
to write in the user's voice and a CV is the opposite of how anyone texts. What the seed was *for* —
turning rough knowledge into a clean structured read — is precisely what engines 1 and 2 do. So the
raw text became `context` turns and the field disappeared. `migrateSeed` in `lib/db.ts` moves the
text of existing records into the pool on read, so nothing written under the old model is lost.

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

### Amending a profile

`buildChatMessages(record, engine, message, mind, customPrompt)` sends **one instruction**, not a
conversation, and is structurally identical to a rebuild — only the task and the tail differ:

```text
[system ✂][who][profile ✂][turns… ✂][/transcript][research + now + the instruction]
```

It briefly persisted a chat history per profile. That came out again on the observation that an
instruction is a one-shot command: its entire effect lands in the profile, so keeping the instruction
too stores the same information twice and re-sends the redundant copy on every later request — the
same objection that removed the seed blobs, and the one a pasted CV in the transcript still fails.

Removing it took a whole cluster of complexity with it: a fourth cache breakpoint, strict role
alternation, a mark on the last *stored* message rather than the new one, a rule that a user turn
could only be persisted once its reply succeeded, and an unresolved question about whether the
profile belonged above or below the history. None of it has anything left to protect.

The reply is shown once under the composer with the headings it changed, held in component state and
tagged with the record and tab it belongs to, then dismissed.

## `run.ts`

`rebuildPersonContext` and `rebuildSelfContext` are identical in shape: resolve config + house
rules, build messages, call `completeJSON` with the matching validator and schema, then apply the
returned `ProfileUpdate` to the stored markdown. Deliberately never given tools of their own —
they're pure re-reads of material the user already provided (plus whatever's already landed in
`<research_notes>`); only `suggestMove` ever initiates a new search.

`suggestMove` branches on `resolveSuggestionOutput(config)`:

- **Qwen, or `tools_enabled: false`** → the same `completeJSON` path as the rebuild engines.
  Qwen's case is not a preference. Tested against a live session (2026-08-09): send it a `tools`
  array and the field is dropped server-side with no error and no change in `input_tokens`, and the
  model answers in prose *imitating* a call. Nothing throws, and that text would get stored as a
  profile — so `chatCompletionWithTools` now throws outright if a non-empty `tools` array ever
  reaches the `qwen-chat` backend, rather than silently short-circuiting and letting a caller go on
  believing it is getting tool calls.
- **Either keyed backend (`openai` or `anthropic`) with tools on (the default)** → `ALL_TOOLS` (`web_search`, `read_page`) plus
  `buildVerdictSchema(SUGGESTION_SCHEMA)` as the `provide_verdict` channel, run through
  `runAgentWithValidation`. An optional `onActivity` callback fires a human-readable line
  (`"Searching: …"` / `"Reading: …"`) per tool call, which `App.tsx` shows live under the spinner.

Each stamps `generatedAt` and `turnsAt` (the record's `turnsUpdatedAt` as the run saw it — see
[architecture.md](architecture.md#freshness)).

**The no-tools path still has to fill `research_notes`.** `hasTools` flips "Using web research" in
and out of the system block, and that section is the only place the coach is told what that output
field is *for* — so Qwen, which researches natively and gets no tool schemas from us, did the
research and was never asked to keep any of it. The field came back `[]` on the backend most runs
actually use. `KEEP_WHAT_YOU_LOOKED_UP` in `prompts.ts` carries the persist rule on that path only,
in the task rather than in the mind: it's a fact about an output field rather than something the
coach believes, and a new `##` section would be missing from every document already forked from the
seed — which is exactly the installations that need it. The tool-bearing path is left alone, so each
variant stays one constant string and caches on its own.

`suggestMove` also does two things the rebuild engines don't. It appends its answer to the
conversation as a `coach` turn (`adviceTurn` in `lib/transcript.ts`) — see
[architecture.md](architecture.md#the-turn-pool) for why the advice lives there and what it costs.
And it is the only engine that amends **the coach itself**: the returned `mind` update is applied
and saved right here rather than handed back, because the coach isn't a field of any record and
there is no record-merge for a caller to get right. It re-reads storage first — a run takes half a
minute and the user may have edited it by hand in the meantime — and `mindText` resolves the seed on
a first write, so an amendment forks the whole document rather than landing on an empty one.

## Output contracts

| Engine | Returns | Notable fields |
|---|---|---|
| `rebuildPersonContext` | `PersonProfile` | `markdown` (amended, not regenerated) + `judgment`: `interest_read` with `signals_for` / `signals_against` / `honest_note`; `flags`; `open_questions` |
| `rebuildSelfContext` | `SelfProfile` | `markdown` + `judgment`: `goal_read` splitting stated from revealed; `open_questions` |
| `chatAboutProfile` | `{reply, headline, markdown, changed}` | one instruction: prose for the user, an optional `ProfileUpdate` applied to the stored markdown, and a replacement headline when the amendment made the old one wrong (`""` otherwise, the common case) |
| `suggestMove` | `Suggestion` | `options[]` — each a verbatim `draft`, a `why`, a `then` for reading the response, and a risk level; plus `avoid`, `timing`, `honest_note`, `research_notes` (durable findings, merged into the record — see `lib/research-notes.ts`), and `mind` (a `ProfileUpdate` the coach applies **to itself**) |

**An amendment moves the prose, and the headline with it.** `markdown`, `amendedAt`,
`amendedTurnsAt` and — when the amendment made the old one wrong — `judgment.headline`. The rest of
the judgment is left exactly as the last full rebuild produced it. Re-deciding where things *stand*
off the back of one remark is how a read starts drifting, and it is also why the clocks are separate:
the halves of a profile age independently, so one timestamp would have to misdate one of them.
`Rebuild` re-reads the whole transcript and regenerates both.

**The headline is the exception, and it had to be.** It isn't a judgment about the person, it's a
description of the prose — and the prose just changed. Left alone it produced exactly the failure it
was supposed to prevent: a headline reading "you haven't actually spoken to them yet, so there's no
data on how you show up" sitting directly above a corrected section citing nine of the user's own
messages by turn number. The model had written the correction and said so in its reply; it just had
no way to know what it was contradicting, because **the judgment was never in the prompt at all**.
`profileBlock` now injects `<headline_now>` on the amend path only — the rest of the judgment stays
out, since a rebuild regenerates it wholesale and showing it would only anchor the new one to the
old. The shape asks for `""` by default: a headline rewritten on every small correction drifts as
badly as one never rewritten.

**Two turn-stamps, because the halves read the transcript at different times.** `turnsAt` is what the
last rebuild saw, `amendedTurnsAt` what the last amendment saw. With only the first, an amendment
that had just read every turn still left the panel saying "conversation has moved on" — the user
tells it about the new turns, watches it rewrite the profile from them, and is then told the
conversation has moved on. `staleness()` in `App.tsx` returns three states: `stale` (the prose is
behind — rebuild), `judgment` (the prose is current, the interest read and flags aren't — the chip
says "judgment predates these turns"), and `fresh`.

`chatAboutProfile` returns rather than persists, deliberately, and what the caller then keeps is only
the profile. `sendChat` in `App.tsx` writes `markdown`, the two amend stamps and — when the amendment
made the old one wrong — the headline, once the call has succeeded. The instruction and the reply
both stay in component state, shown once under the composer and then gone; a failed call persists
neither. That is the same rule the redesign runs on: the instruction's whole effect is already in the
markdown, so storing it as well would keep the information twice and re-send the copy on every later
request.

**The rebuild engines don't return a profile — they return a diff.** Both emit
`{headline, profile: ProfileUpdate, …judgment}`, and `run.ts` applies the update to the stored
markdown. `changed: false` is a first-class answer and the common one after a single new turn. The
whole apply/validate contract lives in [`coach/profile.ts`](#profilets) with unit tests beside it.

**Why the judgment stayed structured while everything else became prose.** `interest_read`, the
flags and the confidence marks are what make this a read rather than a chatbot summary, and prose
loses them. `open_questions` is the load-bearing one, and for a different reason: it isn't really a
judgment at all, it's the input to a UI feature. Each question is rendered as something answerable
in a few words whose answer becomes a `context` turn carrying its question — which only works if the
questions arrive as a list. The judgment is regenerated whole every rebuild, which is the right
lifecycle for it: a call about where things stand *should* be recomputed from current evidence, and
unlike the prose there is nothing to accumulate.

Confidence survives into the prose. A rebuild writes it into the bullet — `- Landscape architect
(high) [2]` — and `Markdown.tsx` lifts a trailing `(high|medium|low)` back out into the same
three-bar `ConfidenceMark` the old structured view used, keeping any turn citation that follows it.
So a low-confidence guess still never gets to look like a finding.

## `mind.ts`

**The coach is this document.** Not a memory bolted onto a fixed personality: who it is, everything
it believes about reading people and about what to do next, and whatever it has worked out since,
all in one markdown document that both the user and the coach can rewrite. `knowledge.ts` is the
seed it starts from. It lives in `chrome.storage.local` (`dateBroCoachMind`) rather than on a
`DateRecord`, because filing it under one person would mean choosing which record owns a coach that
every record shares, and losing it when that record is deleted.

Empty storage means "still tracking the shipped seed", so an installation nobody has edited keeps
getting knowledge-base improvements from releases. The first write — by the user or by a run — forks
the whole document.

**This started as a layer *over* a shipped playbook**, on the argument that a model rewriting its own
evidence base can degrade every future answer with one bad run. The objection is real and the design
was still wrong twice over. A coach whose playbook can't move stays wrong in the same way forever,
which was the original complaint. And the split put the user's corrections somewhere other than the
thing they were correcting: you edited a note that argued with a document you couldn't see. What the
risk buys instead is that nothing is destroyed silently — the seed is still in the repo, "revert to
shipped" restores any section from it, and amendments are by heading, so a bad edit is one section
wide.

### Sections are slots

Each `##` section is addressable two ways at once, which is the whole trick. `buildSystem` selects
the sections an engine needs, so a rebuild never pays for the 2.4k tokens of the next-move playbook;
`applyProfileUpdate` — the same function that amends a profile — aims an amendment at one by name.

| Section | Sent to | Tokens |
|---|---|---|
| Who you are | every call | ~510 |
| Inference discipline | every call | ~345 |
| Reading the other person | rebuild/amend them | ~980 |
| Reading the user | rebuild/amend you | ~400 |
| Choosing what to say or do | next move | ~1,920 |
| Using web research | next move, tools attached | ~790 |
| What you've learned | every call | starts empty |

Whole document ~4.9k tokens; the heaviest engine (next move with research) sees ~3.6k, a rebuild
~1.8k. A heading the user renames or deletes simply isn't found and that engine goes without it —
deliberately not backfilled from the seed, since the point of an editable coach is that deleting
something deletes it. `missingHeadings` is what tells them, in the editor rather than silently.

Heading matching is `profile.ts`'s `key` on both sides — the same normalisation an amendment is
matched with, so `What you've learned` and `What you’ve learned` can't be one section to the coach
and two to the engine reading it. Renaming a *shipped* heading in `MIND_PARTS` is the one edit to
avoid: there is no rename table here the way there is for profiles, so it detaches the section from
every document already forked from the seed.

### Who writes, and on what evidence

`suggestMove` only, and not for safety — it is the engine that gives advice and, a run later, reads
its own `COACH` line and whatever the user did underneath. It is the only one that ever finds out
whether it was right. Three writers amending one document from different records, unable to see each
other's edits, would also be three ways to lose the same paragraph.

The bar is stated as evidence: a `COACH` line plus what happened under it, twice. Once is a
coincidence. A specific finding about this user goes in "What you've learned"; a playbook section is
amended only when the *rule* was wrong, not when it didn't fit one conversation — and narrowing a
claim is usually what was actually learned, not deleting it. Two things it may not do: write anything
about the person in the current request (that leaks one connection into all of them), and amend away
the line about a real no.

The field is **required in `SUGGESTION_SCHEMA` but optional in `validateSuggestion`**. Providers that
enforce a schema always send it; a backend with none (Qwen) shouldn't burn a whole retry on the one
field whose correct value is empty on most runs. Present-and-malformed still fails, because a
half-formed update would otherwise be applied. It sits *before* `options` in both the shape and the
`required` list — the lesson `open_questions` cost, applied ahead of time.

## `profile.ts`

The memory of a person, as markdown amended by section.

```ts
type SectionUpdate = { heading: string; mode: 'replace' | 'append' | 'delete'; content?: string }
type ProfileUpdate = { changed: boolean; sections?: SectionUpdate[]; rewrite?: string }
```

`applyProfileUpdate(markdown, update)` splits on `##` followed by a space, applies ops in order, and
re-serialises.
Both misses are forgiving on purpose: `replace`/`append` against an unknown heading creates it, and
`delete` on one is a no-op. Failing a whole rebuild because a heading was renamed three turns ago
would throw away the other four amendments in the same payload.

- **Addressed by heading, not by byte range.** `old_string` → `new_string` is what coding agents use,
  and it works there because code is near-unique and the agent has just read the exact bytes. Prose
  is the opposite: a profile repeats phrasing constantly, so uniqueness failures are the common case,
  and markdown whitespace is exactly what a model reproduces imprecisely. Heading matching folds
  case, spacing and trailing punctuation; a section genuinely *renamed* gets a new section, which is
  more honest than fuzzy-matching an edit onto the wrong target.
- **`append` is the mode that matters most.** Most updates are a fact *added*, which is what string
  replacement handles worst. Content starting with a bullet joins the list with a single newline;
  anything else starts its own paragraph.
- **The type is flat, though the semantics are a union.** Strict `json_schema` wants every property
  required and `additionalProperties: false`, which a three-way `anyOf` fights.
  `validateProfileUpdate` enforces "exactly one of sections/rewrite" — a check that had to exist
  anyway, since Qwen gets no schema enforcement at all.
- **`personToMarkdown` / `selfToMarkdown`** render the retired `PersonContext` / `SelfContext` shapes
  into the same section layout, for the migration in `lib/db.ts`. Every old field had a home, which
  is unsurprising — the canonical headings were derived from them.
- **`renameLegacySections`** rewrites headings renamed after profiles were already written with the
  old name. Without it a rename isn't one: matching is by heading, so an amendment aimed at the new
  name creates a twin section and the old one keeps half the content.

**"Threads to pick back up", not "Open threads" — and this cost a real bug.** The two were adjacent
fields of one flat schema before the redesign, held apart by contrasting descriptions. Splitting them
across a markdown section and a JSON field removed everything keeping them distinct, and a rebuild
duly wrote its open questions into the section — "the user has never asked why", "what she actually
studies" — then, having said them, omitted `open_questions` from the response entirely and failed
validation twice. The section holds subjects *they* raised and the conversation left hanging; the
field holds gaps in what the user knows. `updateInstructions` now names the near miss explicitly, and
the rebuild shapes put every small required field *before* the long `profile` object so the cheap
judgment is emitted before two thousand tokens of prose begin.

**Drift and bloat are the unsolved risk.** Amend-in-place documents grow and contradict themselves.
The mitigations are all editorial: a ~1,500-word ceiling stated in the prompt with an instruction to
spend a rebuild consolidating past it, `delete` as a first-class mode, and clearing a profile as a
deliberate start-over. Nothing measures whether a profile is actually drifting. None of the reference
implementations solve this automatically either.
