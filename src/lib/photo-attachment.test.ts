// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { ImagePart } from './llm-client'
import {
  addDescription,
  createPhotoAttachment,
  placeDescription,
  removeDescription,
  thumbnailsKind,
  type PhotoState,
} from './photo-attachment'

/**
 * The races. A paste, a cancel and a slow reply each arrive on their own schedule,
 * so every test here holds the two slow steps — resizing and the model call — open
 * by hand and decides the order things happen in.
 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets every already-settled promise run its continuation. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const image = (n: number): ImagePart => ({ mediaType: 'image/jpeg', data: `IMG${n}` })
const file = new Blob(['x'], { type: 'image/png' })

function setup() {
  const states: PhotoState[] = []
  const described: string[] = []
  const discarded: string[] = []
  const prepares: ReturnType<typeof deferred<ImagePart[]>>[] = []
  const describes: {
    images: ImagePart[]
    signal: AbortSignal
    onReader: (reader?: string) => void
    done: ReturnType<typeof deferred<string>>
  }[] = []

  const attachment = createPhotoAttachment({
    prepare: () => {
      const d = deferred<ImagePart[]>()
      prepares.push(d)
      return d.promise
    },
    describe: (images, signal, onReader) => {
      const done = deferred<string>()
      describes.push({ images, signal, onReader, done })
      return done.promise
    },
    onState: (s) => states.push(s),
    onDescribed: (d) => described.push(d),
    onDiscarded: (d) => discarded.push(d),
  })
  return { attachment, states, described, discarded, prepares, describes, last: () => states.at(-1)! }
}

describe('a picture, start to finish', () => {
  test('is resized, read, and its description handed over once', async () => {
    const t = setup()
    const attaching = t.attachment.attach(file)
    expect(t.last()).toEqual({ status: 'reading' })

    t.prepares[0]!.resolve([image(1), image(2)])
    await settle()
    // One thumbnail per slice the moment there is something to show.
    expect(t.last().status).toBe('reading')
    expect(t.last().previews).toEqual([
      'data:image/jpeg;base64,IMG1',
      'data:image/jpeg;base64,IMG2',
    ])
    expect(t.describes[0]!.images).toEqual([image(1), image(2)])

    t.describes[0]!.onReader('vision-model')
    expect(t.last()).toMatchObject({ status: 'reading', reader: 'vision-model' })

    t.describes[0]!.done.resolve('A selfie beside a lake.')
    await attaching
    expect(t.described).toEqual(['A selfie beside a lake.'])
    expect(t.last()).toMatchObject({ status: 'read', reader: 'vision-model' })
  })

  test('two pastes in the same tick read once', async () => {
    const t = setup()
    void t.attachment.attach(file)
    void t.attachment.attach(file)
    expect(t.prepares).toHaveLength(1)
  })

  test('a second picture is ignored while one is being read, and while one is waiting to be checked', async () => {
    const t = setup()
    const first = t.attachment.attach(file)
    t.prepares[0]!.resolve([image(1)])
    await settle()
    await t.attachment.attach(file) // mid-read
    expect(t.prepares).toHaveLength(1)

    t.describes[0]!.done.resolve('Described.')
    await first
    await t.attachment.attach(file) // read, not yet added
    expect(t.prepares).toHaveLength(1)
  })
})

describe('a picture that will not open', () => {
  test('fails with no previews, because there is nothing to show and nothing to retry', async () => {
    const t = setup()
    const attaching = t.attachment.attach(file)
    t.prepares[0]!.reject(new Error("Couldn't open that image."))
    await attaching
    expect(t.last()).toEqual({ status: 'failed', error: "Couldn't open that image." })
    expect(t.describes).toHaveLength(0)

    t.attachment.retry()
    await settle()
    // Nothing was resized, nothing was sent: there was no picture to send again.
    expect(t.prepares).toHaveLength(1)
    expect(t.describes).toHaveLength(0)
  })

  test('is not drawn as still working — the strip has no spinner for it', () => {
    // The failure that shipped: "no slices yet" read as "still working", so an
    // error message sat beside a spinner that never stopped.
    const failedToOpen: PhotoState = { status: 'failed', error: 'nope' }
    expect(thumbnailsKind(failedToOpen)).toBe('none')
  })

  test('does not block the next one', async () => {
    const t = setup()
    const first = t.attachment.attach(file)
    t.prepares[0]!.reject(new Error('nope'))
    await first
    void t.attachment.attach(file)
    expect(t.prepares).toHaveLength(2)
  })
})

describe('a read that fails', () => {
  test('keeps the pictures, and Retry sends the same ones without the file', async () => {
    const t = setup()
    const attaching = t.attachment.attach(file)
    t.prepares[0]!.resolve([image(1)])
    await settle()
    t.describes[0]!.done.reject(new Error('mock: this model does not accept images'))
    await attaching
    expect(t.last()).toMatchObject({ status: 'failed', error: 'mock: this model does not accept images' })
    expect(t.last().previews).toHaveLength(1)
    expect(thumbnailsKind(t.last())).toBe('slices')

    t.attachment.retry()
    await settle()
    expect(t.prepares).toHaveLength(1) // not resized again
    expect(t.describes).toHaveLength(2)
    expect(t.describes[1]!.images).toBe(t.describes[0]!.images) // the very same pictures

    t.describes[1]!.done.resolve('Described.')
    await settle()
    expect(t.described).toEqual(['Described.'])
    expect(t.last().status).toBe('read')
  })

  test('Retry does nothing while a read is under way', async () => {
    const t = setup()
    void t.attachment.attach(file)
    t.prepares[0]!.resolve([image(1)])
    await settle()
    t.attachment.retry()
    expect(t.describes).toHaveLength(1)
  })
})

describe('cancelling', () => {
  test('while it is being resized: never reads, and frees the slot', async () => {
    const t = setup()
    void t.attachment.attach(file)
    t.attachment.discard()
    expect(t.last()).toEqual({ status: 'idle' })

    t.prepares[0]!.resolve([image(1)]) // the resize finishes after the cancel
    await settle()
    expect(t.describes).toHaveLength(0)
    expect(t.last()).toEqual({ status: 'idle' })

    void t.attachment.attach(file)
    expect(t.prepares).toHaveLength(2) // the slot was free again
  })

  test('mid-read: a reply that lands late lands nowhere', async () => {
    const t = setup()
    void t.attachment.attach(file)
    t.prepares[0]!.resolve([image(1)])
    await settle()

    t.attachment.discard()
    expect(t.describes[0]!.signal.aborted).toBe(true)
    expect(t.last()).toEqual({ status: 'idle' })

    t.describes[0]!.done.resolve('Too late.')
    t.describes[0]!.onReader('late-model')
    await settle()
    expect(t.described).toEqual([])
    expect(t.last()).toEqual({ status: 'idle' })
    // Nothing was in the box to take back out.
    expect(t.discarded).toEqual([])
  })

  test('an abort that surfaces as a rejection is not reported as a failure', async () => {
    const t = setup()
    void t.attachment.attach(file)
    t.prepares[0]!.resolve([image(1)])
    await settle()
    t.attachment.discard()
    t.describes[0]!.done.reject(new DOMException('The user aborted a request.', 'AbortError'))
    await settle()
    expect(t.last()).toEqual({ status: 'idle' })
  })

  test('a newer attach is not disturbed by the one it replaced finishing', async () => {
    const t = setup()
    void t.attachment.attach(file)
    t.attachment.discard()
    void t.attachment.attach(file)
    // The first resize completes now, while the second is still under way.
    t.prepares[0]!.resolve([image(1)])
    await settle()
    expect(t.describes).toHaveLength(0)
    expect(t.last()).toEqual({ status: 'reading' })

    t.prepares[1]!.resolve([image(2)])
    await settle()
    expect(t.describes).toHaveLength(1)
    expect(t.describes[0]!.images).toEqual([image(2)])
  })
})

describe('taking the picture away after it has been read', () => {
  async function read(t: ReturnType<typeof setup>) {
    const attaching = t.attachment.attach(file)
    t.prepares[0]!.resolve([image(1)])
    await settle()
    t.describes[0]!.done.resolve('A selfie beside a lake.')
    await attaching
  }

  test('discard hands back exactly the description it delivered', async () => {
    const t = setup()
    await read(t)
    t.attachment.discard()
    expect(t.discarded).toEqual(['A selfie beside a lake.'])
    expect(t.last()).toEqual({ status: 'idle' })
  })

  test('clear — after the turn was added — takes nothing back: the box is already empty', async () => {
    const t = setup()
    await read(t)
    t.attachment.clear()
    expect(t.discarded).toEqual([])
    expect(t.last()).toEqual({ status: 'idle' })
  })

  test('discarding twice takes it back once', async () => {
    const t = setup()
    await read(t)
    t.attachment.discard()
    t.attachment.discard()
    expect(t.discarded).toHaveLength(1)
  })

  test('the slot is free afterwards', async () => {
    const t = setup()
    await read(t)
    t.attachment.discard()
    void t.attachment.attach(file)
    expect(t.prepares).toHaveLength(2)
  })
})

describe('the panel goes away mid-read', () => {
  test('stop aborts the read and changes nothing else, so a late reply lands nowhere', async () => {
    const t = setup()
    void t.attachment.attach(file)
    t.prepares[0]!.resolve([image(1)])
    await settle()
    const before = t.states.length

    t.attachment.stop()
    expect(t.describes[0]!.signal.aborted).toBe(true)
    t.describes[0]!.done.resolve('Nobody is listening.')
    await settle()
    expect(t.described).toEqual([])
    expect(t.states).toHaveLength(before)
  })
})

describe('thumbnailsKind', () => {
  test('is the slices once there are any, in whatever state', () => {
    for (const status of ['reading', 'read', 'failed'] as const) {
      expect(thumbnailsKind({ status, previews: ['a'] })).toBe('slices')
    }
  })

  test('is a spinner only while there is still something on its way', () => {
    expect(thumbnailsKind({ status: 'reading' })).toBe('pending')
    expect(thumbnailsKind({ status: 'reading', previews: [] })).toBe('pending')
  })

  test('is nothing when there is nothing and never will be', () => {
    expect(thumbnailsKind({ status: 'failed', error: 'x' })).toBe('none')
    expect(thumbnailsKind({ status: 'idle' })).toBe('none')
  })
})

describe('addDescription', () => {
  test('fills an empty box', () => {
    expect(addDescription('', 'A lake.')).toBe('A lake.')
    expect(addDescription('  \n ', 'A lake.')).toBe('A lake.')
  })

  test('goes beneath what is typed, never over it', () => {
    expect(addDescription('she sent this', 'A lake.')).toBe('she sent this\n\nA lake.')
  })

  test('does not stack blank lines on a box that already ends in them', () => {
    expect(addDescription('she sent this\n\n\n', 'A lake.')).toBe('she sent this\n\nA lake.')
  })
})

describe('removeDescription', () => {
  const d = 'A selfie beside a lake.\n\nGreen coat.'

  test('empties a box that held only the description', () => {
    expect(removeDescription(d, d)).toBe('')
  })

  test('leaves what was typed before it, without the blank lines it sat behind', () => {
    expect(removeDescription(`she sent this\n\n${d}`, d)).toBe('she sent this')
  })

  test('leaves what was typed after it', () => {
    expect(removeDescription(`${d}\n\nand then she said hi`, d)).toBe('and then she said hi')
  })

  test('joins what is on either side with one blank line, not a gap and not a weld', () => {
    // The shape the first version got wrong: three newlines left where it was.
    expect(removeDescription(`what she said\n\n${d}\nand then`, d)).toBe('what she said\n\nand then')
    expect(removeDescription(`what she said\n\n${d}\n\n\n\nand then`, d)).toBe(
      'what she said\n\nand then',
    )
  })

  test('does not reformat the rest of the box', () => {
    // Indentation at the start, and blank lines the user typed elsewhere: theirs.
    const box = `    indented start\n\n\n\nstill theirs\n\n${d}`
    expect(removeDescription(box, d)).toBe('    indented start\n\n\n\nstill theirs')
  })

  test('leaves an edited description alone: those are the user’s sentences now', () => {
    const edited = `she sent this\n\n${d.replace('Green coat.', 'Green coat, Swedish lake.')}`
    expect(removeDescription(edited, d)).toBe(edited)
  })

  test('leaves the box alone when the description is gone altogether', () => {
    expect(removeDescription('something else entirely', d)).toBe('something else entirely')
  })
})

describe('placeDescription: a picture that was imported as a placeholder', () => {
  const d = 'A selfie beside a lake.\n\nGreen coat.'

  test('replaces a bare [image] — Instagram — with the description, and nothing else', () => {
    // The case that mattered: the placeholder stays in front of its own description,
    // "[image] A selfie…", and the fact is stated twice, one of them a stub.
    expect(placeDescription('[image]', d).text).toBe(d)
  })

  test.each([
    '[image]',
    '[photo]',
    '[Image]',
    '[PHOTO]',
    '[picture]',
    '[disappearing photo]',
    '[view-once photo]',
    '[view-once image]',
  ])('knows %s for a picture', (token) => {
    expect(placeDescription(token, d).text).toBe(d)
  })

  test('leaves the rest of the line where it was, each on its own side', () => {
    // A reply tag before, a reaction after: both survive, as paragraphs either side.
    expect(placeDescription('[re: where is that] [image] [❤️]', d).text).toBe(
      `[re: where is that]\n\n${d}\n\n[❤️]`,
    )
  })

  test('puts a caption in a paragraph of its own, not welded onto the description', () => {
    expect(placeDescription('[photo] look at this view!', d).text).toBe(`${d}\n\nlook at this view!`)
  })

  test('replaces only the first, when there is more than one', () => {
    expect(placeDescription('[image] and then [image]', d).text).toBe(`${d}\n\nand then [image]`)
  })

  test('is not for things a photo reader cannot stand in for', () => {
    // Appended instead — the box's own rule — and the placeholder is left standing.
    for (const text of ['[video]', '[sticker]', '[voice message 0:12]', '[2 × image]']) {
      expect(placeDescription(text, d).text).toBe(`${text}\n\n${d}`)
    }
  })

  test('goes beneath ordinary text, like the composer, and fills an empty box', () => {
    expect(placeDescription('she sent this', d).text).toBe(`she sent this\n\n${d}`)
    expect(placeDescription('', d).text).toBe(d)
  })

  test('survives a description full of characters a replacement string would eat', () => {
    // `$&` is "the whole match" to String.replace; a price or a username is not.
    const tricky = 'A menu: tea costs $&, a cake $1, and $$ is a sign. Handle "$`" and \'$\'.'
    const placed = placeDescription('[image]', tricky)
    expect(placed.text).toBe(tricky)
    expect(placed.undo(`x\n\n${tricky}\n\ny`)).toBe(`x\n\n[image]\n\ny`)
  })
})

describe('placeDescription: taking it back out', () => {
  const d = 'A selfie beside a lake.\n\nGreen coat.'

  test.each([
    '[image]',
    '[re: where is that] [image] [❤️]',
    '[photo] look at this view!',
    'she sent this',
    '',
  ])('untouched since, restores %p exactly', (original) => {
    const placed = placeDescription(original, d)
    expect(placed.undo(placed.text)).toBe(original)
  })

  test('edited elsewhere: the placeholder goes back where the description sat', () => {
    const placed = placeDescription('[image]', d)
    expect(placed.undo(`${placed.text}\n\nand she said hi`)).toBe('[image]\n\nand she said hi')
  })

  test('edited elsewhere, with nothing displaced: the description is simply removed', () => {
    const placed = placeDescription('she sent this', d)
    expect(placed.undo(`${placed.text}\n\nand she said hi`)).toBe('she sent this\n\nand she said hi')
  })

  test('once the description itself has been edited, those are the user’s sentences: left alone', () => {
    const placed = placeDescription('[image]', d)
    const edited = placed.text.replace('Green coat.', 'Swedish green coat.')
    expect(placed.undo(edited)).toBe(edited)
  })
})
