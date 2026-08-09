import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Space left between the control and its list. */
const GAP = 4
/** The floor the list won't shrink below, and the ceiling it won't grow past. */
const MIN_HEIGHT = 96
const MAX_HEIGHT = 256

/**
 * How far the list can extend before something cuts it off.
 *
 * The viewport is not the answer on its own: this control appears in the
 * conversation composer, which sits at the bottom of an `overflow-hidden` app
 * shell, and inside a modal body that scrolls at `max-h-[70vh]`. Both clip an
 * absolutely-positioned child, so the nearest non-visible-overflow ancestors are
 * what actually bound the list — intersected, since any one of them can be the
 * tighter limit.
 */
function clipBounds(el: HTMLElement): { top: number; bottom: number } {
  let top = 0
  let bottom = window.innerHeight
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowY === 'visible' && style.overflowX === 'visible') continue
    const rect = node.getBoundingClientRect()
    top = Math.max(top, rect.top)
    bottom = Math.min(bottom, rect.bottom)
  }
  return { top, bottom }
}

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
  // Which way the list opens, and how tall it may be. Recomputed on every open
  // rather than fixed at `mt-1 max-h-64`, which put "In person" underneath the
  // window every single time the channel was changed — the composer is pinned to
  // the bottom of the app, so downward was never going to fit.
  const [drop, setDrop] = useState({ up: false, height: MAX_HEIGHT })
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // A div-and-buttons control has no semantics of its own, so it has to say what
  // it is — otherwise nothing but sighted-mouse use works.
  const listId = useId()

  // Before paint, so the list never renders in the wrong place first.
  useLayoutEffect(() => {
    const root = rootRef.current
    const list = listRef.current
    if (!open || !root || !list) return
    const rect = root.getBoundingClientRect()
    const bounds = clipBounds(root)
    const below = bounds.bottom - rect.bottom - GAP
    const above = rect.top - bounds.top - GAP
    // What the list would take if nothing were in its way. Measured rather than
    // assumed to be MAX_HEIGHT, or three options would flip upward any time the
    // control sat within 256px of the bottom — space it was never going to use.
    // `scrollHeight` covers padding but not the border, hence the 2.
    const wanted = Math.min(MAX_HEIGHT, list.scrollHeight + 2)
    // Down unless it genuinely doesn't fit and up is roomier — flipping a list
    // that had space anyway just moves it away from where the eye already is.
    const up = below < wanted && above > below
    const room = Math.floor(up ? above : below)
    // Never smaller than MIN_HEIGHT: if both sides are that tight the list has
    // to overlap something, and its own scrollbar is the lesser evil.
    setDrop({ up, height: Math.max(MIN_HEIGHT, Math.min(wanted, room)) })
  }, [open])

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
          ref={listRef}
          id={listId}
          role="listbox"
          style={{ maxHeight: drop.height }}
          className={cn(
            'scroll-slim absolute z-20 w-full min-w-max overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg',
            drop.up ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {options.map((o) => (
            // The option role goes on the button, not the `li` — an option that
            // *contains* a focusable control is invalid ARIA, and the button is
            // what has to stay focusable until this grows arrow-key navigation.
            // `presentation` drops the `li` so the button is the listbox's child.
            <li key={o.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
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
