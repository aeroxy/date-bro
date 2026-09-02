// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test'

import { importFromSource, SOURCES, type SourceDef } from './sources'
import type { FetchArgs, RawMessage } from './render'

/**
 * The half of the import that isn't a page.
 *
 * The drivers themselves can't be reached from here — they read `document`
 * and `window.require`, and they're written as one self-contained function each
 * because `chrome.scripting` stringifies them, so there is nothing to import and
 * no seam to inject a fake DOM through. What *is* testable is everything around
 * them: the tab lookup, the pass loop, dedup across passes, the tail trim, and
 * which note comes back. That's also where the logic that isn't obvious lives —
 * a driver is mostly selectors, and a selector only fails against the real site.
 */

const msg = (over: Partial<RawMessage> & { id: string; order: number }): RawMessage => ({
  ts: new Date(2026, 7, 8, 20, 59).getTime(),
  out: true,
  text: 'hey',
  ...over,
})

type Pass = { messages?: RawMessage[]; done?: boolean; peer?: string | null; note?: string | null; error?: string }

/**
 * A stand-in source. Its `fetch` is never called — it's handed to
 * `executeScript` as `func`, and the fake below answers instead of running it,
 * which is exactly what the real Chrome does with it too.
 */
function fakeSource(over: Partial<SourceDef> = {}): SourceDef {
  return {
    id: 'whatsapp',
    label: 'WhatsApp',
    match: '*://web.whatsapp.com/*',
    where: 'web.whatsapp.com',
    fetch: (async () => ({})) as SourceDef['fetch'],
    ...over,
  }
}

let calls: FetchArgs[] = []
let injectedInto: (number | undefined)[] = []

type FakeTab = { id?: number; lastAccessed?: number; active?: boolean }

/** Stand in for the two chrome APIs `importFromSource` reaches for. */
function install(passes: Pass[], { tabs = [{ id: 7 }] }: { tabs?: FakeTab[] } = {}) {
  calls = []
  injectedInto = []
  let i = 0
  ;(globalThis as Record<string, any>).chrome = {
    tabs: { query: async () => tabs },
    scripting: {
      executeScript: async ({ args, target }: { args: [FetchArgs]; target: { tabId: number } }) => {
        calls.push(args[0])
        injectedInto.push(target.tabId)
        // Past the end, keep answering with the last pass: a driver that never
        // says `done` is exactly what the MAX_PASSES guard is for.
        const pass = passes[Math.min(i++, passes.length - 1)]
        return [{ result: pass }]
      },
    },
  }
}

afterEach(() => {
  delete (globalThis as Record<string, any>).chrome
})

describe('SOURCES', () => {
  test("each stateKey is the global its driver actually parks on", () => {
    // The driver can't import the key — `chrome.scripting` serialises it — so
    // the same string is spelled twice, and the cleanup in `importFromSource`
    // deletes whatever `stateKey` says. Renaming one side leaves a whole
    // harvested history parked on the user's tab with nothing pointing at it.
    // The serialised source is the one place both spellings can be compared.
    for (const s of SOURCES) {
      if (!s.stateKey) continue
      expect(String(s.fetch)).toContain(`.${s.stateKey}`)
    }
  })
})

describe('importFromSource', () => {
  test('renders one pass and reports the peer', async () => {
    install([{ messages: [msg({ id: 'a', order: 1 }), msg({ id: 'b', order: 2, out: false, text: 'hi' })], done: true, peer: 'Bara' }])
    const seen: number[] = []
    const result = await importFromSource(fakeSource(), 0, (n) => seen.push(n))

    expect(result.peer).toBe('Bara')
    expect(result.count).toBe(2)
    expect(result.note).toBeNull()
    expect(result.text.split('\n')).toHaveLength(2)
    expect(result.text).toContain('Me [')
    expect(result.text).toContain('Them [')
    // Progress is reported per pass, so the UI can count up during a long read.
    expect(seen).toEqual([2])
  })

  test('keeps passes going until one says done, and dedups by id across them', async () => {
    install([
      { messages: [msg({ id: 'a', order: 1 })], done: false },
      { messages: [msg({ id: 'a', order: 1 }), msg({ id: 'b', order: 2 })], done: false },
      { messages: [msg({ id: 'c', order: 3 })], done: true },
    ])
    const result = await importFromSource(fakeSource(), 0, () => {})

    expect(result.count).toBe(3)
    expect(calls).toHaveLength(3)
    // Only the first pass restarts; the rest resume the driver's own state.
    expect(calls.map((c) => c.restart)).toEqual([true, false, false])
  })

  test('sorts by order, not by arrival', async () => {
    install([{ messages: [msg({ id: 'b', order: 2, text: 'second' }), msg({ id: 'a', order: 1, text: 'first' })], done: true }])
    const result = await importFromSource(fakeSource(), 0, () => {})

    expect(result.text.indexOf('first')).toBeLessThan(result.text.indexOf('second'))
  })

  test('trims to the last N after fetching, keeping the newest', async () => {
    install([
      {
        messages: [
          msg({ id: 'a', order: 1, text: 'oldest' }),
          msg({ id: 'b', order: 2, text: 'middle' }),
          msg({ id: 'c', order: 3, text: 'newest' }),
        ],
        done: true,
      },
    ])
    const result = await importFromSource(fakeSource(), 2, () => {})

    expect(result.count).toBe(2)
    expect(result.text).not.toContain('oldest')
    expect(result.text).toContain('newest')
    // The cap is passed down too, so a driver can stop early rather than
    // fetching a whole history for the caller to throw away.
    expect(calls[0]?.last).toBe(2)
  })

  test('a driver that never finishes stops and says so', async () => {
    install([{ messages: [msg({ id: 'a', order: 1 })], done: false }])
    const result = await importFromSource(fakeSource(), 0, () => {})

    expect(calls.length).toBe(200)
    expect(result.note).toMatch(/Stopped after 200 passes/)
  })

  test("a driver's own note and the didn't-finish one both survive", async () => {
    install([{ messages: [msg({ id: 'a', order: 1 })], done: false, note: 'history remains' }])
    const result = await importFromSource(fakeSource(), 0, () => {})

    // Both are true at once, and the driver's used to stand in for the cap.
    expect(result.note).toMatch(/history remains/)
    expect(result.note).toMatch(/Stopped after 200 passes/)
  })

  test('leaving a resumable walk early clears its state from the tab', async () => {
    install([{ messages: [msg({ id: 'a', order: 1 })], done: false }])
    const controller = new AbortController()
    const sawKey: unknown[] = []
    const exec = (globalThis as Record<string, any>).chrome.scripting.executeScript
    ;(globalThis as Record<string, any>).chrome.scripting.executeScript = async (opts: any) => {
      // The cleanup injection carries the state key as its one argument; the
      // pass injections carry FetchArgs.
      if (typeof opts.args?.[0] === 'string') {
        sawKey.push(opts.args[0])
        return [{}]
      }
      controller.abort()
      return exec(opts)
    }

    await expect(
      importFromSource(fakeSource({ stateKey: '__dbWaImport' }), 0, () => {}, controller.signal),
    ).rejects.toThrow(/cancelled/i)
    await new Promise((r) => setTimeout(r, 0))
    expect(sawKey).toEqual(['__dbWaImport'])
  })

  test("an earlier import's cleanup does not touch a retry that has since taken the tab", async () => {
    // A cancelled import only notices at its next pass boundary, up to a whole
    // pass later. In that window the user starts again on the same tab, and
    // that import's pass 0 re-creates the state. A's cleanup must then leave it
    // alone, or B's pass 1 finds nothing and starts the walk over.
    install([{ messages: [msg({ id: 'a', order: 1 })], done: false }])
    const deletions: string[] = []
    // Every pass injection parks on a gate the test opens by hand, so the order
    // in which the two imports reach each point is the test's, not the clock's.
    const gates: (() => void)[] = []
    const exec = (globalThis as Record<string, any>).chrome.scripting.executeScript
    ;(globalThis as Record<string, any>).chrome.scripting.executeScript = async (opts: any) => {
      if (typeof opts.args?.[0] === 'string') {
        deletions.push(opts.args[0])
        return [{}]
      }
      await new Promise<void>((open) => gates.push(open))
      return exec(opts)
    }
    const tick = () => new Promise((r) => setTimeout(r, 0))
    const source = fakeSource({ stateKey: '__dbTgImport' })

    const a = new AbortController()
    const endA = importFromSource(source, 0, () => {}, a.signal).catch((e: Error) => e)
    await tick()
    expect(gates).toHaveLength(1) // A is inside its pass 0
    a.abort() // …and won't know until that pass returns

    const b = new AbortController()
    const endB = importFromSource(source, 0, () => {}, b.signal).catch((e: Error) => e)
    await tick()
    expect(gates).toHaveLength(2) // B is inside its pass 0, restart: true
    gates[1]!() // B's pass 0 completes: the state on the tab is now B's
    await tick()
    expect(gates).toHaveLength(3) // B has gone on to pass 1

    gates[0]!() // A's hung pass finally returns; A sees the abort and leaves
    expect(((await endA) as Error).name).toBe('AbortError')
    await tick()
    expect(deletions).toEqual([]) // …without touching what is now B's

    b.abort()
    gates[2]!()
    expect(((await endB) as Error).name).toBe('AbortError')
    await tick()
    expect(deletions).toEqual(['__dbTgImport']) // B cleans up after itself
  })

  test('an aborted signal stops the pass loop', async () => {
    // Never says `done`, so only the signal can end it.
    install([{ messages: [msg({ id: 'a', order: 1 })], done: false }])
    const controller = new AbortController()
    controller.abort()

    await expect(importFromSource(fakeSource(), 0, () => {}, controller.signal)).rejects.toThrow(
      /cancelled/i,
    )
    expect(injectedInto).toEqual([])
  })

  test('picks the matching tab the user was in most recently', async () => {
    // The realistic Instagram case: a feed tab matches the pattern just as well
    // as the DM, and array order would have handed us the feed.
    install([{ messages: [msg({ id: 'a', order: 1 })], done: true }], {
      tabs: [
        { id: 1, lastAccessed: 1000 },
        { id: 2, lastAccessed: 5000 },
        { id: 3, lastAccessed: 2000 },
      ],
    })
    const result = await importFromSource(fakeSource(), 0, () => {})

    expect(injectedInto).toEqual([2])
    // Having had a choice is said out loud, so a wrong pick is visible.
    expect(result.note).toMatch(/of 3 open/)
  })

  test('falls back to the active tab where lastAccessed is not reported', async () => {
    install([{ messages: [msg({ id: 'a', order: 1 })], done: true }], {
      tabs: [{ id: 1 }, { id: 2, active: true }],
    })
    await importFromSource(fakeSource(), 0, () => {})

    expect(injectedInto).toEqual([2])
  })

  test('one tab says nothing about which tab', async () => {
    install([{ messages: [msg({ id: 'a', order: 1 })], done: true }])
    const result = await importFromSource(fakeSource(), 0, () => {})

    expect(result.note).toBeNull()
  })

  test('the ambiguity note does not swallow the didn\'t-finish warning', async () => {
    install([{ messages: [msg({ id: 'a', order: 1 })], done: false }], {
      tabs: [{ id: 1, lastAccessed: 2 }, { id: 2, lastAccessed: 1 }],
    })
    const result = await importFromSource(fakeSource(), 0, () => {})

    expect(result.note).toMatch(/of 2 open/)
    expect(result.note).toMatch(/Stopped after 200 passes/)
  })

  test('no tab open names the source and where to open it', async () => {
    install([], { tabs: [] })
    await expect(importFromSource(fakeSource(), 0, () => {})).rejects.toThrow(
      /No WhatsApp tab is open.*web\.whatsapp\.com/s,
    )
  })

  test('an injection that throws names the source, not the driver', async () => {
    // The tab navigated away, the page was closed mid-pass, the world is gone:
    // `executeScript` rejects and there is no driver answer to read.
    install([])
    ;(globalThis as Record<string, any>).chrome.scripting.executeScript = async () => {
      throw new Error('Frame with ID 0 was removed.')
    }

    await expect(importFromSource(fakeSource(), 0, () => {})).rejects.toThrow(
      /Couldn't read the WhatsApp tab.*Frame with ID 0/s,
    )
  })

  test('an injection that answers with nothing points at the tab', async () => {
    // A driver that fell off the end of its own function, so `result` is
    // undefined — distinct from one that reported an error, and the copy has to
    // say which tab it was asking, since that is the thing the user can check.
    install([])
    ;(globalThis as Record<string, any>).chrome.scripting.executeScript = async () => [{}]

    await expect(importFromSource(fakeSource(), 0, () => {})).rejects.toThrow(
      /The WhatsApp tab returned nothing.*web\.whatsapp\.com/s,
    )
  })

  test("a driver's error is surfaced verbatim", async () => {
    install([{ error: 'No Telegram chat is open — click into the conversation you want.' }])
    await expect(importFromSource(fakeSource(), 0, () => {})).rejects.toThrow(
      'No Telegram chat is open — click into the conversation you want.',
    )
  })

  test('an empty conversation is an error, not an empty import', async () => {
    install([{ messages: [], done: true }])
    await expect(importFromSource(fakeSource(), 0, () => {})).rejects.toThrow(/gave back no messages/)
  })

  test('an unrenderable message is dropped from the text but still counted', async () => {
    // A message with no text and nothing bracketable renders to no line at all.
    // `count` is what was *fetched*, which is what the status line means by it,
    // so the two can disagree by the handful of messages there was nothing to
    // say about. Pinned because it's the kind of gap that otherwise gets
    // "fixed" in whichever direction the next reader assumes.
    install([{ messages: [msg({ id: 'a', order: 1, text: '' })], done: true }])
    const result = await importFromSource(fakeSource(), 0, () => {})

    expect(result.text).toBe('')
    expect(result.count).toBe(1)
  })
})
