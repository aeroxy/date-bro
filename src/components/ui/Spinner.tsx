import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'animate-spin-slow inline-block h-3.5 w-3.5 flex-none rounded-full border-[1.5px] border-current border-t-transparent',
        className,
      )}
      role="status"
      aria-label="Working"
    />
  )
}
