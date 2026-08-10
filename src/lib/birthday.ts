/**
 * A birthday, described as of now.
 *
 * The field used to be `age`, a free-text number, and it was wrong the moment it
 * was written: a record here is kept for months and read on every call, so a
 * stored "28" quietly becomes a lie and nothing in the app ever corrects it. A
 * birthday is the fact; the age is derived at the moment of the request.
 *
 * Deriving it in code rather than handing the model a date and `<right_now>` and
 * letting it subtract. That is arithmetic across a calendar, which models get
 * wrong in exactly the quiet way this app can't afford — and the answer is
 * stated as a fact everywhere else, so it should be stated here too.
 *
 * The countdown is the other half, and the reason it earns its place: a birthday
 * coming up is a set piece. Only within a month, so it isn't standing noise.
 */
export function describeBirthday(iso: string, now = new Date()): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  // Constructed in local time, not `new Date(iso)`, which reads as UTC and
  // lands on the day before for anyone west of Greenwich. The round-trip check
  // rejects a date that doesn't exist (2001-02-30 rolls forward to March).
  // The year is checked for the same reason as the month and the day: the
  // two-digit years map onto 1900+n, so 0050-01-01 builds a valid 1950 date and
  // then reports "1 January 1950 — 1976 years old", because the age is computed
  // from the year that was typed and the display from the year that was built.
  const born = new Date(year, month - 1, day)
  if (born.getFullYear() !== year || born.getMonth() !== month - 1 || born.getDate() !== day) {
    return null
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const written = born.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Compared as (month, day) rather than by subtracting dates, so it can't be
  // thrown off by a leap year or a daylight-saving hour.
  const hadBirthday =
    today.getMonth() > month - 1 || (today.getMonth() === month - 1 && today.getDate() >= day)
  const age = today.getFullYear() - year - (hadBirthday ? 0 : 1)

  // A date in the future is a typo, not a person. Say the date and stop rather
  // than reporting a negative age as though it meant something.
  if (age < 0) return `${written} — which is in the future, so this is probably a typo`

  const next = new Date(today.getFullYear(), month - 1, day)
  if (next < today) next.setFullYear(next.getFullYear() + 1)
  // 29 February falls forward to 1 March in a common year, which is the usual
  // convention and the only one that doesn't skip three years in four.
  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000)

  const soon = days === 0 ? ', and it is today' : days <= 30 ? `, and it is in ${days} days` : ''
  return `${written} — ${age} years old${soon}`
}
