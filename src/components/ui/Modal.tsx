import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Eyebrow } from './Card'

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Focus moves in on open and back to whatever opened it on close. Deliberately
  // *not* a full focus trap — Tab can still reach the page behind, which is a
  // known limit rather than an oversight; the concrete bug it used to cause (the
  // profile draft saving onto whoever the rail switched to) is fixed by keying
  // the modal on the record instead.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => opener?.focus?.()
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-6 backdrop-blur-[2px]">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'my-8 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-lg',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            {eyebrow ? <Eyebrow className="block">{eyebrow}</Eyebrow> : null}
            <h2 id={titleId} className="text-[17px] font-bold tracking-[-0.02em]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-fg-3 transition hover:bg-surface-muted hover:text-fg"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="scroll-slim max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
