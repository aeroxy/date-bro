import { useEffect, useRef, useState } from 'react'
import { Check, Copy, FilePen, MessageSquare, Send, Zap } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { ProfileProposal, Suggestion, SuggestionOption } from '@/types/coach'
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
      {/*
        `items-start`, not center: the label is model-written and wraps to two
        lines often enough, and centring then floats the number, the icon and the
        chip into the gap between them. Everything on this row aligns to the
        first line instead. `min-w-0` on the label is what lets it wrap at all —
        a flex item's min-width is its content by default, so without it a long
        label refuses to shrink and squeezes its siblings instead. It also
        replaces the old `flex-1` spacer, since a label that grows pushes the
        chip to the right on its own.
      */}
      <div className="flex items-start gap-2 border-b border-border px-3.5 py-2">
        <Eyebrow className="mt-[3px] shrink-0 text-[10px]!">
          {String(index + 1).padStart(2, '0')}
        </Eyebrow>
        <span className="flex min-w-0 flex-1 items-start gap-1.5 text-pretty text-[13px] font-bold tracking-[-0.01em] text-fg">
          {isMessage ? (
            <MessageSquare size={12} className="mt-[3px] shrink-0 text-fg-3" />
          ) : (
            <Zap size={12} className="mt-[3px] shrink-0 text-fg-3" />
          )}
          {option.label}
        </span>
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

/**
 * What the coach wants to change, in one line the user can decide on without
 * opening the document.
 *
 * Headings, not content. The amendment is a few hundred words of markdown and
 * rendering it here would put a second profile inside the advice; the honest
 * summary of "I learned something about you" is which part of which document it
 * lands in, and the document itself is one tab away.
 */
function proposalSummary(proposal: ProfileProposal): string {
  const whose = proposal.target === 'them' ? 'their profile' : 'your profile'
  const headings = [
    ...new Set((proposal.update.sections ?? []).map((s) => s.heading.trim()).filter(Boolean)),
  ]
  if (!headings.length) return `Rewrite ${whose}`
  return `Update ${headings.map((h) => `“${h}”`).join(', ')} in ${whose}`
}

/**
 * The one thing on this card that writes to something other than the transcript,
 * so it is the one thing that asks first.
 *
 * Bottom of the card, quietly. The drafts are what the user opened the app for;
 * an offer to amend a profile is worth surfacing and not worth interrupting them
 * with, and putting it above the options would give the smaller thing the louder
 * position.
 */
function ProposalCard({
  proposal,
  label,
  stale,
  busy,
  undoable,
  onApply,
  onUndo,
}: {
  proposal: ProfileProposal
  /**
   * Whether this card carries the group's eyebrow. A turn can offer one card per
   * document, and "Also learned" over each of two stacked cards reads as two
   * findings that happen to share a name rather than as one thing the run
   * noticed. The first card wears it for the pair.
   */
  label?: boolean
  /** The target document moved on after this was written — see `applyProposal`. */
  stale?: boolean
  /**
   * A rebuild of the document this amends is running. It writes that profile
   * whole, from the record it started with, so an apply landing underneath it is
   * overwritten a moment later while this card still reads "Applied".
   */
  busy?: boolean
  /**
   * The amendment is in the document and can still be taken back cleanly — see
   * `proposalState`. False once anything else has written that profile, because
   * the snapshot would then be restored over work it never saw.
   */
  undoable?: boolean
  onApply?: () => void
  onUndo?: () => void
}) {
  const applied = !!proposal.appliedAt
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-dashed border-border-strong bg-surface-sunken px-3.5 py-2.5">
      <FilePen size={13} className="mt-[3px] shrink-0 text-fg-3" />
      <div className="min-w-0 flex-1">
        {label ? <Eyebrow className="block">Also learned</Eyebrow> : null}
        <p className="mt-0.5 text-pretty text-[12.5px] leading-relaxed text-fg-2">
          {proposalSummary(proposal)}
        </p>
      </div>
      {applied ? (
        // Stated, not asked. The amendment is already in the document — this
        // says so and offers the way back, which is what the click used to buy
        // and this buys without costing the finding when nobody clicks.
        <span className="inline-flex shrink-0 items-center gap-1 py-1 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1 px-1 text-yes">
            <Check size={12} /> Applied
          </span>
          {undoable && onUndo ? (
            <>
              <span className="text-fg-3 opacity-50">·</span>
              <button
                onClick={onUndo}
                title="Puts the profile back exactly as it was. The offer stays here if you change your mind."
                className="rounded-md px-1.5 py-0.5 font-semibold text-fg-3 transition hover:bg-surface-muted hover:text-fg"
              >
                Undo
              </button>
            </>
          ) : null}
        </span>
      ) : busy && !stale ? (
        // Waiting, not refused: the rebuild finishing is what decides which of
        // the two this becomes, and it usually makes it stale.
        <span
          className="shrink-0 px-2 py-1 text-[11px] font-semibold text-fg-3"
          title="A rebuild of that profile is running and would overwrite this. It'll be applicable again — or superseded — once that finishes."
        >
          Rebuilding…
        </span>
      ) : stale || !onApply ? (
        // Not hidden. The coach did notice something, and saying why it can't be
        // taken is more use than an offer that quietly disappears.
        <span
          className="shrink-0 px-2 py-1 text-[11px] font-semibold text-fg-3"
          title="The profile changed after this was written, so this amendment may no longer fit. Rebuild instead."
        >
          Profile moved on
        </span>
      ) : (
        <button
          onClick={onApply}
          title="Writes this into the profile. Nothing else about it changes."
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-fg-3 transition hover:bg-surface-muted hover:text-fg"
        >
          Apply
        </button>
      )}
    </div>
  )
}

export function SuggestionView({
  suggestion,
  sent,
  onSend,
  proposalState,
  onApplyProposal,
  onUndoProposal,
}: {
  suggestion: Suggestion
  /** Draft texts already in the conversation as turns of the user's. */
  sent?: Set<string>
  onSend?: (draft: string) => void
  /** Whether each offer can be taken right now — see `proposalState` in the app. */
  proposalState?: (proposal: ProfileProposal) => {
    stale: boolean
    busy: boolean
    undoable: boolean
  }
  onApplyProposal?: (target: 'them' | 'me') => void
  onUndoProposal?: (target: 'them' | 'me') => void
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

      {/* One card each, in the order the run wrote them — the person first,
          because that is the one a turn is usually about. Stacked close, and
          stacked rather than merged: they are two decisions, and a single Apply
          would make taking the useful one cost accepting the other. */}
      {suggestion.profiles?.length ? (
        <div className="space-y-2">
          {suggestion.profiles.map((proposal, i) => {
            // Asked once. The two answers are decided together — a rebuild in
            // flight is the reason a card is busy *and* the reason it is about
            // to be stale — so calling per prop would ask the same question
            // twice and could, if the two calls ever straddled a state change,
            // get answers from different moments.
            const state = proposalState?.(proposal)
            return (
              <ProposalCard
                key={proposal.target}
                proposal={proposal}
                label={i === 0}
                stale={state?.stale}
                busy={state?.busy}
                undoable={state?.undoable}
                onApply={onApplyProposal && (() => onApplyProposal(proposal.target))}
                onUndo={onUndoProposal && (() => onUndoProposal(proposal.target))}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
