import type { PersonProfile, SelfProfile, Suggestion } from './coach'

/**
 * Two of these aren't speakers.
 *
 * `context` is an entry the user wrote *about* the conversation rather than in
 * it — something learned from a friend, a birthday, a fact nobody typed.
 *
 * `coach` is what this app advised, at the point it advised it. It rides here
 * for the same reason a note does, plus one more: advice kept in a parallel
 * list is advice no later run can see. In the pool it sits directly above
 * whatever the user did next, which is the only evidence that exists about
 * whether it worked.
 *
 * Both are in `turns` because the transcript is the context pool: one
 * chronology, one thing to cite, and an entry lands in the position it belongs
 * rather than in a side channel with its own ordering rules. Both are excluded
 * from `transcriptStats`, which counts what each side actually said.
 */
export type Speaker = 'them' | 'me' | 'context' | 'coach'
export type Channel = 'text' | 'call' | 'irl'

export interface Turn {
  id: string
  speaker: Speaker
  text: string
  /** Free-form, user-entered. "Tue 9pm", "next morning", "2026-07-14". */
  at?: string
  channel?: Channel
  /** The user's own annotation — tone, body language, what they left out. */
  note?: string
  /**
   * `context` entries only: the question this answers, when it came from an
   * engine's `open_questions` rather than from a blank composer. Kept beside the
   * answer instead of folded into `text` because it's what makes a three-word
   * reply self-contained — "she's free next weekend" means nothing until you
   * know it was answering "does she want to meet in person". It also tells the
   * UI which questions have been dealt with, so nothing has to track that
   * separately.
   */
  asked?: string
  /**
   * `coach` entries only: the whole suggestion this line is the summary of.
   *
   * Stored on the turn rather than in a list the turn points at, because the
   * advice *is* the turn — one delete removes both, and there is no id left to
   * dangle. It replaced `DateRecord.suggestions`, which was a parallel history
   * with its own pills, its own cap and its own delete button, all describing a
   * timeline the conversation was already keeping.
   *
   * **Never reaches the model.** `formatTurn` renders `text` and nothing else,
   * so the panel gets three drafts and the prompt gets two lines. Putting the
   * whole generation in the transcript is the mistake this codebase keeps
   * making — see the note on `themProfile` below.
   */
  advice?: Suggestion
}

/** The three coach engines — also the three tabs in the UI. */
export type Engine = 'them' | 'me' | 'next'

/** The two engines whose profile you can chat with. */
export type ChatEngine = 'them' | 'me'

export type Stage = 'matched' | 'talking' | 'dating' | 'exclusive' | 'paused' | 'ended'

export const STAGES: { value: Stage; label: string }[] = [
  { value: 'matched', label: 'Just matched' },
  { value: 'talking', label: 'Talking' },
  { value: 'dating', label: 'Dating' },
  { value: 'exclusive', label: 'Exclusive' },
  { value: 'paused', label: 'On pause' },
  { value: 'ended', label: 'Ended' },
]

export interface DateRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /**
   * Stamped only when `turns` changes — not on any other write. Staleness is a
   * statement about the transcript, so it can't be read off `updatedAt`, which
   * every mutation bumps (rebuilding the other tab, saving the profile, adding
   * a feedback note). Compared against a context's `turnsAt` — see `isStale`.
   */
  turnsUpdatedAt: number
  stage: Stage
  meta: {
    /**
     * ISO `YYYY-MM-DD`. The *age* is derived at the moment of a request — see
     * `lib/birthday.ts`.
     *
     * This replaced `age`, a free-text number, which was wrong the moment it was
     * written: a record here is read on every call for months, so a stored "28"
     * quietly becomes a lie and nothing ever corrects it. The birthday is the
     * fact; the age is a view of it, and so is "her birthday is in nine days",
     * which the old field couldn't express at all.
     */
    birthday?: string
    /**
     * Retired, and still rendered when there is no `birthday` — with the date it
     * was recorded, so the model can see how stale it is rather than reading a
     * years-old number as current. Cleared when a birthday is set.
     */
    age?: string
    pronouns?: string
    howWeMet?: string
    location?: string
    since?: string
  }
  /**
   * What the user wants out of this. The one standing free-text field left, and
   * deliberately not "seed": it's a directive about what the coach optimises
   * for, not a claim about the world, so nothing about it goes stale as the
   * conversation moves. Everything the user *knows* lives in `turns` instead.
   */
  goal: string
  turns: Turn[]
  /**
   * What the coach knows about each of them: markdown the rebuild engines amend
   * section by section rather than regenerate, plus the small structured
   * judgment that prose can't carry. Absent until the first rebuild — the
   * transcript and the user's own notes are all that exists until then.
   *
   * These replaced `themContext` / `meContext`, which were fixed schemas rebuilt
   * from zero every time. Records written before the change are migrated on read
   * in `lib/db.ts`.
   *
   * Amending one is a **one-shot command**: the user says what to change, the
   * model changes it, and the instruction is not kept. There is nothing to keep
   * — the whole effect of it is already in `markdown`, and a log of orders given
   * about a document is not part of the document. This is the rule the seed
   * blobs and the pasted-CV note both broke: once a thing has been absorbed the
   * raw input is redundant, and keeping it means paying for it on every request
   * forever.
   */
  themProfile?: PersonProfile
  meProfile?: SelfProfile
  /**
   * Retired. Suggestions live on their own `coach` turn now (`Turn.advice`), in
   * the position they were given. Kept on the type only so records written
   * before that can still be read; nothing writes it and nothing reads it into
   * a prompt. Safe to purge — see `refs/purge-legacy.js`.
   */
  suggestions?: Suggestion[]
  /**
   * Durable facts accumulated from web research across suggestion runs — see
   * `Suggestion.research_notes`. Fed back into every prompt so the coach isn't
   * re-searching the same claim on every call. Free text so the user can edit
   * or wipe it directly, same as the seed contexts.
   */
  researchNotes: string
  // `feedback: Record<Engine, string[]>` was here — a standing note per engine,
  // re-sent on every later run of it. Them and You lost theirs when amending a
  // profile became a one-shot instruction; `next` kept its own because a
  // preference about drafts ("stop suggesting bars") had nowhere else to live
  // and re-typing it every run was worse.
  //
  // It has somewhere now. That kind of note is a standing fact about the *user*,
  // not about this person, so it belongs in the coach itself, where it applies to
  // everyone they're seeing rather than only to whichever record it was typed
  // under. Old records still carry the field; nothing reads it.
}

export function newDate(name: string): DateRecord {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    turnsUpdatedAt: now,
    stage: 'talking',
    meta: {},
    goal: '',
    turns: [],
    researchNotes: '',
  }
}
