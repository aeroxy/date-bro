// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import type { ImagePart } from './llm-client'
import {
  createPhotoSession,
  endPhotoSession,
  photoSessionFor,
  photoStatusStore,
  type PhotoSink,
} from './photo-session'

/**
 * A panel comes and goes on a switch of person; the read does not. Every test holds
 * the two slow steps — resizing and the model call — open by hand, so it decides
 * whether the panel is there when each one finishes.
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
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const image = (n: number): ImagePart => ({ mediaType: 'image/jpeg', data: `IMG${n}` })
const file = new Blob(['x'], { type: 'image/png' })

function rig() {
  const prepares: ReturnType<typeof deferred<ImagePart[]>>[] = []
  const describes: {
    signal: AbortSignal
    done: ReturnType<typeof deferred<string>>
  }[] = []
  const deps = {
    prepare: () => {
      const d = deferred<ImagePart[]>()
      prepares.push(d)
      return d.promise
    },
    describe: (_images: ImagePart[], signal: AbortSignal) => {
      const done = deferred<string>()
      describes.push({ signal, done })
      return done.promise
    },
  }
  return { deps, prepares, describes }
}

/** A box: records what it was told, in order. */
function box() {
  const described: string[] = []
  const discarded: string[] = []
  const sink: PhotoSink = {
    describe: (d) => described.push(d),
    discard: (d) => discarded.push(d),
  }
  return { sink, described, discarded }
}

/** Start a read and hold it at the model call. */
async function reading(t: ReturnType<typeof rig>, session: ReturnType<typeof createPhotoSession>) {
  const attaching = session.attach(file)
  t.prepares[0]!.resolve([image(1)])
  await settle()
  return attaching
}

describe('a read that belongs to the person, not the panel', () => {
  test('is delivered at once to a box that is there when it finishes', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const panel = box()
    session.bind(panel.sink)

    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.resolve('A selfie beside a lake.')
    await attaching

    expect(panel.described).toEqual(['A selfie beside a lake.'])
    expect(session.getState().status).toBe('read')
  })

  test('is not stopped by the panel going away — the bug this exists for', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const unbind = session.bind(box().sink)
    void reading(t, session)
    await settle()

    unbind() // switched to someone else; the panel unmounts
    // The request is still wanted. Previously it was aborted here and its answer,
    // already paid for, thrown away.
    expect(t.describes[0]!.signal.aborted).toBe(false)
    expect(session.getState().status).toBe('reading')
  })

  test('finishes with nobody looking, and the description waits', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const gone = box()
    const unbind = session.bind(gone.sink)
    const attaching = reading(t, session)
    await settle()
    unbind()

    t.describes[0]!.done.resolve('A selfie beside a lake.')
    await attaching
    expect(gone.described).toEqual([]) // nobody was told
    expect(session.getState().status).toBe('read') // but it is there to be asked for
  })

  test('is brought to the next box that appears', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const unbind = session.bind(box().sink)
    const attaching = reading(t, session)
    await settle()
    unbind()
    t.describes[0]!.done.resolve('A selfie beside a lake.')
    await attaching

    const next = box() // the user comes back: a fresh panel, a fresh box
    session.bind(next.sink)
    expect(next.described).toEqual(['A selfie beside a lake.'])
  })

  test('is brought back to a new box even if the old one had already been given it', async () => {
    // Read while looking; switched away and back. The first box, and anything typed
    // in it, is gone — the description is the part that survives.
    const t = rig()
    const session = createPhotoSession(t.deps)
    const first = box()
    const unbind = session.bind(first.sink)
    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.resolve('A selfie beside a lake.')
    await attaching
    expect(first.described).toHaveLength(1)

    unbind()
    const second = box()
    session.bind(second.sink)
    expect(second.described).toEqual(['A selfie beside a lake.'])
  })

  test('is offered again on every bind, which is why a box has to keep one copy', async () => {
    // React's development double-mount runs every effect twice: bind, unbind, bind.
    const t = rig()
    const session = createPhotoSession(t.deps)
    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.resolve('Described.')
    await attaching

    const panel = box()
    session.bind(panel.sink)()
    session.bind(panel.sink)
    expect(panel.described).toEqual(['Described.', 'Described.'])
  })

  test('offers nothing while idle, reading or failed — there is no description to bring back', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const idle = box()
    session.bind(idle.sink)
    expect(idle.described).toEqual([])

    const attaching = reading(t, session)
    await settle()
    const midRead = box()
    session.bind(midRead.sink)
    expect(midRead.described).toEqual([])

    t.describes[0]!.done.reject(new Error('nope'))
    await attaching
    const failed = box()
    session.bind(failed.sink)
    expect(failed.described).toEqual([])
  })
})

describe('binding', () => {
  test('a stale unbind does not unplug a newer box', async () => {
    // The old panel's cleanup can land after the new panel has bound.
    const t = rig()
    const session = createPhotoSession(t.deps)
    const oldBox = box()
    const newBox = box()
    const unbindOld = session.bind(oldBox.sink)
    session.bind(newBox.sink)
    unbindOld()

    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.resolve('Described.')
    await attaching
    expect(newBox.described).toEqual(['Described.'])
    expect(oldBox.described).toEqual([])
  })
})

describe('what happens to the picture while the person is not on screen', () => {
  test('a failure waits as a failure, and Retry works when they come back', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const unbind = session.bind(box().sink)
    const attaching = reading(t, session)
    await settle()
    unbind()

    t.describes[0]!.done.reject(new Error('mock: this model does not accept images'))
    await attaching
    expect(session.getState()).toMatchObject({ status: 'failed', error: 'mock: this model does not accept images' })

    const back = box()
    session.bind(back.sink)
    session.retry()
    await settle()
    t.describes[1]!.done.resolve('Described.')
    await settle()
    expect(back.described).toEqual(['Described.'])
    expect(session.getState().status).toBe('read')
  })

  test('discarding takes the description out of the box it is now in', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.resolve('Described.')
    await attaching

    const panel = box()
    session.bind(panel.sink)
    session.discard()
    expect(panel.discarded).toEqual(['Described.'])
    expect(session.getState().status).toBe('idle')
  })

  test('and then there is nothing left to bring back', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.resolve('Described.')
    await attaching
    session.discard()

    const later = box()
    session.bind(later.sink)
    expect(later.described).toEqual([])
  })

  test('adding the turn clears it the same way, without asking the box to take anything back', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const panel = box()
    session.bind(panel.sink)
    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.resolve('Described.')
    await attaching

    session.clear() // what Add does: the box was emptied by hand already
    expect(panel.discarded).toEqual([])
    const later = box()
    session.bind(later.sink)
    expect(later.described).toEqual([])
  })
})

describe('a session that belongs to a dialog instead', () => {
  test('stop still aborts — that reader dies with its dialog', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    void reading(t, session)
    await settle()
    session.stop()
    expect(t.describes[0]!.signal.aborted).toBe(true)
  })
})

describe('the state a store can read', () => {
  test('is the same object until it changes, and every change is announced', async () => {
    const t = rig()
    const session = createPhotoSession(t.deps)
    const first = session.getState()
    expect(session.getState()).toBe(first)

    let heard = 0
    const stop = session.subscribe(() => heard++)
    const attaching = session.attach(file)
    expect(heard).toBe(1) // reading, no pictures yet
    expect(session.getState()).not.toBe(first)

    t.prepares[0]!.resolve([image(1)])
    await settle()
    const seen = heard
    expect(seen).toBeGreaterThanOrEqual(2)
    expect(session.getState()).toBe(session.getState())

    stop()
    t.describes[0]!.done.resolve('Described.')
    await attaching
    expect(heard).toBe(seen) // unsubscribed: not told of the settled state
  })
})

describe('the registry', () => {
  const newId = () => `person-${crypto.randomUUID()}`

  test('one session per person, and each person has their own', () => {
    const t = rig()
    const [a, b] = [newId(), newId()]
    expect(photoSessionFor(a, t.deps)).toBe(photoSessionFor(a, t.deps))
    expect(photoSessionFor(a, t.deps)).not.toBe(photoSessionFor(b, t.deps))
    endPhotoSession(a)
    endPhotoSession(b)
  })

  test('says who has a photo in flight or waiting, and nobody else', async () => {
    const t = rig()
    const [busy, quiet] = [newId(), newId()]
    const session = photoSessionFor(busy, t.deps)
    photoSessionFor(quiet, t.deps)
    const status = () => photoStatusStore.getSnapshot()

    expect(status().has(busy)).toBe(false) // idle people are not listed
    const attaching = session.attach(file)
    expect(status().get(busy)).toBe('reading')
    t.prepares[0]!.resolve([image(1)])
    await settle()
    t.describes[0]!.done.resolve('Described.')
    await attaching
    expect(status().get(busy)).toBe('read')
    expect(status().has(quiet)).toBe(false)

    session.clear()
    expect(status().has(busy)).toBe(false)
    endPhotoSession(busy)
    endPhotoSession(quiet)
  })

  test('shows a failure too, so a read that failed while away is not mistaken for none', async () => {
    const t = rig()
    const id = newId()
    const session = photoSessionFor(id, t.deps)
    const attaching = reading(t, session)
    await settle()
    t.describes[0]!.done.reject(new Error('nope'))
    await attaching
    expect(photoStatusStore.getSnapshot().get(id)).toBe('failed')
    endPhotoSession(id)
  })

  test('is a snapshot that only changes when someone\'s status does', async () => {
    const t = rig()
    const id = newId()
    const session = photoSessionFor(id, t.deps)
    const before = photoStatusStore.getSnapshot()
    session.clear() // idle to idle: nothing changed
    expect(photoStatusStore.getSnapshot()).toBe(before)

    let heard = 0
    const stop = photoStatusStore.subscribe(() => heard++)
    void session.attach(file)
    expect(heard).toBe(1)
    expect(photoStatusStore.getSnapshot()).not.toBe(before)
    stop()
    endPhotoSession(id)
  })

  test('two people read at once without touching each other', async () => {
    const t = rig()
    const [a, b] = [newId(), newId()]
    const [first, second] = [photoSessionFor(a, t.deps), photoSessionFor(b, t.deps)]
    const boxA = box()
    first.bind(boxA.sink)
    void first.attach(file)
    void second.attach(file)
    t.prepares[0]!.resolve([image(1)])
    t.prepares[1]!.resolve([image(2)])
    await settle()

    t.describes[1]!.done.resolve('B described.')
    await settle()
    expect(second.getState().status).toBe('read')
    expect(first.getState().status).toBe('reading') // still going
    expect(boxA.described).toEqual([])
    endPhotoSession(a)
    endPhotoSession(b)
  })

  test('ending a person stops their read, and the late reply lands nowhere', async () => {
    const t = rig()
    const id = newId()
    const session = photoSessionFor(id, t.deps)
    const panel = box()
    session.bind(panel.sink)
    void reading(t, session)
    await settle()

    endPhotoSession(id)
    expect(t.describes[0]!.signal.aborted).toBe(true)
    expect(photoStatusStore.getSnapshot().has(id)).toBe(false)

    t.describes[0]!.done.resolve('Too late.')
    await settle()
    expect(panel.described).toEqual([])
    // And they start clean if the id ever comes back.
    expect(photoSessionFor(id, t.deps)).not.toBe(session)
    endPhotoSession(id)
  })

  test('ending someone who never had a session is nothing', () => {
    expect(() => endPhotoSession(`person-${crypto.randomUUID()}`)).not.toThrow()
  })
})
