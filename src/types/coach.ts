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

export type InterestLevel = 'strong' | 'warm' | 'ambiguous' | 'cooling' | 'not-interested'

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

/** Output of "rebuild their context". */
export interface PersonContext extends TurnBasis {
  generatedAt: number
  headline: string
  who_they_are: Claim[]
  what_they_care_about: Claim[]
  current_situation: Claim[]
  communication_style: {
    summary: string
    attachment_hypothesis: {
      pattern: AttachmentPattern
      evidence: string
      confidence: Confidence
    }
    bids: string[]
  }
  interest_read: {
    level: InterestLevel
    confidence: Confidence
    signals_for: string[]
    signals_against: string[]
    honest_note: string
  }
  flags: Flag[]
  sensitivities: string[]
  open_threads: string[]
  open_questions: string[]
}

/** Output of "rebuild my context". */
export interface SelfContext extends TurnBasis {
  generatedAt: number
  headline: string
  how_you_come_across: Claim[]
  your_voice: {
    summary: string
    markers: string[]
  }
  patterns: {
    pattern: string
    evidence: string
    effect: string
  }[]
  working: string[]
  costing_you: string[]
  you_have_revealed: string[]
  goal_read: {
    stated: string
    revealed: string
    tension: string
  }
  open_questions: string[]
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
}
