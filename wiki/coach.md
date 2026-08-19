# The Coach

Three engines, one shape: build messages → one LLM call → parse → validate → retry once → store.
The two rebuild engines never deviate from that — no tool loop, no multi-stage pipeline. `suggestMove`
is the one exception: on the keyed backends (`openai`, `anthropic`) it can run a bounded tool-calling
loop (web search + read page) before producing its answer — see [lib.md](lib.md#agentts--tools) for
the mechanics.

## `knowledge.ts`

**The seed, not the live text.** Everything here is assembled by [`mind.ts`](#mindts) into one
markdown document — the coach — which is what actually reaches a prompt and which both the user and
the coach can rewrite. A rewrite stops that installation reading this file **for the sections it
rewrote**; every section neither of them has touched still refreshes from here on each read, so a
release improving one module reaches everyone who hasn't edited that module. Editing it therefore
matters three ways: it is what a new installation starts from, what "revert to shipped" restores, and
what an existing installation picks up for anything it has left alone.

Each export is exactly one `##` section of that document, which is why the headings are what they
are — they're the addresses an amendment aims at. Split so each engine only pays for what it uses:

| Module | Used by | Contents |
|---|---|---|
| `KB_IDENTITY` | every engine | Who the coach is: voice, nerve, who the advice is for, and the one line that never bends |
| `KB_EVIDENCE` | both rebuilders | Inference discipline: separate observation from inference, confidence is part of the claim, one message is never a pattern, prefer the boring explanation, unknowns are output, and politeness is not uptake — an ironic thank-you or a wall of laughing is a receipt, so read the two messages after it, which bites hardest when the coach is grading its own advice |
| `KB_READ_THEM` | rebuild-them | Attachment markers (as hypotheses), Big Five over MBTI/love-languages, bids for connection — including the ones that reach into something of the user's, since stepping over one is how a live subject dies — who is supplying the conversation (who opens, which subjects they feed versus close politely, what they raised that nobody picked up, what is spent, whether the thread has narrowed to one loop), honest interest signals ranked by diagnostic value, red/amber/green flags |
| `KB_READ_ME` | rebuild-you | Responsiveness quality, bid response rate, investment asymmetry, interview mode, disclosure level, voice, stated vs revealed goals, who brings the subjects (answering well is the comfortable half and invisible as a gap), and what the user is actually into this month — the one conversational supply that works before a thread has any history, and the only material here that cannot be researched |
| `KB_MOVES` | suggest | Attraction before rapport (lead, don't over-agree, escalate, flirt) and attention-as-the-product; then the PPR recipe (understanding → validation → caring → then your own) scoped to replying rather than billed as universal; the depth ladder, cheap well-evidenced wins, texting pragmatics (now carrying density, one-subject-per-burst, their-line-first, and don't-explain-a-tease), set pieces (asking out, opening cold, exclusivity, repair, taking a no, ending it), calibration rules, and what early ambiguity actually means |
| `KB_WORTH_REPLYING` | suggest | The half `KB_MOVES` lacked: not whether a reply is right, but what the other person gains by reading it. Announce-do-report and its boundary (it yields the next *beat* of a thread, never a new one); the reply owes them something new; guess-don't-survey as two moves — an unmissable description plus a reframe that admires where sympathy was expected, aimed at a self-concept rather than a habit, and never at an insecurity; open-don't-only-answer with a test for "new" and the running loop ruled off its own supply list; a read inflating as fast as a compliment does; take the bid; status as a ticket that needs a seat in it; land it and leave; drafting for voice once the channel changes, which the playbook pushed toward for a year without saying what to do on arrival; don't become the channel for their bad week. Derived from a real 930-turn record rather than from research — see the module comment, which also says what was deliberately left out and why the examples in the prose are load-bearing |
| `KB_RESEARCH` | suggest, only when tools are attached | Three lanes: what they've said about themselves, whether it holds up, and the logistics of the move. Search what would change the advice, as many times as that needs — but not for its own sake, and with the query built from the thread's current state, or it looks up a venue in the city they left four turns ago. Bounded by where it starts — outward from what the person disclosed, not a sweep for everything findable about them, which is the one scope limit any section carries. Check `<research_notes>` before searching again, and write back only what's new — the block is kept for you, so restating it is how it fills with the same fact in six wordings |

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
| `user[n+1]` | `<what_you_have_learned>`, `<research_notes>`, `<right_now>`, `<from_the_user>`, closing instruction | every run |

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

**The coach's mind is split across two positions, and that used to be the rejected option.** The
belief sections ride in `system`; "What you've learned" rides in the tail (`<what_you_have_learned>`,
`audience: 'tail'` in `MIND_PARTS`). The one-document position — everything in `system`, amendments
accepted as a rare cache write — didn't survive measurement: the learned section is where amendments
land *by design*, `system` sits above the profile and the whole transcript, and one ~250-char
amendment between two next-move runs re-wrote ~47k of ~49k cached tokens.
Amending a *belief* section still invalidates the system entry, and that remains accepted: it means
a rule actually changed, and `changed: false` is stated as the expected answer.

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
  the same numbers, so a citation is checkable. The number is `Turn.number` — handed out once from
  `DateRecord.nextTurnNumber` and never reused, *not* the array index it used to be. Positional
  numbering made a citation drift: insert a turn near the top and every reference below it silently
  re-aimed, in prose nobody re-reads. The invariant is **allocation order, not transcript order** —
  insert between 60 and 61 and the array reads 60, 62, 61. "Ascending with gaps" is the natural
  summary and it is wrong; reading it that way and tidying the sequence back into order is exactly how
  a later change would renumber every stored citation. See `numberTurns` in
  [lib.md](lib.md#transcriptts).
- **`NOTE:` lines are the transcript acting as the context pool.** A turn whose speaker is `context`
  (see `Speaker` in `types/date.ts`) is something the user knows that nobody typed — said on a call,
  heard from a friend, simply remembered — sitting at the point it was learned. `contextEntryNote`
  explains that to the model, and only when the record has one, so a record without any produces a
  transcript entry byte-identical to what it was before the feature existed. They're numbered and
  citable like anything else, and explicitly not evidence about how either person writes.
- **`COACH:` lines are the coach's own past advice, in the position it was given.** A `coach` turn
  carries a two-line summary — the priority and the option labels, derived in code by `adviceTurn`,
  never asked of the model — while the whole `Suggestion` rides along in `Turn.advice` for the UI
  and never reaches the prompt. It is also the **only turn the app can timestamp**: `Turn.at` is
  free text everywhere else, which is why `<right_now>` tells the model to say it doesn't know
  rather than estimate an interval, but this one was written by the app at a moment it knows
  exactly, so `adviceTurn` stamps it from `generatedAt`. Without it a later run could see what it
  advised and what came back, but not whether the reply landed four minutes or four days later, nor
  how long outstanding advice has been outstanding. `coachEntryNote` tells the model what to do with the pair: what
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
  re-searching, and the standing rule that where two lines conflict the later one is the correction.
  Shown to all three engines, not just `suggestMove`: it's already-vetted factual content by the
  time it lands here, no different from anything else the user could have written down as a `NOTE`
  by hand. Past `NOTES_LINE_CEILING` the block gains one extra instruction — rewrite the whole list
  into `research_notes` this run, merging duplicates and folding each correction into the line it
  corrects. Only `suggestMove` ever gets it: it's the one shape with a `research_notes` field, so
  it's the only engine that could answer. What keeps the block from filling up in the first place is
  `NOTES_ARE_A_DELTA` in the task block — the field is what's *new*, since the stored block persists
  whether or not the model returns it, and without that said the honest response is to restate
  everything visible. **The two must be read together, and the consolidation ask says so explicitly**
  (*"this overrides the delta rule in the task above"*), because on that one run they otherwise
  contradict: obeying the delta rule literally would return only the new facts, and the swap would
  then replace the whole block with those — destroying the notes on the run meant to protect them.
  The delta rule names the exception from its own side too, so neither block states an unqualified
  negative the other overturns.
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
  note instead. On Them and You the box feeds two different calls depending on whether a profile
  exists yet — `buildChatMessages` to amend one, `buildPersonMessages`/`buildSelfMessages` to seed
  the first rebuild — but the block, the position and the contract are identical either way.
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
  real answer rather than a failure. It also bans, in those words, a bullet that corrects another
  bullet — see the `edit` mode below for why that instruction needed an op behind it before it
  worked.
- **`buildSystem(task, customPrompt)`** assembles the whole instructional half — identity, inference
  discipline, the engine's task — and appends the user's house rules, scoped to override the style
  preferences in the task but never the non-negotiables. Nothing record-specific may enter it.

### Where user-authored input goes

There is no *stored* seed. Everything the user knows that is worth keeping is in one pool; the other
two channels are one-shot and nothing persists them. The split is by what the input is **about**,
not when it was written:

| | Holds | Read by | Shape |
|---|---|---|---|
| `turns` (`them` / `me`) | what was actually said | all three | chronological, numbered, citable |
| `turns` (`context`) | what the user knows that nobody typed | all three, in the same list | same — a `NOTE:` line |
| `turns` (`coach`) | what this app advised, and when | all three, in the same list | same — a `COACH:` line |
| the coach's mind | what transfers to every person | all three — beliefs in the system block, "What you've learned" in the tail | markdown, amended by section |
| `goal` | what the user wants out of this | all three, in the first user block | one short field |
| the footer box | direction about this answer, or background offered once | the engine being run, in the tail | `<from_the_user>`, never stored |

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

**Why a one-shot seed came back anyway.** Routing a CV through the pool made the user do the app's
filing: paste it as a `NOTE`, rebuild, then go back and delete the note so it stops riding along
forever. Three steps to hand over a fact, and the third is one nobody remembers. The footer box on
Them and You seeds the first rebuild directly instead — it was disabled in that state, which made
the one place a new user looks to say who these people are a dead control.

None of what killed `seedThem`/`seedMe` comes back with it, because the objection was never *"the
user shouldn't paste a CV"* — engines 1 and 2 are explicitly told to absorb one. It was the
**position and the persistence**: stored forever, re-sent from the top of every request, above the
transcript, in the slot the layering reserves for the most authoritative material. This rides the
volatile tail below every cache breakpoint, exists for exactly one call, and is outranked by the
transcript like everything else down there. What survives is whatever the profile absorbed —
which is the durable half, and the half that gets consolidated and pruned rather than accumulating.

The one thing it cannot survive is **Start over**, which clears the profile and re-reads the
conversation — and a one-shot seed was never in the conversation. Both confirm dialogs say so.

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

Each `validate*` takes an optional second argument: the document the update is about to be applied
to, which is the only thing that makes an `edit`'s quote checkable. `validatePerson`, `validateSelf`
and `validateChat` take the one profile snapshot they rewrite. `validateSuggestion` takes a
`SuggestionBases` — `{ mind?, them?, me? }` — because a suggestion can carry two amendments at once,
one to the coach's document and one to either profile, and they are quoted from different documents;
`run.ts` passes all three. An absent base means there is nothing to check against, not that the
document is empty, and the update is then checked for shape alone with a bad quote dropped later by
`applyProfileUpdate` instead.

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

`rebuildPersonContext(record, message, …)` and `rebuildSelfContext(record, message, …)` are
identical in shape: resolve config + house rules, build messages, call `completeJSON` with the
matching validator and schema, then apply the returned `ProfileUpdate` to the stored markdown.
`message` is the footer box, one-shot and never stored — usually empty, since the header's own
Rebuild button passes nothing and an empty one produces a request byte-identical to what it was
before the parameter existed. Deliberately never given tools of their own —
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
in the task rather than in the mind, for two reasons that survive. It's a contract about an output
field rather than something the coach believes — and the mind is editable, so a section carrying it
is one the user can delete, which would empty `research_notes` on the backend most runs use with
nothing to say why. And it is needed on *one* path: `mindFor` selects sections by audience, so a mind
section rides every call for an engine or none, while the task string is already two variants and can
carry it on the no-tools one alone. (The reason that no longer applies: a new `##` section used to be
missing from every document already forked from the seed. Under per-section forking `mindText` inserts
a newly shipped heading into any document that hasn't forked it, and `legacyForked` marks only the
headings a legacy document actually contains — so a new section would now arrive.) The tool-bearing
path is left alone, so each
variant stays one constant string and caches on its own.

`suggestMove` also does two things the rebuild engines don't. It appends its answer to the
conversation as a `coach` turn (`adviceTurn` in `lib/transcript.ts`) — see
[architecture.md](architecture.md#the-turn-pool) for why the advice lives there and what it costs.
And it is the only engine that amends **the coach itself**: the returned `mind` update is applied
and saved right here rather than handed back, because the coach isn't a field of any record and
there is no record-merge for a caller to get right. It re-reads storage first — a run takes half a
minute and the user may have edited it by hand in the meantime — and `mindText` resolves the seed, so
an amendment lands on the full document rather than on an empty one, forking only the section it
actually rewrote.

### The profile proposal

`suggestMove` can also amend **a profile** — and this one it returns rather than writes. The
`profile` field of its response is a `ProfileUpdate` with a `target` (`"them"` / `"me"`) alongside
it; `toProposal` nests it into the `ProfileProposal` stored on the `Suggestion`, which rides the
advice turn into the record. `changed: false` — the answer on most runs — becomes no field at all.

The asymmetry with `mind` is the whole design:

- A profile **is** a field of the record, so the merge belongs to whoever owns the record.
- The user is the **editor** of these two documents. A rebuild is something they asked for. An
  amendment arriving as a side effect of "what do I say next" is not, and writing it would rewrite
  the page they were reading with no diff and no undo. `SuggestionView` renders it as a card at the
  foot of the advice with an Apply button; `applyProposal` in `App.tsx` writes the profile and
  stamps `appliedAt` back into the stored turn in the same transaction, so the offer and its outcome
  can't disagree across a reload.
- Losing a `mind` amendment costs the coach one finding. Silently dropping a profile write would
  leave the user believing something was recorded that wasn't.

Three guards keep the offer honest. **The bar**, in `proposalInstructions`: propose only what a
rebuild wouldn't find on its own — the user's note this run, what research established, a correction
they made — because a rebuild reads the same transcript and would otherwise write the same fact a
second time in a second wording. **Staleness**, in `App.tsx`: if the target profile's `generatedAt`
or `amendedAt` moved past the suggestion's `generatedAt`, the button is replaced by "Profile moved
on". The `edit` quotes were validated against the document as it stood during the run, so a document
that has changed since could take some ops and drop others — a half-applied amendment reported as
"Applied" is the one outcome worth a disabled button to avoid. **A rebuild in flight**, which is that
same failure one moment earlier: it writes the target profile whole from the record it started with,
so an apply that lands underneath is silently overwritten while the card reads "Applied" and
staleness then blocks re-applying. `proposalBusy` gives the card a third state, "Rebuilding…", rather
than the "Profile moved on" that would be a false statement about a document that hasn't moved yet;
it keys on the run's *target*, since a next-move run touches neither profile. `applyProposal` refuses
the same click synchronously through `runsRef` — state lands on the next render, and the frame
between claiming a run and rendering that fact is exactly where a click gets in.

Not in the export. `export-markdown.ts` keeps only the drafts out of a suggestion by policy; an
applied proposal is already visible in the profile it amended, and an unapplied one is an offer that
was declined.

## Output contracts

| Engine | Returns | Notable fields |
|---|---|---|
| `rebuildPersonContext` | `PersonProfile` | `markdown` (amended, not regenerated) + `judgment`: `interest_read` with `signals_for` / `signals_against` / `honest_note`; `flags`; `open_questions` |
| `rebuildSelfContext` | `SelfProfile` | `markdown` + `judgment`: `goal_read` splitting stated from revealed; `open_questions` |
| `chatAboutProfile` | `{reply, headline, markdown, changed}` | one instruction: prose for the user, an optional `ProfileUpdate` applied to the stored markdown, and a replacement headline when the amendment made the old one wrong (`""` otherwise, the common case) |
| `suggestMove` | `Suggestion` | `options[]` — each a verbatim `draft`, a `why`, a `then` for reading the response, and a risk level; plus `avoid`, `timing`, `honest_note`, `research_notes` (durable findings, merged into the record — see `lib/research-notes.ts`), `mind` (a `ProfileUpdate` the coach applies **to itself**), and `profile` (a `ProfileProposal` it returns for the user to apply — see above) |

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
getting knowledge-base improvements from releases. A write forks **the sections it rewrote**, not the
document: `saveMind` derives `Mind.forked` by comparing each canonical body against the seed at save
time, and `mindText` refreshes every heading *not* in that list from the current seed on each read.
So editing "Reading the user" leaves the other five taking releases, and `Revert to shipped` on a
section un-forks it — the body matches the seed again, so the next save drops it from the list.

The contract, precisely: **forked means this body differs from the seed as the seed stands at the
moment of the write.** Storing that answer is what keeps *reads* from re-deriving it — between saves a
release can move a seed, and a section still holding the old text no longer equals the new one, so
deciding on read would call that an edit and freeze it. It does not accumulate, though: each save
recomputes the whole set, so a later seed that becomes byte-identical to what the user wrote un-forks
their section on the next save. That is the same rule as `Revert to shipped` — matching the seed *is*
how you rejoin it — and carrying a prior set forward would mean threading the previous `Mind` through
`saveMind` to preserve a distinction with no visible effect where it is drawn.

**A document stored before `forked` existed migrates to the canonical headings it actually contains**
(`legacyForked`), not to the full current list. Those documents were written under "any write forks
everything", so every section they have is forked — but marking a heading they have never seen forks
a section that isn't in them, and `mindText` then skips inserting the very thing it should deliver: a
section shipped after the upgrade would never arrive, for exactly the users who have been here
longest, and would present as one they appeared to delete. The cost is the other reading of absence —
a section deleted by hand before the field existed comes back once from the seed, since legacy
storage records no heading set to tell the two cases apart. That is the recoverable mistake of the
two; deleting it again now sticks.

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
| Who you are | every call | ~545 |
| Inference discipline | every call | ~440 |
| Reading the other person | rebuild/amend them | ~1,290 |
| Reading the user | rebuild/amend you | ~590 |
| Choosing what to say or do | next move | ~2,830 |
| Being worth replying to | next move | ~1,995 |
| Using web research | next move, tools attached | ~790 |
| What you've learned | every call, in the volatile tail | starts empty |

Whole document ~8.5k tokens; the heaviest engine (next move with research) sees ~6.6k, a rebuild
~2.2k. `Being worth replying to` shares the next-move audience with the playbook, so splitting it out
buys no tokens back — it is a separate slot because a heading is what an amendment can address, and
"does this reply give them anything" is a different claim from "is this reply right".

A heading the user renames or deletes simply isn't found and that engine goes without it —
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

**And no turn numbers in this document**, which is the one place the standing "cite the turn like
`[4]`" rule inverts. A turn number is scoped to *one record*, and the learned section is read on every
call about everyone — so a citation that was evidence when it was written points at a stranger's
message on the next run. (Turn numbers are stable within a record now, which fixes the other half of
this; it does nothing for a document read across all of them.) The evidence goes in words. A finding that can't stand up without a turn number is a finding
about that one conversation, and belongs in the profile, where the number still resolves.

The field is **required in `SUGGESTION_SCHEMA` but optional in `validateSuggestion`**. Providers that
enforce a schema always send it; a backend with none (Qwen) shouldn't burn a whole retry on the one
field whose correct value is empty on most runs. Present-and-malformed still fails, because a
half-formed update would otherwise be applied.

It sits **last** in both the shape and the `required` list, and it sat *before* `options` until a
captured run argued otherwise. The early slot was the lesson `open_questions` cost — a field after
three drafts is one the model sometimes never comes back to. What a captured run showed is the larger
failure: the model left JSON at this nested object mid-generation, emitting the tool-call syntax it
uses natively (`mind` as a *string* reading `<parameter name=…`), flattened `sections` and `rewrite`
to the top level, and stopped. `options`, `avoid`, `timing`, `honest_note` and `research_notes` were
never written, and a run holding a good read, a good priority and a genuinely useful amendment
returned nothing at all. Dropping the amendment costs one finding; corrupting it early costs the
drafts the user came for. Ordering cannot make the nested object safe — it only decides what the
object takes down with it. The early slot is also less necessary now that "What you've learned"
arrives in the tail, a couple of blocks above where the answer starts.

## `profile.ts`

The memory of a person, as markdown amended by section.

```ts
type SectionUpdate = {
  heading: string
  mode: 'replace' | 'append' | 'delete' | 'edit'
  content?: string // for `edit`, what replaces `old` — or "" to remove it
  old?: string     // `edit` only: the exact text being replaced, quoted from that section
}
type ProfileUpdate = { changed: boolean; sections?: SectionUpdate[]; rewrite?: string }
```

`applyProfileUpdate(markdown, update)` splits on `##` followed by a space, applies ops in order, and
re-serialises.
Every miss is forgiving on purpose: `replace`/`append` against an unknown heading creates it,
`delete` on one is a no-op, and an `edit` whose quote no longer fits is dropped on its own. Failing a
whole rebuild because a heading was renamed three turns ago would throw away the other four
amendments in the same payload.

- **Addressed by heading, and for `edit` by a quote within it.** The outer address is the heading for
  the reason it always was: prose repeats phrasing constantly, so a document-wide string match has a
  uniqueness problem code doesn't. Heading matching folds case, spacing and trailing punctuation; a
  section genuinely *renamed* gets a new section, which is more honest than fuzzy-matching onto the
  wrong target.
- **`edit` is the correction mode, and its absence was making documents worse.** Fixing one wrong
  bullet used to mean `replace` on its whole section — regenerating a dozen bullets from memory,
  where anything not re-emitted was destroyed silently. So the model reliably took the lossless
  option and *appended a bullet correcting the earlier one*, then later a third correcting the
  second. Real profiles grew chains of "**Supersedes the bullet above.**", which is bloat and also a
  document that has to be read in order, holding earlier lines as provisional. `updateInstructions`
  had told rebuilds to say what a fact *is now* rather than what it used to be since the beginning;
  the instruction lost to the incentive every time, and only stopped losing once the op existed.
  Scoping the quote to one section is what makes string matching workable here — ambiguity that
  sinks it document-wide is rare inside a few hundred words. `content: ""` removes the quoted text,
  which is the other half of collapsing a chain: edit the original true, then edit the correction
  away.
- **A bad quote is a complaint, not a silent miss.** `validateProfileUpdate` takes the document as an
  optional `base` — every engine passes the same string it will apply to afterwards — and turns a
  quote that isn't there, or is there twice, into a specific instruction. `completeJSON` allows
  exactly one retry before the whole rebuild throws, so the not-found complaint deliberately names
  `append`/`replace` as a way out that isn't another edit. The one tolerance is per-line outer
  whitespace, the single difference a model reliably introduces when quoting markdown back; guessing
  at anything beyond that is how the wrong bullet gets rewritten.
- **Every op is validated against what the ops before it did.** They apply in order, and the checks
  used to read the base document for all of them. `replace` then `edit` on one section — a payload
  that applies perfectly — was rejected, which burns `completeJSON`'s single retry and can throw the
  whole rebuild; `delete` then `edit` passed and was then silently dropped on apply. Validation folds
  each op through `applyProfileUpdate` as it goes, so the two agree by construction.
- **The document's indentation survives an edit.** Both match paths put the replacement where the
  line starts and `content` is trimmed, so editing a sub-bullet promoted it to a top-level one — the
  fallback normalises indentation away, and an exact quote carrying its own indent loses it to the
  trim. The leading whitespace of the line is put back whenever the match opens one; a quote starting
  mid-line is left alone, since its indent is already to the left of the splice.
- **The match is shrunk to the text, not the separators around it.** A quote of whole lines
  plausibly carries the newline that ends the last one — the model is told to copy the section
  exactly, and that is what exact looks like. It matched exactly, was spliced over, and since
  `content` is trimmed the replacement welded onto the next line: `old: "- One\n- Two\n"` with
  `content: "- Merged"` left `- Merged- Three` in the profile. Newlines at either end of an exact
  hit are handed back to the document before the splice. The per-line fallback never had this
  problem — its match ends at the last line's last character.
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

**`"What you're into"` is additive, not a rename**, so profiles written before it simply lack it until
their next rebuild — the same shape as a part added to the mind. It earns a slot because the
next-move engine is told to open a new subject once an exchange has resolved, and on a young record
the other person's open threads are empty: without this the instruction has nothing to draw on but
the loop already running. It is also the only material in either profile that cannot be researched.

**Drift and bloat are the partly-solved risk.** Amend-in-place documents grow and contradict
themselves. `edit` removes the structural half of it — a correction no longer has to arrive as an
extra bullet — but the rest of the mitigations are still editorial: a ~1,500-word ceiling stated in
the prompt with an instruction to spend a rebuild consolidating past it, `delete` as a first-class
mode, and clearing a profile as a deliberate start-over. Nothing measures whether a profile is
actually drifting, nothing triggers the consolidation pass, and documents already carrying supersede
chains only heal when a rebuild happens to touch those lines. The research notes have the machinery
this still wants — `needsConsolidation` in `lib/research-notes.ts` detects the condition and flips
the prompt into replace-the-whole-list mode; profiles have the instruction and no trigger.
