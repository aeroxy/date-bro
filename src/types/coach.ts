import type { ProfileUpdate } from '@/coach/profile'

export type Confidence = 'high' | 'medium' | 'low'

/**
 * A model's reasoning as it streams, for the waiting UI. **Replace-state, not
 * append** — each update carries the whole summary so far, because Qwen resends
 * its full history on every event and Claude's deltas are accumulated for us.
 *
 * `thoughts[i]` belongs to `titles[i]`. Backends that summarise without
 * headings (Anthropic) send one thought and no titles.
 */
export interface ThinkingSummary {
  titles: string[]
  thoughts: string[]
}

/** A claim the model makes, with the transcript evidence that supports it. */
export interface Claim {
  claim: string
  evidence: string
  confidence: Confidence
}

export type AttachmentPattern =
  | 'secure-leaning'
  | 'anxious-leaning'
  | 'avoidant-leaning'
  | 'mixed'
  | 'unclear'

/**
 * `too-early` is the honest answer for a thread with too little in it to read,
 * and the schema has offered it to the model for as long as it has existed —
 * this union just didn't say so, which made a legitimate response unrepresentable
 * in the type that stores it. See `PERSON_SHAPE`.
 */
export type InterestLevel =
  | 'strong'
  | 'warm'
  | 'too-early'
  | 'ambiguous'
  | 'cooling'
  | 'not-interested'

export interface Flag {
  kind: 'green' | 'amber' | 'red'
  label: string
  evidence: string
}

/**
 * The record's `turnsUpdatedAt` at the moment this read was built — i.e. the
 * transcript the model actually saw. `isStale` compares the record's current
 * value against it, so a read goes stale exactly when a turn is added or
 * edited (including mid-run) and never merely because something else was
 * written. Optional: records stored before the field existed read back without
 * it, and `isStale` treats a missing value as "nothing to compare".
 */
interface TurnBasis {
  turnsAt?: number
}

/**
 * The part of a rebuild that stays structured.
 *
 * The profile itself is prose, which is the point — but `interest_read`, the
 * flags and the confidence marks are what make this a read rather than a
 * chatbot summary, and prose loses them. `open_questions` is load-bearing for a
 * different reason: the UI turns each one into something answerable in a few
 * words, so it has to arrive as a list rather than as a paragraph to skim.
 *
 * Regenerated whole on every rebuild, unlike the profile. That's the right
 * lifecycle here — a judgment about where things stand *should* be recomputed
 * from current evidence, and there is nothing to accumulate.
 */
export interface PersonJudgment {
  headline: string
  interest_read: {
    level: InterestLevel
    confidence: Confidence
    signals_for: string[]
    signals_against: string[]
    honest_note: string
  }
  flags: Flag[]
  open_questions: string[]
}

/** The same, for the read of the user. */
export interface SelfJudgment {
  headline: string
  goal_read: {
    stated: string
    revealed: string
    tension: string
  }
  open_questions: string[]
}

interface ProfileBase extends TurnBasis {
  /** When the last full rebuild ran — which is what `judgment` reflects. */
  generatedAt: number
  /**
   * When the prose was last amended by a chat reply, if it has been. Kept apart
   * from `generatedAt` rather than folded into it because the two halves age
   * separately: a chat turn amends `markdown` and leaves `judgment` alone, so
   * one clock would have to lie about one of them. The UI shows both.
   */
  amendedAt?: number
  /**
   * The record's `turnsUpdatedAt` as the last *amendment* saw it — the same
   * thing `turnsAt` is for the last rebuild.
   *
   * The two halves read the transcript at different times, so one stamp can only
   * describe one of them. Without this, an amendment that had just read every
   * turn still left the panel saying "conversation has moved on", because the
   * only stamp available belonged to a rebuild from the day before.
   */
  amendedTurnsAt?: number
  /**
   * Markdown, amended by section rather than regenerated — see
   * `coach/profile.ts`. Never persisted into any message history: injected
   * fresh from storage on every call, so nothing that happens in a prompt can
   * corrupt what's stored.
   */
  markdown: string
}

export interface PersonProfile extends ProfileBase {
  judgment: PersonJudgment
}

export interface SelfProfile extends ProfileBase {
  judgment: SelfJudgment
}

// --- Legacy ------------------------------------------------------------------
//
// The shapes rebuilds used to return, kept only so records written before the
// markdown profiles can be migrated on read (`lib/db.ts`). Nothing generates
// these any more. Delete once no stored record can still carry one — which is
// not knowable from here, so they stay.
//
// Everything but `generatedAt` is optional, and that is not defensiveness: these
// are what a model returned into a schema that has since changed shape more than
// once, so any given field may simply not be in a stored record. The migration
// in `coach/profile.ts` already guards every one of them; saying so here is what
// makes the compiler agree.

/**
 * Output of "rebuild their context".
 * @deprecated Migration input only — write `PersonProfile`.
 */
export interface PersonContext extends TurnBasis {
  generatedAt: number
  headline?: string
  who_they_are?: Claim[]
  what_they_care_about?: Claim[]
  current_situation?: Claim[]
  communication_style?: {
    summary: string
    attachment_hypothesis: {
      pattern: AttachmentPattern
      evidence: string
      confidence: Confidence
    }
    bids: string[]
  }
  interest_read?: {
    level: InterestLevel
    confidence: Confidence
    signals_for: string[]
    signals_against: string[]
    honest_note: string
  }
  flags?: Flag[]
  sensitivities?: string[]
  open_threads?: string[]
  open_questions?: string[]
}

/**
 * Output of "rebuild my context".
 * @deprecated Migration input only — write `SelfProfile`.
 */
export interface SelfContext extends TurnBasis {
  generatedAt: number
  headline?: string
  /**
   * Facts about the user, as they bear on *this* connection — the mirror of
   * `PersonContext.who_they_are`, and for a long time the thing this shape was
   * missing. Every other field here describes behaviour in the conversation, so
   * a fact the user wrote down about themselves had nowhere to land: the rebuild
   * read it, kept nothing, and deleting the note lost it for good. With a slot
   * to absorb into, a rebuild makes the raw note redundant, which is the whole
   * bargain — write it roughly once, let the engine keep the part that matters.
   *
   * Added late, so a record from before it exists without it — the reason this
   * whole block is optional.
   */
  who_you_are?: Claim[]
  how_you_come_across?: Claim[]
  your_voice?: {
    summary: string
    markers: string[]
  }
  patterns?: {
    pattern: string
    evidence: string
    effect: string
  }[]
  working?: string[]
  costing_you?: string[]
  you_have_revealed?: string[]
  goal_read?: {
    stated: string
    revealed: string
    tension: string
  }
  open_questions?: string[]
}

export interface SuggestionOption {
  label: string
  kind: 'message' | 'action'
  risk: 'low' | 'medium' | 'high'
  /** The actual text to send, or the concrete action to take. */
  draft: string
  why: string
  /** How to read what comes back, and what to do with it. */
  then: string
}

/**
 * A profile amendment the coach wrote while working out what to say next, and
 * deliberately did not apply.
 *
 * The asymmetry with the mind amendment is the design, not an oversight. The
 * mind is written by `suggestMove` itself, because it is nobody's field and
 * there is no caller to merge it. A profile is a field of the record, its merge
 * belongs to whoever owns the record, and — the part that actually decides it —
 * the user is the editor of these two documents. A rebuild is something they
 * asked for; an amendment arriving as a side effect of "what do I say next" is
 * not, and would rewrite the page they were reading with no diff and no undo.
 *
 * So it is stored, unapplied, on the suggestion that produced it, and rides the
 * advice turn into the record. `appliedAt` is what makes the offer survive a
 * reload in whichever state the user left it.
 */
export interface ProfileProposal {
  /** Whose document: the person, or the user in this connection. */
  target: 'them' | 'me'
  update: ProfileUpdate
  /** When the user accepted it. Absent while the offer still stands. */
  appliedAt?: number
}

/** Output of "what should I say or do". */
export interface Suggestion extends TurnBasis {
  id: string
  generatedAt: number
  /** Optional situation the user typed in alongside the request. */
  question?: string
  read: string
  priority: string
  options: SuggestionOption[]
  avoid: string[]
  timing: string
  honest_note: string
  /**
   * Durable facts worth remembering from this run's web research (if any) —
   * "Cafe Lumen closes 9pm Sundays", "confirmed: landscape architect at Studio
   * Verde per their site". Merged into the record's `researchNotes` so the
   * next call can reuse them instead of re-searching. Empty when no research
   * ran or nothing was worth keeping.
   */
  research_notes: string[]
  /**
   * An amendment to one of the two profiles, offered rather than applied.
   * Absent on most runs, which is the correct answer on most runs.
   */
  profile?: ProfileProposal
}
