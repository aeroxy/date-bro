// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { describeBirthday } from './birthday'

// Local time throughout, matching how the function builds its dates. A UTC
// literal would drift a day for anyone west of Greenwich, which is exactly the
// bug the round-trip construction in `describeBirthday` exists to avoid.
const on = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe('describeBirthday', () => {
  test('states the age as of now, not as of when it was written', () => {
    expect(describeBirthday('1997-03-14', on(2026, 8, 10))).toBe('14 March 1997 — 29 years old')
    // The same record, a year later. This is the whole reason the field changed.
    expect(describeBirthday('1997-03-14', on(2027, 8, 10))).toBe('14 March 1997 — 30 years old')
  })

  test('does not count a birthday that has not happened yet this year', () => {
    expect(describeBirthday('1997-11-02', on(2026, 8, 10))).toContain('28 years old')
    expect(describeBirthday('1997-11-02', on(2026, 11, 2))).toContain('29 years old')
    expect(describeBirthday('1997-11-02', on(2026, 11, 1))).toContain('28 years old')
  })

  test('counts down inside a month, and says so on the day', () => {
    expect(describeBirthday('1997-08-19', on(2026, 8, 10))).toBe(
      '19 August 1997 — 28 years old, and it is in 9 days',
    )
    expect(describeBirthday('1997-08-10', on(2026, 8, 10))).toBe(
      '10 August 1997 — 29 years old, and it is today',
    )
  })

  test('says nothing about timing when it is further off than a month', () => {
    expect(describeBirthday('1997-03-14', on(2026, 8, 10))).not.toContain('days')
    // 31 days out is outside the window; 30 is inside it.
    expect(describeBirthday('1997-09-10', on(2026, 8, 10))).not.toContain('days')
    expect(describeBirthday('1997-09-09', on(2026, 8, 10))).toContain('in 30 days')
  })

  test('counts across a year boundary', () => {
    expect(describeBirthday('1997-01-05', on(2026, 12, 28))).toContain('in 8 days')
  })

  test('29 February falls forward to 1 March in a common year', () => {
    // Not skipped: three years in four would otherwise never see a countdown.
    expect(describeBirthday('2000-02-29', on(2026, 2, 20))).toContain('in 9 days')
    expect(describeBirthday('2000-02-29', on(2028, 2, 20))).toContain('in 9 days')
  })

  test('a future date is called a typo rather than reported as a negative age', () => {
    expect(describeBirthday('2097-03-14', on(2026, 8, 10))).toBe(
      '14 March 2097 — which is in the future, so this is probably a typo',
    )
  })

  test('nothing is only nothing — empty and blank are the whole of null', () => {
    for (const empty of ['', '   ', '\n']) {
      expect(describeBirthday(empty, on(2026, 8, 10))).toBeNull()
    }
  })

  // The field is free text because what the user knows is often partial. None of
  // this can be derived from, and none of it is dropped: it reaches the model as
  // the words that were typed, trimmed.
  test('hands back what it cannot read, rather than nothing', () => {
    for (const partial of ['August', 'late March', '1997', 'March 14', '14/03/1997', '1997-3-14']) {
      expect(describeBirthday(partial, on(2026, 8, 10))).toBe(partial)
    }
    expect(describeBirthday('  August  ', on(2026, 8, 10))).toBe('August')
  })

  test('derives nothing from a date that only looks like one', () => {
    // 1997-02-30 rolls forward to March, so a derived answer would be a date
    // nobody typed. `new Date(50, 0, 1)` is 1950, so the display and the age
    // disagreed: the written date came from the constructed year and the age
    // from the typed one.
    for (const fake of ['1997-02-30', '0050-01-01', '0000-01-01', '0099-12-31']) {
      const out = describeBirthday(fake, on(2026, 8, 10))
      expect(out).toBe(fake)
      expect(out).not.toContain('years old')
    }
    // Still a real four-digit year, and still a real date.
    expect(describeBirthday('0100-01-01', on(2026, 8, 10))).toContain('1926 years old')
  })
})
