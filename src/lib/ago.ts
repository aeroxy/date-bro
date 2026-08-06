/**
 * Relative time, one implementation. There were two — the rail's stopped at
 * days, the panel's had a months tier — so the same timestamp could read `45d
 * ago` in one place and `2mo ago` in the other. The rail's tiers won; a list
 * sorted newest-first is where the long tail actually shows up.
 */
export function ago(ts?: number): string {
  if (!ts) return 'never'
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}
