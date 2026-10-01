import { dataUrl, type ImagePart } from './llm-client'

export interface PhotoState {
  /** `read` is the settled state: the description is in the box and waiting to be checked. */
  status: 'idle' | 'reading' | 'read' | 'failed'
  /**
   * The picture as it was sent, so the description can be checked against it: one
   * entry, or a slice each for a long screenshot that was cut up. Absent when
   * there is nothing to show yet — still being resized — or never will be: a file
   * that would not open has no slices.
   */
  previews?: string[]
  /** The model that read it. */
  reader?: string
  error?: string
}

export interface PhotoAttachmentDeps {
  /** A file the user gave us → the images that carry it (see `prepareImage`). */
  prepare: (file: Blob) => Promise<ImagePart[]>
  /**
   * The description of those images. `onReader` is told which model is doing the
   * reading as soon as that is known, which is before the answer is.
   */
  describe: (
    images: ImagePart[],
    signal: AbortSignal,
    onReader: (reader?: string) => void,
  ) => Promise<string>
  /** Every change of state, for whatever draws it. */
  onState: (state: PhotoState) => void
  /** The description, once it has come back and while it is still wanted. */
  onDescribed: (description: string) => void
  /** Given back the text `onDescribed` was given, to take out of the box again. */
  onDiscarded: (description: string) => void
}

export interface PhotoAttachment {
  /** Read a picture and hand its description to `onDescribed`. One at a time. */
  attach: (file: Blob) => Promise<void>
  /** Re-send the pictures that failed, without asking for the file again. */
  retry: () => void
  /**
   * Forget the picture and stop any read still under way. For after a turn has
   * been added, when the box is already empty.
   */
  clear: () => void
  /**
   * Throw the picture away, and its description with it if that is still in the
   * box as it was written. The ✕ on the strip.
   */
  discard: () => void
  /**
   * Abort a read in flight and change nothing else — for an unmount. Not a
   * teardown: the same object must keep working if the component is mounted again,
   * which is what React's development double-mount does.
   */
  stop: () => void
}

/**
 * The life of one attached picture: resized, read, checked, and either added or
 * thrown away. Turns a picture into text and hands it back, and remembers nothing
 * about it once cleared.
 *
 * The description is delivered to the caller rather than stored here — it goes
 * into the composer's box, where the user reads it against the thumbnail, fixes
 * what it got wrong and decides whose it is. The same shape as an import: a
 * machine types into the box, and what lands in the conversation is what is left
 * after a person has looked. A vision model can be confidently wrong, and this is
 * the only place its output is ever checked.
 *
 * Kept free of React so the races can be tested, and they are where this goes
 * wrong: a paste and a cancel and a slow reply all arrive on their own schedules.
 * Two rules carry most of it.
 *
 * **One picture at a time, and a second is ignored rather than replacing the
 * first**: replacing would either leave two descriptions in one turn or quietly
 * discard one the user hadn't added yet. `occupied` is set synchronously, before
 * anything is awaited, because two pastes can land in the same tick, before any
 * state has said anything.
 *
 * **Each attempt owns an `AbortController`, and anything that finds it aborted
 * returns without touching state.** Whoever aborted it (a discard, a cancel, a
 * newer attach) has already moved the state on, so a reply that lands late, or an
 * abort that surfaces as a rejection, must neither write a description into the
 * box nor paint the strip with a failure that never happened.
 */
export function createPhotoAttachment(deps: PhotoAttachmentDeps): PhotoAttachment {
  // What was sent, kept for Retry.
  let images: ImagePart[] | null = null
  let run: AbortController | null = null
  let occupied = false
  // The description handed over, so that discarding the picture can take exactly
  // that back out.
  let delivered: string | null = null

  const show = (state: PhotoState) => deps.onState(state)

  async function read(prepared: ImagePart[], controller: AbortController) {
    const previews = prepared.map(dataUrl)
    let reader: string | undefined
    show({ status: 'reading', previews })
    try {
      const description = await deps.describe(prepared, controller.signal, (name) => {
        reader = name
        if (!controller.signal.aborted) show({ status: 'reading', previews, reader })
      })
      if (controller.signal.aborted) return
      delivered = description
      deps.onDescribed(description)
      show({ status: 'read', previews, reader })
    } catch (e) {
      if (controller.signal.aborted) return
      occupied = false
      show({ status: 'failed', previews, error: (e as Error).message })
    }
  }

  async function attach(file: Blob) {
    if (occupied) return
    occupied = true
    const controller = new AbortController()
    run = controller
    images = null
    show({ status: 'reading' })
    let prepared: ImagePart[]
    try {
      prepared = await deps.prepare(file)
    } catch (e) {
      if (controller.signal.aborted) return
      occupied = false
      // No previews: a file that would not open has nothing to show, and nothing
      // to retry — the strip draws that as an error and no more.
      show({ status: 'failed', error: (e as Error).message })
      return
    }
    // Discarded while it was being resized.
    if (controller.signal.aborted) return
    images = prepared
    await read(prepared, controller)
  }

  function retry() {
    if (!images || occupied) return
    occupied = true
    const controller = new AbortController()
    run = controller
    void read(images, controller)
  }

  function clear() {
    run?.abort()
    run = null
    images = null
    delivered = null
    occupied = false
    show({ status: 'idle' })
  }

  function discard() {
    const description = delivered
    clear()
    if (description) deps.onDiscarded(description)
  }

  return { attach, retry, clear, discard, stop: () => run?.abort() }
}

/**
 * What goes at the head of the strip: the thumbnails once there are any, a
 * spinner while there are about to be, and nothing when there never will be.
 *
 * The last is the case that was wrong. A picture that would not open — a HEIC, a
 * file that isn't an image — fails before it has any slices, and "no slices yet"
 * was read as "still working": an error message with a spinner beside it that never
 * stopped, on the most likely way this feature fails.
 */
export function thumbnailsKind(photo: PhotoState): 'slices' | 'pending' | 'none' {
  if (photo.previews?.length) return 'slices'
  return photo.status === 'reading' ? 'pending' : 'none'
}

/**
 * A description goes into the box beneath whatever is already typed, never over it
 * — the user may have started on what they were told about the picture.
 */
export function addDescription(text: string, description: string): string {
  return text.trim() ? `${text.trimEnd()}\n\n${description}` : description
}

/**
 * Takes a description back out of the box, but only while it is still there as it
 * was written. Once it has been edited it is the user's own sentences, and
 * throwing a picture away is no reason to delete those; left in unedited it would
 * be worse than either — a machine's paragraph with nothing marking it as one,
 * ready to be added as if it were typed.
 *
 * Only the seam it leaves is tidied: the whitespace touching where it was, which is
 * replaced by one blank line between whatever is on either side, or nothing when
 * one side is empty. The rest of the box is the user's and is not reformatted — no
 * trimming of their indentation, and no collapsing of blank lines they typed
 * elsewhere.
 */
export function removeDescription(text: string, description: string): string {
  const at = text.indexOf(description)
  if (at < 0) return text
  const before = text.slice(0, at).trimEnd()
  const after = text.slice(at + description.length).trimStart()
  return before && after ? `${before}\n\n${after}` : before || after
}

/**
 * A picture standing in for itself in an imported line: what the importers write
 * where a message was only a photo — `[image]` (Instagram, Discord), `[photo]`
 * (WhatsApp, Telegram), `[disappearing photo]`, `[view-once photo]`. Only those:
 * `[video]`, `[sticker]` and `[voice message 0:12]` are not pictures a photo reader
 * can stand in for, and `[2 × image]` is more than the one picture being read.
 */
const PICTURE_PLACEHOLDER = /\[(?:(?:disappearing|view-once)\s+)?(?:image|photo|picture)\]/i

/**
 * Where a description goes in the text of a turn that already exists — which, for a
 * photo imported as `[image]`, is *in place of* that, not underneath it.
 *
 * Underneath is the composer's rule (`addDescription`) and is right for a box the
 * user is typing in. Here the line already says there was a picture and says nothing
 * else, and leaving the placeholder in front of its own description would read
 * "[image] A selfie…" — the same fact twice, one of them a stub. So the placeholder
 * is the thing replaced, and whatever else the line carried stays on its own side of
 * it: a reply tag before, a reaction after, a caption (`[photo] look at this`)
 * as its own paragraph rather than welded onto the end of the description.
 *
 * Returns the new text and `undo`, which takes the placement back out. Discarding
 * the picture should leave the turn as it was, and "as it was" is only
 * reconstructible by the one who knows what was displaced: untouched since, it
 * returns the original *exactly*; edited elsewhere, it puts the placeholder back
 * where the description sat (or removes the description, if there was none); and once
 * the description itself has been edited it is the user's sentences and is left alone.
 *
 * Built from slices rather than `String.replace`, because a description is free
 * text and a replacement string reads `$&` and `$1` as instructions — "it cost $&"
 * must not come out as "it cost [image]".
 */
export function placeDescription(
  text: string,
  description: string,
): { text: string; undo: (current: string) => string } {
  const match = PICTURE_PLACEHOLDER.exec(text)
  const placed = match
    ? [
        text.slice(0, match.index).trimEnd(),
        description,
        text.slice(match.index + match[0].length).trimStart(),
      ]
        .filter(Boolean)
        .join('\n\n')
    : addDescription(text, description)

  return {
    text: placed,
    undo: (current) => {
      if (current === placed) return text
      const at = current.indexOf(description)
      if (at < 0) return current
      return match
        ? current.slice(0, at) + match[0] + current.slice(at + description.length)
        : removeDescription(current, description)
    },
  }
}
