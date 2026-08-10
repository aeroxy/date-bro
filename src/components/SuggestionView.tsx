import { useEffect, useRef, useState } from 'react'
import { Check, Copy, MessageSquare, Send, Zap } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { Suggestion, SuggestionOption } from '@/types/coach'
import { Chip, Eyebrow, SectionHead } from './ui/Card'

const RISK_TONE = { low: 'yes', medium: 'warn', high: 'no' } as const

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
          // Rejects when the document isn't focused. Nothing to say about it —
          // the tick just doesn't appear, and the text is still on screen.
          .catch(() => {})
      }}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-fg-3 transition hover:bg-surface-muted hover:text-fg"
    >
      {copied ? <Check size={12} className="text-yes" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/**
 * Records a draft as sent, in one click, by appending it to the conversation as
 * a turn of the user's.
 *
 * This is the other half of putting advice in the pool. The coach line says what
 * was offered; the turn underneath says which of it was taken — and it costs the
 * user nothing, because entering what they sent is a step they were doing by
 * hand anyway, right after copying it.
 *
 * Messages only. An action isn't sendable text and doesn't belong in the
 * transcript as a message the user wrote; recording one is a NOTE, and a
 * different question.
 */
function SentButton({ done, onSend }: { done: boolean; onSend: () => void }) {
  // `done` comes back through the record — a write and a re-render away — so
  // two quick clicks both see it false and the same message lands in the
  // transcript twice. A ref, not state: it has to close the door in the same
  // tick the first click opens it.
  const fired = useRef(false)
  // ...and open it again once `done` has answered, because this instance
  // outlives the draft it fired for. The options are keyed by index, so clicking
  // a different COACH bubble swaps the suggestion underneath the same component
  // — and a ref left latched made "I sent this" silently dead for the rest of
  // the session. Guards only the same-tick double click, which is all it was for.
  useEffect(() => {
    fired.current = false
  }, [done])
  if (done) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-yes">
        <Check size={12} /> Sent
      </span>
    )
  }
  return (
    <button
      onClick={() => {
        if (fired.current) return
        fired.current = true
        onSend()
      }}
      title="Adds this to the conversation as a message from you"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-fg-3 transition hover:bg-surface-muted hover:text-fg"
    >
      <Send size={12} /> I sent this
    </button>
  )
}

function Option({
  option,
  index,
  sent,
  onSend,
}: {
  option: SuggestionOption
  index: number
  sent: boolean
  onSend?: (draft: string) => void
}) {
  const isMessage = option.kind === 'message'
  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
        <Eyebrow className="text-[10px]!">{String(index + 1).padStart(2, '0')}</Eyebrow>
        <span className="flex items-center gap-1.5 text-[13px] font-bold tracking-[-0.01em] text-fg">
          {isMessage ? (
            <MessageSquare size={12} className="text-fg-3" />
          ) : (
            <Zap size={12} className="text-fg-3" />
          )}
          {option.label}
        </span>
        <span className="flex-1" />
        <Chip tone={RISK_TONE[option.risk] ?? 'neutral'}>{option.risk} risk</Chip>
      </div>

      <div className="px-3.5 py-3">
        <div
          className={cn(
            'whitespace-pre-wrap rounded-md px-3.5 py-2.5 text-[13.5px] leading-relaxed',
            isMessage ? 'bg-ink text-white' : 'border border-dashed border-border-strong bg-surface-sunken text-fg',
          )}
        >
          {option.draft}
        </div>
        <div className="mt-1.5 flex justify-end gap-1">
          <CopyButton text={option.draft} />
          {isMessage && onSend ? (
            <SentButton done={sent} onSend={() => onSend(option.draft)} />
          ) : null}
        </div>

        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{option.why}</p>
        <div className="mt-2.5 border-l-2 border-status-300 pl-2.5">
          <Eyebrow className="block">Then</Eyebrow>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-2">{option.then}</p>
        </div>
      </div>
    </li>
  )
}

export function SuggestionView({
  suggestion,
  sent,
  onSend,
}: {
  suggestion: Suggestion
  /** Draft texts already in the conversation as turns of the user's. */
  sent?: Set<string>
  onSend?: (draft: string) => void
}) {
  return (
    <div className="space-y-6">
      {suggestion.question ? (
        <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
          <Eyebrow className="block">You asked</Eyebrow>
          <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{suggestion.question}</p>
        </div>
      ) : null}

      <p className="text-[14px] leading-relaxed text-fg">{suggestion.read}</p>

      <div className="rounded-lg border border-action-300 bg-action-soft px-4 py-3">
        <Eyebrow className="block text-action-700/70!">What matters most</Eyebrow>
        <p className="mt-1 text-[13.5px] font-medium leading-relaxed text-fg">
          {suggestion.priority}
        </p>
      </div>

      <section className="space-y-2.5">
        <SectionHead n="001" title="Your options" />
        <ol className="space-y-3">
          {suggestion.options.map((o, i) => (
            <Option
              key={i}
              option={o}
              index={i}
              sent={!!sent?.has(o.draft.trim())}
              onSend={onSend}
            />
          ))}
        </ol>
      </section>

      {suggestion.avoid?.length ? (
        <section className="space-y-2.5">
          <SectionHead n="002" title="Don't" />
          <ul className="space-y-1.5">
            {suggestion.avoid.map((a, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-fg-2">
                <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-no" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {suggestion.timing ? (
        <section className="space-y-2.5">
          <SectionHead n="003" title="Timing" />
          <p className="text-[12.5px] leading-relaxed text-fg-2">{suggestion.timing}</p>
        </section>
      ) : null}

      {suggestion.honest_note?.trim() ? (
        <div className="rounded-md border border-ink-700 bg-ink px-4 py-3 text-white">
          <Eyebrow className="block text-white/50!">Straight with you</Eyebrow>
          <p className="mt-1 text-[13px] leading-relaxed">{suggestion.honest_note}</p>
        </div>
      ) : null}
    </div>
  )
}
