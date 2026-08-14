import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** The hover lift — only for cards that are themselves a link or target. */
  interactive?: boolean
}

export function Card({ className, interactive, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface shadow-md',
        interactive &&
          'transition duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg',
        className,
      )}
      {...rest}
    />
  )
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-border px-5 py-3.5', className)} {...rest} />
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...rest} />
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-border bg-surface-sunken px-5 py-3',
        className,
      )}
      {...rest}
    />
  )
}

/** Dark counterweight panel, carrying its own faint grid. */
export function CardInvert({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-ink-700 bg-ink text-white',
        className,
      )}
      {...rest}
    >
      <div className="grid-bg-invert pointer-events-none absolute inset-0 opacity-[0.12]" />
      <div className="relative">{children}</div>
    </div>
  )
}

/** Mono uppercase micro-label. Tracking/size pairing lives in index.css. */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('eyebrow', className)} {...rest} />
}

/** Numbered section rule — "001 ──── Their context ──────── REBUILT 2H AGO". */
export function SectionHead({
  n,
  title,
  meta,
  className,
}: {
  n?: string
  title: string
  meta?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline gap-3.5', className)}>
      {n ? <Eyebrow className="text-[12px]! font-bold">{n}</Eyebrow> : null}
      <h2 className="text-[17px] font-bold tracking-[-0.03em] text-fg">{title}</h2>
      <span className="h-px flex-1 bg-border" />
      {meta ? <Eyebrow className="text-[10px]!">{meta}</Eyebrow> : null}
    </div>
  )
}

export type ChipTone = 'neutral' | 'live' | 'idle' | 'yes' | 'warn' | 'no' | 'action'

const chipTones: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface text-fg-2',
  live: 'border-status-300 bg-status-soft text-status-700',
  idle: 'border-border bg-surface text-fg-3',
  yes: 'border-yes/40 bg-yes-soft text-yes-strong',
  warn: 'border-warn/40 bg-warn-soft text-warn-strong',
  no: 'border-no/40 bg-no-soft text-no-strong',
  action: 'border-action-300 bg-action-soft text-action-700',
}

export function Chip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: ChipTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        // `shrink-0 whitespace-nowrap` because a pill that wraps stops reading as
        // one — it becomes a tall lozenge with a word on each line. As a flex
        // item a chip is shrinkable by default, so any long sibling in the same
        // row squeezes it, and the label beside it is model-written and
        // arbitrarily long. Chips are short by construction; none of them wants
        // to break.
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        chipTones[tone],
        className,
      )}
    >
      {tone === 'live' || tone === 'idle' ? (
        <span
          className={cn(
            'h-1.5 w-1.5 flex-none rounded-full',
            tone === 'live' ? 'dot-live' : 'dot-idle',
          )}
        />
      ) : null}
      {children}
    </span>
  )
}

/** Confidence is part of every claim, so it gets its own consistent mark. */
export function ConfidenceMark({ level }: { level: 'high' | 'medium' | 'low' }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle"
      role="img"
      aria-label={`${level} confidence`}
      title={`${level} confidence`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            'h-1 w-2.5 rounded-full',
            i < filled ? 'bg-status-300' : 'bg-neutral-200',
          )}
        />
      ))}
    </span>
  )
}
