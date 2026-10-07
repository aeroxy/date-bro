// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { newDate, type DateRecord, type Turn } from '@/types/date'
import { searchDates, type Marked } from './search'

const person = (name: string, turns: Partial<Turn>[] = []): DateRecord => ({
  ...newDate(name),
  turns: turns.map((t, i) => ({ id: `${name}-${i}`, speaker: 'them', text: '', ...t })),
})

/** The marked stretch in context, so a wrong offset shows up as the wrong letters. */
const show = (m?: Marked) => m && `${m.before}[${m.match}]${m.after}`

describe('searchDates', () => {
  const mira = person('Mira', [
    { text: 'Want to get dinner on Friday?' },
    { speaker: 'me', text: 'Sure, where?' },
    { speaker: 'context', text: 'She said dinner again on the call', note: 'sounded tired' },
  ])
  const sam = person('Sam', [{ text: 'Climbing tomorrow?' }])

  test('a blank query matches no one', () => {
    expect(searchDates([mira, sam], '')).toEqual([])
    expect(searchDates([mira, sam], '   ')).toEqual([])
  })

  test('matches a name, ignoring case', () => {
    const [hit, ...rest] = searchDates([mira, sam], 'MIR')
    expect(rest).toEqual([])
    expect(hit.record).toBe(mira)
    expect(show(hit.name)).toBe('[Mir]a')
    expect(hit.turn).toBeUndefined()
  })

  test('a conversation match shows the newest turn and counts the rest', () => {
    const [hit] = searchDates([mira, sam], 'dinner')
    expect(hit.name).toBeUndefined()
    expect(hit.turn?.id).toBe('Mira-2')
    expect(hit.turn?.count).toBe(2)
    expect(show(hit.turn?.line)).toBe('She said [dinner] again on the call')
  })

  test("searches the user's note and the question a NOTE answers", () => {
    const asked = person('Ana', [{ speaker: 'context', text: 'Two, eventually', asked: 'Wants kids?' }])
    expect(show(searchDates([mira], 'tired')[0].turn?.line)).toBe('sounded [tired]')
    expect(show(searchDates([asked], 'kids')[0].turn?.line)).toBe('Wants [kids]?')
  })

  test('keeps the order it was given and drops anyone without a match', () => {
    const lena = person('Lena', [{ text: 'tomorrow works' }])
    expect(searchDates([sam, mira, lena], 'tomorrow').map((h) => h.record.name)).toEqual(['Sam', 'Lena'])
  })

  test('accents fold, and the mark covers the accent wherever it is stored', () => {
    expect(show(searchDates([person('José')], 'jose')[0].name)).toBe('[José]')
    // The same name with the accent as its own combining character: the match
    // ends on the "e" in the folded copy, but the mark has to take the accent.
    expect(show(searchDates([person('José M')], 'jose')[0].name)).toBe('[José] M')
    expect(show(searchDates([person('Zoë')], 'ZOE')[0].name)).toBe('[Zoë]')
  })

  test('offsets survive letters that fold to a different length', () => {
    // "İ" lowercases to two code units; folded first it is one.
    expect(show(searchDates([person('İpek Yılmaz')], 'ipek')[0].name)).toBe('[İpek] Yılmaz')
    // A Hangul syllable decomposes into three jamo.
    expect(show(searchDates([person('김민지')], '민지')[0].name)).toBe('김[민지]')
  })

  test('a final sigma matches typed either way', () => {
    expect(show(searchDates([person('ΟΔΟΣ ΑΘΗΝΑΣ')], 'οδος')[0].name)).toBe('[ΟΔΟΣ] ΑΘΗΝΑΣ')
    expect(show(searchDates([person('ΟΔΟΣ')], 'οδοσ')[0].name)).toBe('[ΟΔΟΣ]')
  })

  test('a long lead is cut to the start of a word, with an ellipsis', () => {
    const long = person('Kai', [{ text: 'I was thinking that maybe we could try the ramen place' }])
    expect(show(searchDates([long], 'ramen')[0].turn?.line)).toBe('…try the [ramen] place')
  })

  test('wide characters spend the lead twice as fast, and are never cut in half', () => {
    const zh = person('Lin', [{ text: '嗯嗯我们周末一起去爬山然后吃火锅好不好' }])
    expect(show(searchDates([zh], '火锅')[0].turn?.line)).toBe('…去爬山然后吃[火锅]好不好')
    const emoji = person('Ray', [{ text: '😀'.repeat(13) + ' hello' }])
    expect(searchDates([emoji], 'hello')[0].turn?.line.before).toBe('…' + '😀'.repeat(5) + ' ')
  })

  test('a name and a conversation can both match', () => {
    const [hit] = searchDates([person('Paris', [{ text: 'I grew up near Paris' }])], 'paris')
    expect(show(hit.name)).toBe('[Paris]')
    expect(show(hit.turn?.line)).toBe('…up near [Paris]')
  })
})
