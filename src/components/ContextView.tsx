import { useState, type ReactNode } from 'react'
import { CornerDownLeft } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { Flag, PersonProfile, SelfProfile } from '@/types/coach'
import { Markdown } from './Markdown'
import { Chip, Eyebrow, SectionHead } from './ui/Card'
import { Input } from './ui/Field'

/** What the caller needs to make the open questions answerable. */
export interface AnswerProps {
  /** Questions already answered — they drop off the list until the next rebuild. */
  answered: Set<string>
  onAnswer: (question: string, answer: string) => void
  disabled?: boolean
}

/**
 * The engines already end every run by naming what they don't know. That list
 * used to be something to read and forget; here each line is a question you can
 * answer in a few words, and the answer goes straight into the conversation as a
 * note carrying the question with it.
 *
 * Which is the point: answering "what does she do for work" can't be filed under
 * the wrong person, and a three-word reply is a much lower bar than an empty
 * box. Nothing tracks which questions are done — a question disappears when a
 * turn exists that answers it, and the whole list is replaced on the next
 * rebuild anyway, by which point the answer is in the material.
 */
function OpenQuestions({ items, answer }: { items: string[]; answer?: AnswerProps }) {
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (!items?.length) return <Empty />
  const pending = answer ? items.filter((q) => !answer.answered.has(q)) : items
  if (!pending.length) return <Empty>All answered — rebuild to see what's still missing.</Empty>

  const submit = (question: string) => {
    const value = draft.trim()
    if (!value) return
    answer?.onAnswer(question, value)
    setDraft('')
    setOpen(null)
  }

  return (
    <ul className="space-y-1.5">
      {pending.map((item) => (
        <li key={item} className="text-[12.5px] leading-relaxed text-fg-2">
          <div className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-neutral-300" />
            {answer ? (
              <button
                onClick={() => {
                  setOpen(open === item ? null : item)
                  setDraft('')
                }}
                disabled={answer.disabled}
                className="min-w-0 flex-1 text-left transition hover:text-action disabled:cursor-not-allowed disabled:hover:text-fg-2"
                title="Answer this"
              >
                {item}
              </button>
            ) : (
              <span>{item}</span>
            )}
          </div>
          {answer && open === item ? (
            <div className="mt-1.5 flex items-center gap-1.5 pl-3">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit(item)
                  if (e.key === 'Escape') setOpen(null)
                }}
                placeholder="a few words is plenty — or what you'd say out loud"
                className="h-8 flex-1 text-[12.5px]"
              />
              <button
                onClick={() => submit(item)}
                disabled={!draft.trim()}
                className="rounded-md p-1.5 text-fg-3 transition hover:bg-surface-muted hover:text-action disabled:opacity-40"
                title="Add as a note"
              >
                <CornerDownLeft size={13} />
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function Block({ title, n, children }: { title: string; n: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <SectionHead n={n} title={title} />
      {children}
    </section>
  )
}

/**
 * The profile itself. Nothing here knows what sections exist — the model owns
 * the structure, so the view renders whatever headings it finds. A section added
 * because this particular connection needed one appears without any code change,
 * which was the whole reason for leaving the schema behind.
 */
function ProfileBody({ markdown }: { markdown: string }) {
  if (!markdown.trim()) {
    return <Empty>Nothing written down yet — rebuild once there's some conversation.</Empty>
  }
  return <Markdown>{markdown}</Markdown>
}

function Bullets({ items, tone }: { items: string[]; tone?: 'yes' | 'no' | 'plain' }) {
  if (!items?.length) return <Empty />
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-fg-2">
          <span
            className={cn(
              'mt-1.5 h-1 w-1 flex-none rounded-full',
              tone === 'yes' ? 'bg-yes' : tone === 'no' ? 'bg-no' : 'bg-neutral-300',
            )}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Empty({ children }: { children?: ReactNode }) {
  return <p className="text-[12.5px] italic text-fg-3">{children ?? 'Nothing here yet.'}</p>
}

/** The one thing the user might not want to hear gets its own visual weight. */
function HonestNote({ children }: { children: ReactNode }) {
  if (!children || (typeof children === 'string' && !children.trim())) return null
  return (
    <div className="rounded-md border border-action-300 bg-action-soft px-3.5 py-2.5">
      <Eyebrow className="block text-action-700/70!">Straight with you</Eyebrow>
      <p className="mt-1 text-[13px] leading-relaxed text-fg">{children}</p>
    </div>
  )
}

const INTEREST_TONE = {
  strong: 'yes',
  warm: 'yes',
  // Neutral, not amber: "too early" is the ordinary state of a new thread, and
  // colouring it as a warning is the thing that made this read as doom.
  'too-early': 'neutral',
  ambiguous: 'warn',
  cooling: 'warn',
  'not-interested': 'no',
} as const

const FLAG_TONE: Record<Flag['kind'], 'yes' | 'warn' | 'no'> = {
  green: 'yes',
  amber: 'warn',
  red: 'no',
}

/**
 * Both views are the same three things now: the headline, the structured
 * judgment, and the profile as prose.
 *
 * What used to be here was nine hand-built blocks per view, each bound to one
 * field of a schema. That is the coupling this redesign removed — a section the
 * model decided this connection needed had nowhere to render, so it had nowhere
 * to be written down. The judgment kept its own rendering precisely because it
 * is *not* prose: an interest level is a chip, and a list of open questions is a
 * list of things to answer in a few words.
 */
export function PersonContextView({
  ctx,
  name,
  answer,
}: {
  ctx: PersonProfile
  name: string
  answer?: AnswerProps
}) {
  const { interest_read, flags, open_questions } = ctx.judgment

  return (
    <div className="space-y-6">
      <p className="text-[14px] leading-relaxed text-fg">{ctx.judgment.headline}</p>

      <Block n="001" title="Where they stand">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={INTEREST_TONE[interest_read.level] ?? 'neutral'}>
            {interest_read.level.replace('-', ' ')}
          </Chip>
          <span className="text-[11px] text-fg-3">confidence: {interest_read.confidence}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Eyebrow className="mb-1.5 block">Pointing yes</Eyebrow>
            <Bullets items={interest_read.signals_for} tone="yes" />
          </div>
          <div>
            <Eyebrow className="mb-1.5 block">Pointing no</Eyebrow>
            <Bullets items={interest_read.signals_against} tone="no" />
          </div>
        </div>
        <HonestNote>{interest_read.honest_note}</HonestNote>
      </Block>

      {flags?.length ? (
        <Block n="002" title="Flags">
          <ul className="space-y-2">
            {flags.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <Chip tone={FLAG_TONE[f.kind]}>{f.kind}</Chip>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug text-fg">{f.label}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-fg-3">{f.evidence}</p>
                </div>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block n="003" title={`What you know about ${name}`}>
        <ProfileBody markdown={ctx.markdown} />
      </Block>

      <Block n="004" title={`What you still don't know about ${name}`}>
        <OpenQuestions items={open_questions} answer={answer} />
      </Block>
    </div>
  )
}

export function SelfContextView({ ctx, answer }: { ctx: SelfProfile; answer?: AnswerProps }) {
  const { goal_read, open_questions } = ctx.judgment

  return (
    <div className="space-y-6">
      <p className="text-[14px] leading-relaxed text-fg">{ctx.judgment.headline}</p>

      <Block n="001" title="You, in this one">
        <ProfileBody markdown={ctx.markdown} />
      </Block>

      <Block n="002" title="What you're actually after">
        <div className="space-y-2 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
          <div>
            <Eyebrow className="block">You said</Eyebrow>
            <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{goal_read?.stated}</p>
          </div>
          <div>
            <Eyebrow className="block">Your messages say</Eyebrow>
            <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{goal_read?.revealed}</p>
          </div>
        </div>
        <HonestNote>{goal_read?.tension}</HonestNote>
      </Block>

      <Block n="003" title="Worth getting clear on">
        <OpenQuestions items={open_questions} answer={answer} />
      </Block>
    </div>
  )
}
