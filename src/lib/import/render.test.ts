// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { parsePastedLog } from '../transcript'
import { renderLog, type RawMessage } from './render'

const msg = (over: Partial<RawMessage> = {}): RawMessage => ({
  id: 'm1',
  order: 1,
  // 2026-08-08T20:59 local — built from parts so the test reads the same clock
  // the renderer does, whatever zone it runs in.
  ts: new Date(2026, 7, 8, 20, 59).getTime(),
  out: true,
  text: 'hey',
  ...over,
})

describe('renderLog', () => {
  test('renders the line shape parsePastedLog reads', () => {
    expect(renderLog([msg()])).toBe('Me [Sat Aug 8, 8:59pm]: hey')
  })

  test('labels the other side Them', () => {
    expect(renderLog([msg({ out: false })])).toStartWith('Them [')
  })

  test('carries the last stamp forward, marked, when a message has no time', () => {
    const lines = renderLog([msg(), msg({ id: 'm2', order: 2, ts: null, text: 'and this' })]).split('\n')
    expect(lines[1]).toBe('Me [~Sat Aug 8, 8:59pm]: and this')
  })

  test('leaves the stamp off entirely when nothing before it had one', () => {
    expect(renderLog([msg({ ts: null })])).toBe('Me: hey')
  })

  test('renders a captionless media message as its label alone', () => {
    expect(renderLog([msg({ text: '', media: 'photo' })])).toEndWith(': [photo]')
  })

  test('drops a message with neither text nor media', () => {
    expect(renderLog([msg({ text: '' })])).toBe('')
  })

  test('folds a multi-line message onto one line', () => {
    expect(renderLog([msg({ text: 'one\ntwo' })])).toEndWith(': one two')
  })

  test('brackets the asides around the text', () => {
    const line = renderLog([msg({ text: 'sure', reply: 'you free thursday?', reactions: '❤️' })])
    expect(line).toEndWith(': [re: you free thursday?] sure [❤️]')
  })

  test('does not repeat a shared link the text already carries', () => {
    const line = renderLog([msg({ text: 'look at this bbc.com/x', shared: 'bbc.com/x' })])
    expect(line).toEndWith(': look at this bbc.com/x')
  })
})

describe('round trip', () => {
  // The whole feature rests on this: the sources render to text, and the text
  // goes through the same parser a hand-pasted log does. If these two ever
  // disagree about the line shape, every import silently drops turns.
  const messages: RawMessage[] = [
    msg({ id: 'a', order: 1, out: false, text: 'hey stranger' }),
    msg({ id: 'b', order: 2, ts: new Date(2026, 7, 8, 21, 32).getTime(), out: true, text: 'hello' }),
    msg({ id: 'c', order: 3, ts: null, out: false, text: '', media: 'photo' }),
    msg({ id: 'd', order: 4, ts: new Date(2026, 7, 9, 10, 54).getTime(), out: false, text: 'multi\nline' }),
  ]

  test('every rendered message comes back as a turn, in order and on the right side', () => {
    const turns = parsePastedLog(renderLog(messages), 'Bara')
    expect(turns.map((t) => t.speaker)).toEqual(['them', 'me', 'them', 'them'])
    expect(turns.map((t) => t.text)).toEqual(['hey stranger', 'hello', '[photo]', 'multi line'])
  })

  test('the timestamps survive as the free-form when field', () => {
    const turns = parsePastedLog(renderLog(messages), 'Bara')
    expect(turns[0]!.at).toBe('Sat Aug 8, 8:59pm')
    expect(turns[2]!.at).toBe('~Sat Aug 8, 9:32pm')
  })
})
