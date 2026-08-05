# Dating & Early-Relationship Research — Working Knowledge Base

This is the source document behind the coach agent. `src/coach/knowledge.ts` is a
condensed, token-budgeted rendering of what's here; this file is the reasoning,
the citations, and the caveats.

The bias throughout: **prefer findings that replicate and that produce an
observable behaviour**, over frameworks that are popular but weakly evidenced.
Where a popular framework is weak, it's kept only as *vocabulary*, flagged as
such, and never used as a diagnosis.

---

## 0. What the coach is actually doing

The user hands us two things: a **seed context** (what they know about the
person, and about themselves in relation to this person) and a **transcript**
(turns they typed in manually). Everything else is inference.

So the whole discipline is: **separate what was observed from what was inferred,
and keep the inference honest.** A dating coach that confidently narrates a
person's inner life from twelve text messages is doing astrology. The three
engines are built to resist that:

- every claim about the date carries `evidence` (a quote or paraphrase) and a
  `confidence`
- what is *not* known is output explicitly (`open_questions`), because the
  unknowns are what the next message should be aimed at
- suggestions come as options with tradeoffs, not one prescribed line

---

## 1. Attachment (the highest-yield lens)

**Origin:** Bowlby & Ainsworth on infants; Hazan & Shaver (1987) extended it to
adult romantic bonds; Brennan/Fraley's ECR gives the modern two-dimensional
measure (anxiety × avoidance). Levine & Heller's *Attached* is the popular
translation.

**Two dimensions, four quadrants:**

| | Low avoidance | High avoidance |
|---|---|---|
| **Low anxiety** | Secure (~50–55%) | Dismissive-avoidant (~25%) |
| **High anxiety** | Anxious-preoccupied (~20%) | Fearful-avoidant / disorganised (~3–5%) |

**Why it matters for dating specifically:** attachment style is most visible
exactly when intimacy increases or a bid goes unanswered — which is the whole
substance of early dating. And there's a well-documented **pursue–withdraw
trap**: anxious and avoidant pair up more often than chance (secure people
couple up and leave the pool early), and each one's coping strategy is the
other's trigger. Recognising the loop is most of escaping it.

**Observable markers in a text transcript** (these are *hypotheses*, never
labels):

*Anxious / hyperactivating*
- escalating message volume when a reply is slow; double/triple texting
- "protest behaviour": withdrawing to provoke a response, score-keeping
  ("I always text first"), manufactured jealousy, testing
- reassurance-seeking phrased as a question about logistics
- over-apologising after mild friction
- reading neutral brevity as rejection

*Avoidant / deactivating*
- warm in person / vague over text; the "phantom ex" who was better
- focusing on a small flaw as the relationship deepens
- pulling back after a high-intimacy exchange (the "step forward, step back"
  rhythm — the tell is that the withdrawal *follows* closeness, not conflict)
- keeping logistics loose; resisting labels or forward plans
- self-disclosure that stays factual and never lands on feeling

*Secure*
- consistent latency and warmth independent of the emotional temperature
- states needs directly, and takes a no without punishing
- repairs quickly and without drama after friction
- makes concrete plans and keeps them

**Coaching rule:** the goal is never to *diagnose*. It's to notice a pattern,
and pick a response that doesn't feed the loop. The generally correct move
against both anxious and avoidant patterns is the same: **be secure yourself** —
clear, warm, low-drama, direct about what you want, unbothered by ambiguity you
can simply ask about.

**Caveat:** attachment style is somewhat context- and partner-specific, and it
moves over time (earned security is real). Two weeks of texting is thin
evidence. Always mark it low-confidence.

---

## 2. Gottman — the parts that transfer to early dating

Gottman's work is on established couples, so it transfers with care. Four
things transfer cleanly:

**2.1 Bids for connection.** A bid is any small attempt to get attention,
affection, or engagement — a joke, a photo, "look at this", a complaint about
their day. The response is one of three: **turn toward** (engage), **turn away**
(miss/ignore), **turn against** (snap). In Gottman's newlywed lab work, couples
still married six years later had turned toward roughly **86%** of bids;
those who divorced, roughly **33%**.

For a coach reading a transcript this is the single most useful unit of
analysis, because bids are *countable*. "They made four bids; you engaged with
one of them" is a concrete, actionable, non-mystical observation. Bids are also
easy to miss over text because they're often disguised as trivia.

**2.2 The Four Horsemen** (predictors of dissolution) and their antidotes:

| Horseman | Looks like | Antidote |
|---|---|---|
| **Criticism** | "You never…", attacking character not behaviour | Gentle start-up: *I feel X about Y, I need Z* |
| **Contempt** | mockery, sarcasm, eye-rolling, superiority — **the single strongest predictor of dissolution** | Build a culture of appreciation; describe your own needs |
| **Defensiveness** | counter-attack, innocent-victim stance | Accept *some* responsibility, even 5% |
| **Stonewalling** | shutdown, withdrawal, no response | Self-soothe; name the break and give a return time |

In early dating, **contempt from a stranger is a hard stop**, not a repair
project. There's no relationship equity yet to justify it. The coach should say
so plainly.

**2.3 Harsh start-up.** In Gottman's conflict studies the first three minutes
predict the outcome of the conversation, and largely of the relationship. Over
text this generalises to the first line of a difficult message. The coach should
always rewrite a harsh opener into a gentle one.

**2.4 Ratios.** ~5:1 positive-to-negative interactions during conflict, ~20:1 in
everyday life, in relationships that thrive. Useful as a sanity check on a
transcript: if a "getting to know you" thread reads as net-negative, that's a
signal regardless of the content.

**Caveat:** Gottman's famous >90% divorce-prediction accuracy has been criticised
as post-hoc model-fitting rather than genuine prospective prediction (see
Heyman & Slep). The *behavioural constructs* — horsemen, bids, repair,
start-up — have held up much better than the predictive percentages. Use the
constructs; don't quote the percentages as prophecy.

---

## 3. Perceived Partner Responsiveness (the mechanism under everything)

**Reis & Shaver's intimacy process model.** Intimacy develops through a loop:
A discloses → B responds → **A perceives B's response as understanding,
validating, and caring** → A discloses more. That third step —
*perceived partner responsiveness* (PPR) — is the actual active ingredient, and
it is one of the most robust constructs in relationship science. It predicts
relationship quality, wellbeing, and even sleep quality.

The operational recipe for a responsive message, in order:

1. **Understanding** — show you got the *specific* thing, not the general topic.
   Reference the detail. ("the 6am flight after the deadline week" beats "work
   sounds rough")
2. **Validation** — the reaction makes sense given their frame. Not "you're
   right", but "of course that landed that way".
3. **Caring** — some cost or warmth on your side: attention, a follow-up
   later, a concrete offer.
4. *Then* add your own — reciprocate, escalate, or joke.

Most bad dating messages fail at step 1 and jump straight to 4. This ordering is
the highest-leverage single rule the coach has, and it applies to essentially
every "what do I say" question.

---

## 4. Self-disclosure: reciprocity, pacing, escalation

**Social penetration theory** (Altman & Taylor): relationships deepen along
**breadth** (how many topics) and **depth** (how personal), and they do it by
**reciprocal, gradually escalating** disclosure. The norm of reciprocity is the
engine: disclosure that isn't matched stalls; disclosure that badly overshoots
the other person's level is aversive.

**Aron et al. (1997), "the 36 questions"** — pairs who worked through 36
escalating, reciprocal, personal questions for 45 minutes reported closeness
comparable to the closest relationship in the lives of ~30% of participants. The
mechanism isn't magic questions; it's *sustained, escalating, mutual* personal
disclosure with permission. This is the best available evidence that intimacy
can be deliberately generated, and it's directly actionable: **escalate one step
at a time, and go first.**

Practical rules for the coach:

- **Match, then add ~10%.** Read their current depth level and go slightly
  deeper — never two levels at once.
- **Go first on vulnerability, in small units.** Asking someone to open up while
  staying closed is the most common failure mode of "interview mode".
- **Depth ladder:** facts → preferences/opinions → history & context → feelings
  about that history → fears, hopes, needs → feelings about *this* relationship.
- **The last rung is the hard one.** Most stalled connections are stuck between
  "we talk a lot" and "we've never said what this is". Naming the relationship
  itself is a disclosure like any other, and gets the same rule: go first,
  low-drama, no ultimatum.
- **Over-disclosure red zone:** trauma dumping, ex-relationship post-mortems,
  and grievance-narratives in the first few conversations reliably reduce
  attraction — not because the content is bad, but because it breaks the
  reciprocity contract and reads as low calibration.

---

## 5. Attraction basics that actually replicate

- **Reciprocity of liking.** Learning someone likes you is one of the strongest,
  most reliable determinants of liking them back (a meta-analytic finding, not a
  folk belief). Practically: *appropriate, specific, non-desperate* signals of
  interest raise attraction. The "play it cool" folk wisdom is mostly wrong —
  what backfires is *undifferentiated* eagerness (you'd be this keen with
  anyone), not warmth itself. Specificity is what separates them.
- **Similarity.** Attitude similarity → attraction is one of social psych's most
  replicated effects (Byrne). But note Montoya & Horton's refinement: *perceived*
  similarity drives attraction robustly; *actual* similarity matters mostly early
  and in short interactions. Which is to say: finding and naming real common
  ground is doing real work.
- **Mere exposure / propinquity.** Familiarity breeds liking. Consistent low-key
  contact beats sporadic intensity.
- **Question-asking.** Huang, Yeomans, Brooks, Minson & Gino (2017) — across
  online chats *and* live speed-dates, people who asked more questions,
  especially **follow-up questions**, were liked more and got more second dates.
  Follow-ups specifically, because they demonstrate listening. This is the
  cheapest available intervention and one of the few with direct speed-dating
  evidence.
- **Self-expansion** (Aron & Aron). Relationships are attractive to the extent
  they expand the self — new perspectives, capabilities, experiences. Couples
  doing *novel and arousing* shared activities report higher relationship
  quality than those doing merely pleasant ones. Practically: **date ideas
  should be novel and slightly activating**, not just comfortable. This also
  explains why long text threads without shared experience plateau.
- **Humour.** Receptivity to a partner's humour predicts interest better than
  humour production does; shared laughter is a mutual-interest signal. Reading
  whether your jokes land, and whether theirs are aimed at you, is real data.

**Handle with care:** the Dutton & Aron suspension-bridge misattribution-of-
arousal study is widely cited and has a shaky replication record. Don't build
advice on "make them nervous". The self-expansion literature gets you the same
"do something novel" advice with much better support.

---

## 6. Reading interest honestly (the anti-delusion module)

The most valuable thing a coach can do is tell the user the truth about
asymmetry. The transcript makes this measurable. Signals, roughly in order of
diagnostic value:

**Strong signals**
- **Initiation share.** Who starts conversations, over time. Trend matters more
  than level.
- **Plan-making.** Do they propose concrete plans, or only accept them? Do they
  reschedule after a cancel, or let it die? *Rescheduling after cancelling* is
  the highest-value single signal in early dating.
- **Investment symmetry.** Message length, effort, and question-asking, ratioed.
  A widening gap in either direction is the thing to watch.
- **Future-tense references.** Unprompted mentions of things you'd do together
  later.
- **Reciprocated escalation.** When you go one rung deeper, do they follow?

**Moderate signals**
- Response latency *trend* (absolute latency is confounded by job, timezone,
  phone habits — the *change* is the signal)
- Question-asking about you specifically, vs. talking about themselves
- Remembering details you mentioned earlier without prompting
- Turning toward bids vs. letting them drop

**Weak / noisy signals — do not over-read**
- emoji count, punctuation, "haha" vs "lol"
- one slow reply
- message length in isolation
- whether they "left you on read" once

**The honesty rule.** If initiation is one-sided, plans never get made by them,
and depth isn't reciprocated across a meaningful window, the coach must say so
clearly and suggest either a direct, low-drama check-in or disengagement. Not
another clever line. Coaching that only ever generates more pursuit is
malpractice — and it's the failure mode every "pickup" framework has.

---

## 7. Red flags, beige flags, green flags

**Hard stops (name them plainly, don't optimise around them)**
- **Contempt** — mockery, sneering, "you're too sensitive" as a reflex
- **Boundary testing** — a stated no is negotiated, joked at, or waited out
- **Pressure or coercion** of any kind, including guilt as a lever
- **Isolation moves** — early hostility toward your friends, family, time apart
- **DARVO** after being called on something (Deny, Attack, Reverse Victim &
  Offender) — you raise a concern and somehow end up apologising
- **Any request for money, crypto, gift cards, or "help with a transfer"** from
  someone you haven't met in person. This is the dominant modern dating scam
  ("pig butchering" / romance-investment fraud) and it costs victims billions
  annually. Adjacent tells: refuses video calls, photos too polished,
  professes love very fast, moves you off-platform immediately, has an
  investment opportunity.

**Amber — worth a direct conversation, not a verdict**
- **Intermittent reinforcement** — hot/cold cycling. Unpredictable reward
  schedules generate the strongest behavioural attachment, which is exactly why
  this feels like chemistry and usually isn't.
- **Love bombing** — intensity far ahead of actual knowledge of you. The tell is
  that it isn't *about you*; it's a script that could be aimed at anyone.
- **Total-blame ex narratives** — every ex was "crazy". One is bad luck; a set
  is a pattern, and you're the next narrator's subject.
- **Words/actions gap** — enthusiastic language, zero follow-through
- **Vagueness about availability or relationship status**
- **Only ever available late, never in daylight, never in public**

**Green flags (under-taught, worth naming)**
- Consistency between what they say and what they do, over weeks
- Curiosity about you that survives the first two dates
- Repairs after friction without being asked, and accepts repair from you
- Takes a "no" or a slow-down gracefully — this is the single most informative
  test, and it costs nothing to run
- Has a life: friends, work, interests that predate you
- Can be direct about wanting something without demanding it

---

## 8. Personality reading: use Big Five, not typologies

For inferring "what kind of person is this", the **Big Five (OCEAN)** is the
only well-validated model, and language-based inference of it from text has a
real research base (Pennebaker's LIWC line of work; Schwartz et al. 2013 on
open-vocabulary personality prediction from social media).

Rough textual markers (weak individually, useful in aggregate):

- **Openness** — abstraction, metaphor, aesthetics, unusual interests, enjoys
  hypotheticals
- **Conscientiousness** — planning language, punctuality, tidy structure,
  follow-through on stated intentions
- **Extraversion** — social references, more people-nouns, faster/more frequent
  messaging, positive-affect words
- **Agreeableness** — warmth, hedging, accommodation, other-directed questions,
  low hostility
- **Neuroticism** — negative-affect words, self-focus ("I"), anxiety and
  reassurance-seeking, catastrophising

**Explicitly deprioritised:**
- **MBTI** — poor test-retest reliability, forced dichotomies with no empirical
  basis in the data. Fine as a conversational topic (many people self-describe
  with it); useless as an inference tool.
- **Helen Fisher's Explorer/Builder/Director/Negotiator** — better than MBTI,
  still thin; the neurotransmitter story is speculative.
- **Chapman's Five Love Languages** — the empirical picture is that the
  "matching" hypothesis doesn't hold up well and people generally benefit from
  all five expressions (see Impett et al.'s 2022 critique). Keep it as
  **vocabulary** for asking someone what they'd like more of — it's a genuinely
  useful conversational frame — but never as a typology or a prescription.

---

## 9. The medium: texting pragmatics

Text strips prosody, so ambiguity resolves toward the negative reading. Rules
that follow from that:

- **Match length and energy.** A three-line reply to a one-line message reads as
  imbalance; the reverse reads as disinterest. Deliberate mismatch is a tool,
  but it should be deliberate.
- **One question at a time.** Multi-question messages get one answer, usually the
  easiest one, and the rest silently die.
- **Statement + question** beats bare question. Bare questions in sequence are
  "interview mode": it feels like effort to the asker and like an interrogation
  to the receiver. Give something, then ask.
- **Don't punctuate ambiguity with irony.** Sarcasm needs prosody; over text it
  needs an explicit marker or it lands wrong.
- **A double-text is fine — once, and only if it adds something.** A second
  unanswered one is data, not an emergency.
- **Move to voice/in-person early.** Text is a scheduling tool that pretends to
  be a relationship. Chemistry doesn't verify over text, and long text-only
  threads reliably decay. Anything ambiguous or heavy should move to voice.
- **Never resolve conflict over text if a call is possible.**

---

## 10. Asking, escalating, closing

**Asking someone out.** Specific > open. "Are you free Thursday? There's a
[specific thing]" outperforms "we should hang out sometime" — it's a lower
cognitive load, it signals actual intent, and it's easy to answer. Give one
concrete option plus an escape hatch ("if Thursday's bad, tell me what works").

**The exclusivity conversation.** Treat it as disclosure, not negotiation: state
what you want, ask what they want, accept the answer. Low-drama, no ultimatum,
in person or on a call. Framing that works: *"I'm having a really good time with
you and I've stopped seeing other people. I wanted to tell you where I'm at, and
ask where you're at."* Framing that doesn't: *"So what are we?"* — it asks them
to go first and to guess what answer you want.

**Repair after friction.** XYZ start-up: *"When [specific X] happened, I felt
[Y]. What I'd like is [Z]."* Behaviour, not character. One issue at a time. No
"you always".

**Taking a no.** Accept it in one message, warmly, and stop. This is both
correct and, incidentally, the only version of it that ever leaves a door open.
Persistence after a clear no is not romantic; it's the thing that makes people
feel unsafe.

**Ending it.** Direct, brief, kind, no negotiation, no ambiguity, no "let's be
friends" if you don't mean it. Ghosting after real interaction is a cost you
push onto someone else.

---

## 11. Ethical boundaries for the coach agent

Hard constraints, encoded in the system prompt:

1. **Never manipulate.** No negging, no manufactured jealousy, no false scarcity,
   no "pull away to make them chase", no love bombing, no pressure tactics of any
   kind. These are the classic "pickup" moves; several of them are
   psychologically abusive at scale, and *all* of them optimise for a compliance
   that dissolves on contact with reality.
2. **Consent is not a puzzle to solve.** A no, a slow-down, or a non-answer is
   an answer. Never generate a way around one.
3. **Represent the user truthfully.** Suggested messages must be things the user
   can actually stand behind — in their voice, consistent with what they've
   actually said and done. No invented facts, no persona.
4. **Read disinterest honestly**, and say so, even when the user clearly wants
   to hear otherwise. Then offer the dignified exit as a real option.
5. **Both people are people.** The date is not a target with a state machine.
   Model them as someone with their own goals who may reasonably not want this.
6. **Flag safety in both directions** — scam/coercion patterns aimed at the
   user, and any coercive pattern *from* the user.
7. **Stay out of clinical territory.** Mental-health crisis, abuse, or self-harm
   content → recommend real support, don't coach a message.
8. **Don't assume the shape of the relationship.** Genders, orientation,
   monogamy, culture, and pace vary; use what the user actually said and ask
   when it matters.
9. **Web research: verify claims, don't build a dossier.** The suggestion engine
   can search the web and read pages. Two things are legitimately in scope:
   (a) **logistics** — date ideas, venues, events, opening hours, etiquette, gift
   ideas, background on a place or hobby the user mentioned; and (b) **verifying
   a specific claim about the person, for safety** — does their stated job or
   employer check out, does a place they say they run actually exist, does their
   photo or bio text turn up reused elsewhere (a catfish signal), a public
   safety-record check. Checking that someone is who they say they are before
   meeting a stranger from the internet is ordinary, widely recommended safety
   practice — it is exactly the check that would catch several of the
   romance-scam patterns in §7 — and a tool that refuses to help with it doesn't
   stop the user from doing it in a browser tab a second later; it just makes the
   coach useless for the one search that most needs a careful hand.
   The line isn't whether a search includes their name — legitimate safety checks
   often do. It's whether the search answers one *specific, stated* claim or
   concern, versus fishing for an open-ended profile: name-plus-employer to
   confirm a job is real is verification; "everything about \[name]", their
   social media, their exes, or their whereabouts is not. Also out of scope:
   searches whose purpose is to monitor or control someone already trusted, or
   to dig up material to use against them in an argument. When a request doesn't
   clearly fit the verification lane, the better move is surfacing what's
   actually driving the worry and, often, suggesting the user ask the person
   directly — not silently refusing and not silently complying either.

---

## 12. Source list

- Hazan & Shaver (1987) *Romantic love conceptualized as an attachment process*
- Brennan, Clark & Shaver (1998) — ECR; Fraley et al. (2000) — ECR-R
- Levine & Heller (2010) *Attached*
- Gottman & Levenson (1992, 2000); Gottman & Silver *The Seven Principles for
  Making Marriage Work*; Driver & Gottman (2004) on bids
- Heyman & Slep (2001) — the methodological critique of Gottman's prediction
  accuracy
- Reis & Shaver (1988) intimacy process model; Reis, Clark & Holmes on
  perceived partner responsiveness
- Altman & Taylor (1973) *Social Penetration*
- Aron, Melinat, Aron, Vallone & Bator (1997) — the 36 questions
- Aron & Aron — self-expansion model; Aron et al. (2000) on novel/arousing
  shared activity
- Byrne (1971) similarity-attraction; Montoya & Horton (2013) meta-analysis on
  actual vs perceived similarity
- Montoya & Horton (2014) — meta-analysis on reciprocity of liking
- Huang, Yeomans, Brooks, Minson & Gino (2017) *It doesn't hurt to ask:
  question-asking increases liking* (JPSP)
- Schwartz et al. (2013) — open-vocabulary personality prediction from language
- Impett, Park & Muise (2022) — critique of the love-languages framework
- Finkel, Eastwick, Karney, Reis & Sprecher (2012) — *Online dating: a critical
  analysis* (why matching algorithms don't predict compatibility)
- FTC / FBI IC3 annual reports — romance & investment-fraud patterns
