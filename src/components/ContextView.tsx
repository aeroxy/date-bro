import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'
import type { Claim, Flag, PersonContext, SelfContext } from '@/types/coach'
import { Chip, ConfidenceMark, Eyebrow, SectionHead } from './ui/Card'

function Block({ title, n, children }: { title: string; n: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <SectionHead n={n} title={title} />
      {children}
    </section>
  )
}

function ClaimList({ claims }: { claims: Claim[] }) {
  if (!claims?.length) return <Empty />
  return (
    <ul className="space-y-2.5">
      {claims.map((c, i) => (
        <li key={i} className="rounded-md border border-border bg-surface px-3.5 py-2.5 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-fg">{c.claim}</p>
            <ConfidenceMark level={c.confidence} />
          </div>
          {c.evidence ? (
            <p className="mt-1.5 border-l-2 border-neutral-200 pl-2.5 text-[12px] leading-relaxed text-fg-3">
              {c.evidence}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  )
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

function Empty() {
  return <p className="text-[12.5px] italic text-fg-3">Nothing here yet.</p>
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
  ambiguous: 'warn',
  cooling: 'warn',
  'not-interested': 'no',
} as const

const FLAG_TONE: Record<Flag['kind'], 'yes' | 'warn' | 'no'> = {
  green: 'yes',
  amber: 'warn',
  red: 'no',
}

export function PersonContextView({ ctx, name }: { ctx: PersonContext; name: string }) {
  const attachment = ctx.communication_style?.attachment_hypothesis

  return (
    <div className="space-y-6">
      <p className="text-[14px] leading-relaxed text-fg">{ctx.headline}</p>

      <Block n="001" title="Where they stand">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={INTEREST_TONE[ctx.interest_read.level] ?? 'neutral'}>
            {ctx.interest_read.level.replace('-', ' ')}
          </Chip>
          <span className="text-[11px] text-fg-3">
            confidence: {ctx.interest_read.confidence}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Eyebrow className="mb-1.5 block">Pointing yes</Eyebrow>
            <Bullets items={ctx.interest_read.signals_for} tone="yes" />
          </div>
          <div>
            <Eyebrow className="mb-1.5 block">Pointing no</Eyebrow>
            <Bullets items={ctx.interest_read.signals_against} tone="no" />
          </div>
        </div>
        <HonestNote>{ctx.interest_read.honest_note}</HonestNote>
      </Block>

      {ctx.flags?.length ? (
        <Block n="002" title="Flags">
          <ul className="space-y-2">
            {ctx.flags.map((f, i) => (
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

      <Block n="003" title="Who they are">
        <ClaimList claims={ctx.who_they_are} />
      </Block>

      <Block n="004" title="What they care about">
        <ClaimList claims={ctx.what_they_care_about} />
      </Block>

      <Block n="005" title="Right now">
        <ClaimList claims={ctx.current_situation} />
      </Block>

      <Block n="006" title="How they talk">
        <p className="text-[13px] leading-relaxed text-fg-2">{ctx.communication_style?.summary}</p>
        {attachment ? (
          <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>Attachment — a guess, not a label</Eyebrow>
              <ConfidenceMark level={attachment.confidence} />
            </div>
            <p className="mt-1.5 text-[13px] font-semibold text-fg">
              {attachment.pattern.replace('-', ' ')}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-fg-3">{attachment.evidence}</p>
          </div>
        ) : null}
        {ctx.communication_style?.bids?.length ? (
          <>
            <Eyebrow className="mt-3 mb-1.5 block">Bids they made</Eyebrow>
            <Bullets items={ctx.communication_style.bids} />
          </>
        ) : null}
      </Block>

      {ctx.sensitivities?.length ? (
        <Block n="007" title="Handle with care">
          <Bullets items={ctx.sensitivities} tone="no" />
        </Block>
      ) : null}

      {ctx.open_threads?.length ? (
        <Block n="008" title="Threads you can pick back up">
          <Bullets items={ctx.open_threads} />
        </Block>
      ) : null}

      <Block n="009" title={`What you still don't know about ${name}`}>
        <Bullets items={ctx.open_questions} />
      </Block>
    </div>
  )
}

export function SelfContextView({ ctx }: { ctx: SelfContext }) {
  return (
    <div className="space-y-6">
      <p className="text-[14px] leading-relaxed text-fg">{ctx.headline}</p>

      <Block n="001" title="How you're landing">
        <ClaimList claims={ctx.how_you_come_across} />
      </Block>

      {ctx.patterns?.length ? (
        <Block n="002" title="Patterns">
          <ul className="space-y-2.5">
            {ctx.patterns.map((p, i) => (
              <li
                key={i}
                className="rounded-md border border-border bg-surface px-3.5 py-2.5 shadow-xs"
              >
                <p className="text-[13px] font-medium leading-snug text-fg">{p.pattern}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-fg-3">{p.evidence}</p>
                <p className="mt-1.5 border-l-2 border-action-300 pl-2.5 text-[12.5px] leading-relaxed text-fg-2">
                  {p.effect}
                </p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block n="003" title="Working">
        <Bullets items={ctx.working} tone="yes" />
      </Block>

      <Block n="004" title="Costing you">
        <Bullets items={ctx.costing_you} tone="no" />
      </Block>

      <Block n="005" title="Your voice">
        <p className="text-[13px] leading-relaxed text-fg-2">{ctx.your_voice?.summary}</p>
        <div className="flex flex-wrap gap-1.5">
          {ctx.your_voice?.markers?.map((m, i) => (
            <Chip key={i}>{m}</Chip>
          ))}
        </div>
        <p className="text-[11.5px] leading-relaxed text-fg-3">
          Drafts get written to sound like this.
        </p>
      </Block>

      <Block n="006" title="What they know about you">
        <Bullets items={ctx.you_have_revealed} />
      </Block>

      <Block n="007" title="What you're actually after">
        <div className="space-y-2 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
          <div>
            <Eyebrow className="block">You said</Eyebrow>
            <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{ctx.goal_read?.stated}</p>
          </div>
          <div>
            <Eyebrow className="block">Your messages say</Eyebrow>
            <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{ctx.goal_read?.revealed}</p>
          </div>
        </div>
        <HonestNote>{ctx.goal_read?.tension}</HonestNote>
      </Block>

      <Block n="008" title="Worth getting clear on">
        <Bullets items={ctx.open_questions} />
      </Block>
    </div>
  )
}
