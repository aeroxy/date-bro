import type { PersonContext, SelfContext, Suggestion } from './coach'

export type Speaker = 'them' | 'me'
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
}

/** The three coach engines — also the three tabs in the UI. */
export type Engine = 'them' | 'me' | 'next'

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
  stage: Stage
  meta: {
    age?: string
    pronouns?: string
    howWeMet?: string
    location?: string
    since?: string
  }
  /** What the user knows about them. Free text — the seed for everything. */
  seedThem: string
  /** The user's own profile, as it relates to *this* person. */
  seedMe: string
  /** What the user wants out of this. */
  goal: string
  turns: Turn[]
  themContext?: PersonContext
  meContext?: SelfContext
  suggestions: Suggestion[]
  /**
   * Durable facts accumulated from web research across suggestion runs — see
   * `Suggestion.research_notes`. Fed back into every prompt so the coach isn't
   * re-searching the same claim on every call. Free text so the user can edit
   * or wipe it directly, same as the seed contexts.
   */
  researchNotes: string
  /**
   * What the user has said back to each engine, oldest first. Every note is fed
   * into every later run of that engine, so a correction sticks instead of
   * having to be re-typed on each rebuild.
   */
  feedback: Record<Engine, string[]>
}

export function newDate(name: string): DateRecord {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    stage: 'talking',
    meta: {},
    seedThem: '',
    seedMe: '',
    goal: '',
    turns: [],
    suggestions: [],
    researchNotes: '',
    feedback: { them: [], me: [], next: [] },
  }
}
