import {
  createPhotoAttachment,
  type PhotoAttachment,
  type PhotoAttachmentDeps,
  type PhotoState,
} from './photo-attachment'

/** The box a description belongs in, for as long as someone is looking at it. */
export interface PhotoSink {
  /** A description has arrived — or is being brought back to a box that was thrown away. */
  describe: (description: string) => void
  /** The picture was thrown away: take its description out again. */
  discard: (description: string) => void
}

export interface PhotoSession extends PhotoAttachment {
  /** The current state. The same object until it changes, so a store can compare it by identity. */
  getState: () => PhotoState
  subscribe: (listener: () => void) => () => void
  /**
   * Show a box to this session. Returns the way to stop, which only unbinds *that*
   * box — an old panel's cleanup landing after a new one has bound must not
   * unplug the new one.
   */
  bind: (sink: PhotoSink) => () => void
}

/**
 * An attachment that does not belong to whatever is on screen.
 *
 * A read takes seconds, and it is the user's to start and the panel's to show — but
 * the panel is keyed on the person, so switching to someone else unmounts it, and a
 * read owned by the panel died with it: the request was already paid for, its
 * answer was thrown away, and nothing said so. So the read belongs to the person
 * instead, as every other run in the app does. The panel *binds* to it while it is
 * showing, and unbinding is not stopping.
 *
 * What the panel loses on a switch is its box — the draft is local state and always
 * has been — and what a session holds is what the box was for. A description that
 * arrives while nobody is bound is not delivered anywhere; it waits, and `bind`
 * brings it back to whatever box is there next. So does a description that had
 * already been delivered to a box that has since been thrown away: a session in
 * `read` is a description waiting to be checked, and the box it was in is gone.
 * Anything typed around it, or changes made to it, went with that box; what comes
 * back is what the model wrote.
 *
 * That makes delivery happen more than once, so a sink must take the same
 * description twice and keep one copy — React's development double-mount does
 * exactly this to every effect.
 */
export function createPhotoSession(
  deps: Pick<PhotoAttachmentDeps, 'prepare' | 'describe'>,
): PhotoSession {
  let state: PhotoState = { status: 'idle' }
  // The description on offer: what `read` is a state of. Only looked at while the
  // state *is* `read`, and every way into `read` writes it first, so it is never
  // stale and never needs clearing.
  let waiting: string | null = null
  let sink: PhotoSink | null = null
  const listeners = new Set<() => void>()

  const attachment = createPhotoAttachment({
    ...deps,
    onState: (next) => {
      state = next
      for (const listener of [...listeners]) listener()
    },
    onDescribed: (description) => {
      waiting = description
      sink?.describe(description)
    },
    onDiscarded: (description) => sink?.discard(description),
  })

  return {
    ...attachment,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    bind: (next) => {
      sink = next
      if (state.status === 'read' && waiting) next.describe(waiting)
      return () => {
        if (sink === next) sink = null
      }
    },
  }
}

const sessions = new Map<string, PhotoSession>()

/**
 * Which people have a photo in some state other than none, for the rail: a read you
 * started and switched away from has nothing else on screen saying it exists, or
 * that it finished and is waiting to be checked. Replaced rather than mutated, so
 * `getSnapshot` is stable between changes, as a store requires.
 */
let statuses: ReadonlyMap<string, PhotoState['status']> = new Map()
const watchers = new Set<() => void>()

function publish(id: string, status: PhotoState['status']) {
  if ((statuses.get(id) ?? 'idle') === status) return
  const next = new Map(statuses)
  if (status === 'idle') next.delete(id)
  else next.set(id, status)
  statuses = next
  for (const watcher of [...watchers]) watcher()
}

export const photoStatusStore = {
  subscribe: (watcher: () => void) => {
    watchers.add(watcher)
    return () => {
      watchers.delete(watcher)
    }
  },
  getSnapshot: () => statuses,
}

/** This person's session, made the first time it is asked for. */
export function photoSessionFor(
  id: string,
  deps: Pick<PhotoAttachmentDeps, 'prepare' | 'describe'>,
): PhotoSession {
  let session = sessions.get(id)
  if (!session) {
    const created = createPhotoSession(deps)
    created.subscribe(() => publish(id, created.getState().status))
    sessions.set(id, created)
    session = created
  }
  return session
}

/**
 * The person is gone. Their read goes with them: an answer arriving for someone
 * who is no longer there has nowhere to be shown, and the same reasoning stops a
 * rebuild at the same moment (see `onDelete` in App).
 */
export function endPhotoSession(id: string) {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  session.clear()
  publish(id, 'idle')
}
