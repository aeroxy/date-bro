import { useState } from 'react'
import { ChevronDown, CornerDownLeft, X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Button } from './ui/Button'
import { Eyebrow } from './ui/Card'
import { Textarea } from './ui/Field'
import { Spinner } from './ui/Spinner'

/**
 * The user's side of the conversation with one engine. Notes persist on the
 * record and go into every later run of that engine, so this is a standing
 * correction list, not a one-shot prompt — hence the × on each note being the
 * only way one leaves.
 */
export function FeedbackThread({
  notes,
  busy,
  placeholder,
  onRemove,
  onSend,
}: {
  notes: string[]
  busy: boolean
  placeholder: string
  onRemove: (index: number) => void
  onSend: (note: string) => void
}) {
  const [draft, setDraft] = useState('')
  // The thread only grows, and this footer steals height from the analysis above
  // it — so past a couple of notes it collapses to one line, and the open list is
  // capped and scrolls inside itself. Footer cost stays flat no matter the count.
  const [open, setOpen] = useState(notes.length <= 2)

  const send = () => {
    onSend(draft.trim())
    setDraft('')
  }

  return (
    <div className="flex-none border-t border-border bg-surface-sunken px-5 py-3">
      {notes.length ? (
        <div className="mb-2.5">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex w-full items-center gap-2 text-left"
            title={open ? 'Hide your notes' : 'Show your notes'}
          >
            <Eyebrow>
              {notes.length} note{notes.length > 1 ? 's' : ''} to the analyst
            </Eyebrow>
            <span className="h-px flex-1 bg-border" />
            <ChevronDown
              size={12}
              className={cn('flex-none text-fg-3 transition', open && 'rotate-180')}
            />
          </button>
          {open ? (
            <ul className="scroll-slim mt-1.5 max-h-[124px] space-y-1 overflow-y-auto">
              {notes.map((note, i) => (
                <li
                  key={i}
                  className="group flex items-start gap-1.5 text-[12px] leading-relaxed text-fg-2"
                >
                  <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-neutral-300" />
                  <span className="min-w-0 flex-1 break-words">{note}</span>
                  {/* Hidden until hover, so it also has to appear on keyboard focus. */}
                  <button
                    onClick={() => onRemove(i)}
                    aria-label={`Drop note ${i + 1}`}
                    className="pointer-events-none mt-0.5 flex-none rounded p-0.5 text-fg-3 opacity-0 transition hover:text-no-strong focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                    title="Drop this note"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) send()
        }}
        placeholder={placeholder}
        className="text-[12.5px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-fg-3">
          {draft.trim() ? 'Kept for every rebuild from here on.' : 'Tell it what it got wrong.'}
        </span>
        <span className="flex-1" />
        <Button variant="accent" size="sm" disabled={busy} onClick={send}>
          {busy ? <Spinner /> : <CornerDownLeft size={12} />}
          {draft.trim() ? 'Send & regenerate' : 'Regenerate'}
        </Button>
      </div>
    </div>
  )
}
