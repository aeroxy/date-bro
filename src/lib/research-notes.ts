/**
 * Folds newly-verified facts from one suggestion run into the record's
 * persistent research notes, skipping anything already present (case-
 * insensitive line match) so repeated runs don't pile up duplicate bullets.
 */
export function mergeResearchNotes(existing: string, additions: string[]): string {
  const fresh = additions.map((a) => a.trim()).filter(Boolean)
  if (!fresh.length) return existing

  const seen = new Set(
    existing
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim().toLowerCase())
      .filter(Boolean),
  )
  const toAdd = fresh.filter((a) => !seen.has(a.toLowerCase()))
  if (!toAdd.length) return existing

  const bullets = toAdd.map((a) => `- ${a}`).join('\n')
  return existing.trim() ? `${existing.trim()}\n${bullets}` : bullets
}
