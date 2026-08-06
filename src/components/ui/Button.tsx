import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

// Radius matches Input/Select so a button next to a field shares its edge
// language. Pills are for chips and badges — labels, not controls.
const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold ' +
  'transition focus-visible:outline-none focus-visible:shadow-focus ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[12.5px]',
  md: 'h-10 px-4 text-sm',
}

const variants: Record<Variant, string> = {
  // Default affirmative action is ink. Reserve `accent` for the one orange
  // call-to-action per view, or it stops meaning anything.
  primary: 'bg-ink text-white hover:bg-ink-700 active:bg-ink-700 shadow-sm',
  accent: 'bg-action text-white hover:bg-action-700 active:bg-action-700 shadow-sm',
  secondary: 'bg-surface text-fg-2 border border-border hover:border-border-strong hover:text-fg',
  ghost: 'bg-transparent text-fg-2 hover:bg-surface-muted hover:text-fg',
  danger: 'bg-no text-white hover:bg-no-strong active:bg-no-strong shadow-sm',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...rest }, ref) => (
    // `type` before the spread, so a caller can still ask for a submit button.
    // The HTML default is submit, which is never what these are used for.
    <button
      ref={ref}
      type="button"
      className={cn(base, sizes[size], variants[variant], className)}
      {...rest}
    />
  ),
)
Button.displayName = 'Button'
