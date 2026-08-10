import { useState } from 'react'
import { CornerDownLeft, PencilLine, X } from 'lucide-react'

import { Button } from './ui/Button'
import { Eyebrow } from './ui/Card'
import { Textarea } from './ui/Field'
import { Spinner } from './ui/Spinner'

/** What one instruction did. Held in memory only — see `AskComposer`. */
export interface ProfileEdit {
  reply: string
  changed: string[]
}

/**
 * The result of the last instruction, shown once and then gone.
 *
 * Deliberately not persisted. The instruction's whole effect is already in the
 * profile above it, so keeping a log of instructions would store the same
 * information twice and re-send the redundant copy on every later request —
 * which is exactly what the seed blobs did, and what a pasted CV sitting in the
 * transcript still does.
 */
export function EditResult({ edit, onDismiss }: { edit: ProfileEdit; onDismiss: () => void }) {
  return (
    <div className="mt-3 flex gap-2.5 rounded-md border border-border bg-surface px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-relaxed text-fg-2">{edit.reply}</p>
        {edit.changed.length ? (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-fg-3">
            <PencilLine size={10} className="flex-none" />
            Updated {edit.changed.join(', ')}
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] italic text-fg-3">Nothing changed.</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 flex-none self-start rounded p-1 text-fg-3 transition hover:text-fg"
      >
        <X size={12} />
      </button>
    </div>
  )
}

/**
 * The footer box, on all three tabs. You type something, it runs, it isn't kept.
 *
 * One component because all three are now the same interaction — the differences
 * are copy and two optional extras. `next` used to be the odd one out twice
 * over: a standing note thread in this slot *and* a separate one-shot situation
 * field above the analysis, both feeding the same call. The thread went when the
 * coach's own document gave a standing preference somewhere better to live (it belongs to
 * the user, not to one person), and with it gone the two boxes had nothing left
 * to tell apart.
 *
 * Once a profile exists, `Rebuild` stays a separate button on Them and You
 * rather than folding in here: they do genuinely different things. An
 * instruction amends the prose and leaves the judgment — the interest read, the
 * flags — exactly as it was, because re-deciding where things stand off the back
 * of one remark is how a read starts drifting. A rebuild re-reads the whole
 * transcript and regenerates both.
 *
 * Before the first one there is no such distinction to draw, and this box used
 * to be disabled saying so — a dead control in the one place a new user looks to
 * say who these two people are. It runs the first rebuild instead, with what
 * they typed. Same one-shot contract either way: the text is read once and never
 * stored, and what survives is whatever the profile absorbed from it.
 */
export function AskComposer({
  label,
  placeholder,
  cta,
  hint,
  busy,
  needsText,
  edit,
  onDismiss,
  onSend,
}: {
  label: string
  placeholder: string
  cta: string
  /** Shown when the box is empty and usable — what happens to what you type. */
  hint: string
  busy: boolean
  /**
   * Whether the box has to have something in it. `next` runs on an empty one —
   * "what do I say?" is a complete request and the text is optional colour —
   * and Them/You have nothing to do without one, in both their states: no
   * instruction to apply, and no reason to seed a rebuild the header button
   * already runs on its own.
   */
  needsText?: boolean
  edit?: ProfileEdit | null
  onDismiss?: () => void
  /**
   * Resolves false when the run failed, and the box keeps what was typed.
   * `next`'s note used to be written to storage before the call for exactly this
   * reason — a network error shouldn't also eat the sentence that triggered it —
   * and nothing persists it now, so the guarantee has to live here instead.
   */
  onSend: (message: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')

  const ready = !busy && (!needsText || !!draft.trim())

  const send = () => {
    if (!ready) return
    void onSend(draft.trim()).then((sent) => {
      if (sent) setDraft('')
    })
  }

  return (
    <div className="flex-none border-t border-border bg-surface-sunken px-5 py-3">
      <Eyebrow className="mb-1.5 block">{label}</Eyebrow>
      <Textarea
        // `Eyebrow` is a span, so it names this box to the eye and to nothing
        // else. The label rather than the placeholder, which is example text.
        aria-label={label}
        rows={2}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
        }}
        placeholder={placeholder}
        className="text-[12.5px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-fg-3">{draft.trim() ? '⌘↵ to send' : hint}</span>
        <span className="flex-1" />
        <Button variant="accent" size="sm" disabled={!ready} onClick={send}>
          {busy ? <Spinner /> : <CornerDownLeft size={12} />}
          {cta}
        </Button>
      </div>
      {edit && onDismiss ? <EditResult edit={edit} onDismiss={onDismiss} /> : null}
    </div>
  )
}
