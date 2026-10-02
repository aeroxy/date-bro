// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test'

import { fitWithin, MAX_EDGE, MAX_TILES, OVERLAP, planImage, prepareImage } from './image'

// `prepareImage` is canvas and decode, which only a browser has; what can be
// wrong without one is the arithmetic, and the check it makes before decoding
// anything, so those are what's pinned here.
describe('fitWithin', () => {
  test('scales the longest side down to the limit and keeps the shape', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_EDGE, height: 1932 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1932, height: MAX_EDGE })
  })

  test('never scales up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(MAX_EDGE, 100)).toEqual({ width: MAX_EDGE, height: 100 })
  })

  test('a very thin image keeps at least a pixel across, rather than none', () => {
    expect(fitWithin(1, 9000).width).toBe(1)
  })

  test('takes the limit as an argument', () => {
    expect(fitWithin(2000, 1000, 500)).toEqual({ width: 500, height: 250 })
  })
})

/** Every row of the picture is in some slice, top to bottom, and neighbours share a few lines. */
function expectWholeAndOverlapping(plan: ReturnType<typeof planImage>) {
  // A literal floor, not just the constant: checking overlap against `OVERLAP`
  // alone passes for any value of it, zero included.
  expect(OVERLAP).toBeGreaterThanOrEqual(100)
  const { tiles, height } = plan
  expect(tiles[0]!.y).toBe(0)
  const last = tiles[tiles.length - 1]!
  expect(last.y + last.height).toBe(height)
  for (const tile of tiles) expect(tile.height).toBeLessThanOrEqual(MAX_EDGE)
  for (let i = 1; i < tiles.length; i++) {
    const before = tiles[i - 1]!
    const overlap = before.y + before.height - tiles[i]!.y
    // One pixel of slack: the starts are rounded from a fractional step.
    expect(overlap).toBeGreaterThanOrEqual(OVERLAP - 1)
    expect(tiles[i]!.y).toBeGreaterThan(before.y)
  }
}

describe('planImage: what is one image', () => {
  test('a landscape photo is shrunk to the limit, and never cut', () => {
    const plan = planImage(4032, 3024)
    expect(plan.tiles).toHaveLength(1)
    expect([plan.width, plan.height]).toEqual([MAX_EDGE, 1932])
  })

  test('a portrait photo is the case that must never be cut, however many pixels it has', () => {
    for (const [w, h] of [
      [3024, 4032],
      [6048, 8064], // 48 megapixels: shrinks by far more than any screenshot
      [3024, 5376], // a 9:16 portrait
    ] as const) {
      const plan = planImage(w, h)
      expect(plan.tiles).toHaveLength(1)
      expect(Math.max(plan.width, plan.height)).toBe(MAX_EDGE)
    }
  })

  test('a phone screenshot goes whole, at the size it was taken', () => {
    const plan = planImage(1170, 2532)
    expect(plan.tiles).toHaveLength(1)
    expect([plan.width, plan.height]).toEqual([1170, 2532])
  })

  test('a desktop screenshot goes whole too', () => {
    const plan = planImage(2560, 1440)
    expect(plan.tiles).toHaveLength(1)
    expect([plan.width, plan.height]).toEqual([2560, 1440])
  })

  test('a small image is left alone', () => {
    expect(planImage(300, 200)).toEqual({ width: 300, height: 200, tiles: [{ y: 0, height: 200 }] })
  })

  test('exactly three times as tall as wide is not yet a scrolled capture', () => {
    const plan = planImage(1000, 3000)
    expect(plan.tiles).toHaveLength(1)
    expect(plan.height).toBe(MAX_EDGE)
  })

  test('a long but short image is one image — nothing to cut', () => {
    expect(planImage(100, 400).tiles).toHaveLength(1)
  })

  test('a very wide image is shrunk, not cut', () => {
    const plan = planImage(9000, 1000)
    expect(plan.tiles).toHaveLength(1)
    expect(plan.width).toBe(MAX_EDGE)
  })
})

describe('planImage: a scrolled capture', () => {
  test('is cut at its own width, so every line is as large as it was on the phone', () => {
    const plan = planImage(1170, 12000)
    expect(plan.width).toBe(1170)
    expect(plan.height).toBe(12000)
    expect(plan.tiles.length).toBe(5)
    expectWholeAndOverlapping(plan)
  })

  test('is cut into slices of one height, with no sliver left over at the bottom', () => {
    // 12,000 is 4.9 slices' worth: the wrong answer is four full ones and a stub.
    const { tiles } = planImage(1170, 12000)
    expect(new Set(tiles.map((t) => t.height)).size).toBe(1)
    expect(Math.min(...tiles.map((t) => t.height))).toBeGreaterThan(MAX_EDGE / 2)
  })

  test('just over the line is two slices, each overlapping the other', () => {
    const plan = planImage(1000, 3200)
    expect(plan.tiles).toHaveLength(2)
    expectWholeAndOverlapping(plan)
  })

  test('is scaled to the limit first when it is wider than the limit', () => {
    const plan = planImage(5000, 20000)
    expect(plan.width).toBe(MAX_EDGE)
    expectWholeAndOverlapping(plan)
  })

  test('is never cut into more than MAX_TILES, however long', () => {
    for (const height of [19000, 19500, 25000, 30000, 100000]) {
      const plan = planImage(1170, height)
      expect(plan.tiles.length).toBeLessThanOrEqual(MAX_TILES)
      expectWholeAndOverlapping(plan)
    }
    // Past what MAX_TILES carries at full width, it is the whole picture that shrinks.
    const long = planImage(1170, 40000)
    expect(long.tiles).toHaveLength(MAX_TILES)
    expect(long.width).toBeLessThan(1170)
  })

  test('keeps full width up to the point MAX_TILES can carry it', () => {
    expect(planImage(1170, 19000).width).toBe(1170)
  })
})

describe('prepareImage: what it refuses before it decodes anything', () => {
  // The decoder is replaced, so these test the check and not what Bun happens to
  // have: whether a blob got as far as the decoder is the whole question.
  const realDecoder = globalThis.createImageBitmap
  afterEach(() => {
    globalThis.createImageBitmap = realDecoder
  })
  const decoderThat = (outcome: 'cannot-decode') => {
    const asked: Blob[] = []
    globalThis.createImageBitmap = (async (source: Blob) => {
      asked.push(source)
      throw new Error(outcome)
    }) as unknown as typeof createImageBitmap
    return asked
  }

  test('a blob that says it is something else never reaches the decoder', async () => {
    const asked = decoderThat('cannot-decode')
    await expect(prepareImage(new Blob(['hello'], { type: 'text/plain' }))).rejects.toThrow(
      'That file is not an image.',
    )
    await expect(prepareImage(new Blob(['%PDF'], { type: 'application/pdf' }))).rejects.toThrow(
      'That file is not an image.',
    )
    expect(asked).toHaveLength(0)
  })

  test('a blob with no type at all is handed to the decoder, which reads the bytes, not the name', async () => {
    // An extensionless screenshot, or an extension the OS has no MIME for, arrives
    // with `type === ''` and opens fine — it was being refused as "not an image".
    const asked = decoderThat('cannot-decode')
    const unlabelled = new Blob(['x'])
    expect(unlabelled.type).toBe('')
    await expect(prepareImage(unlabelled)).rejects.toThrow(/Couldn't open that image/)
    expect(asked).toEqual([unlabelled])
  })

  test('and when the decoder cannot open it, the message says so rather than calling it a non-image', async () => {
    decoderThat('cannot-decode')
    await expect(prepareImage(new Blob(['not a picture']))).rejects.not.toThrow('That file is not an image.')
  })

  test('a blob that says it is an image goes to the decoder, whatever it really is', async () => {
    const asked = decoderThat('cannot-decode')
    await expect(prepareImage(new Blob(['x'], { type: 'image/heic' }))).rejects.toThrow(
      /Couldn't open that image/,
    )
    expect(asked).toHaveLength(1)
  })
})
