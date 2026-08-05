/**
 * The Date Bro mark: a quotation mark, one comma per voice — theirs in terracotta,
 * yours in the current text color. Untiled, for use inside the app where the
 * background is known. The tiled version that ships as the toolbar icon is
 * public/assets/icon.svg.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Date Bro"
    >
      <g transform="translate(18 28) scale(1.12)" fill="var(--color-action)">
        <circle r="10.5" />
        <path d="M-9.2 5C-9.6 10-8.4 14.6-6 18.4-2 14 1 11 3.6 7Z" />
      </g>
      <g transform="translate(46 28) scale(1.12)" fill="currentColor">
        <circle r="10.5" />
        <path d="M-9.2 5C-9.6 10-8.4 14.6-6 18.4-2 14 1 11 3.6 7Z" />
      </g>
    </svg>
  )
}
