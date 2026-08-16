/**
 * The record's research notes: durable facts the coach looked up, carried into
 * every later prompt so nothing is paid for twice.
 *
 * Two merge modes, because appending alone doesn't hold. Normally a run returns
 * what it found that isn't already there and it lands at the end — but the model
 * paraphrases rather than repeats, so an exact-line dedupe catches only a literal
 * re-emission and the same fact in fresh words becomes a second line. Across
 * dozens of runs one real record reached 68 lines holding ~25 facts, one venue
 * written out six times, and — worse — four lines asserting something a fifth had
 * already corrected. So past a ceiling the coach is asked for the whole list back,
 * consolidated, and `replaceResearchNotes` swaps it in.
 *
 * Rejected on the way here: numbering the lines so the model could delete and
 * replace by index. `[n]` already means a transcript turn *inside* these notes,
 * positional indices go stale the moment the user edits the free-text box in
 * `ProfileModal`, and stable ids would need a counter and a migration — all to
 * sweep up after a prompt that was asking for the duplicates in the first place.
 * The prompt is the fix; this is the backstop.
 */

// Both sides go through this. The model sometimes returns notes already
// bulleted; without stripping first, "- X" wouldn't match a stored "X" and
// would then be re-bulleted into "- - X".
const stripBullet = (s: string) => s.replace(/^[-*]\s*/, '').trim()

const noteLines = (notes: string) => notes.split('\n').map(stripBullet).filter(Boolean)

/**
 * Lines, not words: one line is one fact here, which makes it a stable unit in a
 * way it isn't in a profile. Generous on purpose — consolidation costs a full
 * list in the output of a run the user is waiting on, so it should be rare.
 */
export const NOTES_LINE_CEILING = 30

export function needsConsolidation(notes: string): boolean {
  return noteLines(notes).length > NOTES_LINE_CEILING
}

/**
 * Folds newly-verified facts from one suggestion run into the record's
 * persistent research notes, skipping anything already present (case-
 * insensitive line match) so repeated runs don't pile up duplicate bullets.
 */
export function mergeResearchNotes(existing: string, additions: string[]): string {
  const fresh = additions.map(stripBullet).filter(Boolean)
  if (!fresh.length) return existing

  const seen = new Set(noteLines(existing).map((line) => line.toLowerCase()))
  // `seen` grows as we go, so a fact repeated twice within one run is caught
  // as well as one already on the record.
  const toAdd = fresh.filter((a) => {
    const key = a.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!toAdd.length) return existing

  const bullets = toAdd.map((a) => `- ${a}`).join('\n')
  return existing.trim() ? `${existing.trim()}\n${bullets}` : bullets
}

/**
 * Swaps in the consolidated list a run was asked for, reconciled against what the
 * user did to the notes box while the model was thinking.
 *
 * `snapshot` is the block the prompt was built from; `current` is a fresh read.
 * Both directions of the difference between them are the user's, and the model
 * saw neither: a line in `current` and not in `snapshot` was added during the run
 * and survives the swap, and one in `snapshot` and not in `current` was deleted
 * during the run and does not come back with the consolidation. The `Clear`
 * button in `ProfileModal` makes the second case a whole-block version of the
 * first, and without it a run in flight would undo the clear wholesale.
 *
 * Matching is exact, so this catches a deleted line the consolidation passed
 * through unchanged — the common case, since most lines have no duplicate to
 * merge with — and not one it reworded. Partial, never wrong: the worst outcome
 * is a deleted line returning, which is where this started.
 */
export function replaceResearchNotes(
  snapshot: string,
  current: string,
  returned: string[],
): string {
  const fresh = returned.map(stripBullet).filter(Boolean)
  // An empty list means "nothing to say", never "delete everything". A run can
  // derail before it writes this field at all — see the note on field order in
  // `coach/schemas.ts` — and that must cost the consolidation, not the notes.
  // Checked before the deletion filter below, which can legitimately empty the
  // list when the user has just cleared the box.
  if (!fresh.length) return current

  const before = new Set(noteLines(snapshot).map((line) => line.toLowerCase()))
  const now = new Set(noteLines(current).map((line) => line.toLowerCase()))
  const theirs = noteLines(current).filter((line) => !before.has(line.toLowerCase()))
  const kept = fresh.filter((line) => {
    const key = line.toLowerCase()
    return !before.has(key) || now.has(key)
  })
  return mergeResearchNotes(kept.map((f) => `- ${f}`).join('\n'), theirs)
}

/**
 * Apply one run's `research_notes`, in whichever mode that run was asked for.
 *
 * The mode is derived from `snapshot` — the same value `buildSuggestionMessages`
 * derived it from — so the app always applies what the prompt asked for, even if
 * the user has edited the notes in the meantime.
 */
export function applyResearchNotes(
  snapshot: string,
  current: string,
  returned: string[],
): string {
  return needsConsolidation(snapshot)
    ? replaceResearchNotes(snapshot, current, returned)
    : mergeResearchNotes(current, returned)
}
