import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
}

interface SelectProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  className?: string
  placeholder?: string
}

/**
 * A styled stand-in for `<select>` — native dropdowns render with the OS's own
 * chrome (varies by platform, can't be restyled past a point), which reads as
 * a jarring foreign element against the rest of the design system. This keeps
 * every visual property (border, radius, focus ring) under our control.
 */
export function Select<T extends string>({ value, onChange, options, className, placeholder }: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // A div-and-buttons control has no semantics of its own, so it has to say what
  // it is — otherwise nothing but sighted-mouse use works.
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={cn(
          'flex h-[38px] w-full items-center justify-between gap-2 rounded-md border border-border ' +
            'bg-surface px-3 text-left text-sm text-fg transition cursor-pointer ' +
            'focus:outline-none focus:border-action focus:shadow-focus',
          open && 'border-action shadow-focus',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-fg-3')}>
          {selected ? selected.label : (placeholder ?? 'Select…')}
        </span>
        <ChevronDown size={14} className={cn('flex-none text-fg-3 transition', open && 'rotate-180')} />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="scroll-slim absolute z-20 mt-1 max-h-64 w-full min-w-max overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition',
                  o.value === value
                    ? 'bg-action-soft text-action-700'
                    : 'text-fg-2 hover:bg-surface-muted hover:text-fg',
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value ? <Check size={13} className="flex-none" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
