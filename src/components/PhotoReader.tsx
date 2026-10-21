import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ImagePlus, RotateCw, X } from 'lucide-react'

import { describePhoto } from '@/coach/photo'
import { imageFromClipboard } from '@/lib/clipboard-image'
import { downloadImage, imageFromDrop, mightBeAPicture } from '@/lib/drop-image'
import { prepareImage } from '@/lib/image'
import { thumbnailsKind, type PhotoAttachment, type PhotoState } from '@/lib/photo-attachment'
import {
  createPhotoSession,
  photoSessionFor,
  type PhotoSession,
  type PhotoSink,
} from '@/lib/photo-session'
import { getPhotoConfig } from '@/lib/storage'
import { Button } from './ui/Button'
import { dialogOpen } from './ui/Modal'
import { Spinner } from './ui/Spinner'

export interface PhotoReader extends Pick<PhotoAttachment, 'attach' | 'retry' | 'clear' | 'discard'> {
  photo: PhotoState
  /** Something that might be a picture is being dragged over the page, and this reader would take it. */
  dragging: boolean
}

/** The real resize and the real model call, which a session is given rather than imports. */
const REAL = {
  prepare: async (source: Blob | URL) =>
    prepareImage(source instanceof URL ? await downloadImage(source) : source),
  describe: async (
    images: Parameters<typeof describePhoto>[1],
    signal: AbortSignal,
    onReader: (reader?: string) => void,
  ) => {
    const config = await getPhotoConfig()
    onReader(config.model || undefined)
    return describePhoto(config, images, signal)
  },
}

/** Whether the reader that lives here is the one on show: a dialog's, or the page's with no dialog over it. */
const showing = (inModal?: boolean) => inModal || !dialogOpen()

/** A text box, which takes drops of its own. */
const intoText = (target: EventTarget | null) =>
  target instanceof Element && target.matches('textarea, input')

/**
 * A `PhotoSession` bound to a component: its state becomes what the component
 * renders, the real resize and model call are wired in, and the paste and drop
 * handlers are added. The logic is in `lib/photo-attachment.ts` and `lib/photo-session.ts`,
 * where it can be tested without a DOM.
 *
 * **Whose read it is depends on where the reader lives.** The composer passes
 * `personId` and gets that person's session, which outlives this component: the
 * panel is keyed on the person, so switching to someone else unmounts it, and a read
 * that died with the panel was a request already paid for, its answer thrown away
 * and nothing on screen to say so. Unmounting only *unbinds*; the description waits
 * for the next panel (`createPhotoSession` has the details). A reader inside a dialog
 * passes no id and gets a session of its own, which stops with the dialog — there
 * is no one to come back to it.
 *
 * **Pasting is listened for on the document**, not on the composer. A photo copied
 * in another tab is pasted with focus nowhere in particular — ⌘V on coming back,
 * as in every chat app — and a listener on the composer never hears it. It is also
 * taken from any text field on the page, the "Tell it about" box included, whose
 * own hint invites pasting a dating profile: an image pasted into a box that takes
 * text was never going to land there, so the alternative is doing nothing, and
 * nothing is the failure this exists to remove. The one place it is not taken is
 * with a modal open, where the photo would attach to a box behind the dialog and
 * nobody would be looking.
 *
 * Which is why a reader that lives *inside* a modal says so (`inModal`): the
 * composer's reader ignores a paste while any dialog is open, so the dialog's own
 * reader must be the one that takes it — exactly one of them, whichever is
 * showing, so a paste is never read twice. The edit dialog has one, because the
 * turns that most need a picture read into them were imported as a bare `[image]`.
 *
 * **Dropping is the same again**: heard on the document, so a photo dropped
 * anywhere on the page lands in the box, and taken by whichever reader is showing.
 * What a drop carries is `imageFromDrop`'s business (`lib/drop-image.ts`): a file,
 * or for an image dragged out of another tab its address, which the read downloads.
 */
export function usePhotoReader(options: {
  /** This composer's person: their read outlives the panel showing it. Absent in a dialog. */
  personId?: string
  /** This reader belongs to a modal that is open for as long as it exists: take pastes even though a dialog is up. */
  inModal?: boolean
  /** May be handed the same description twice — see `createPhotoSession` — so it must keep one copy. */
  onDescribed: (description: string) => void
  /** Given back the text `onDescribed` was given, to take out of the box again. */
  onDiscarded: (description: string) => void
}): PhotoReader {
  const { personId } = options
  const own = useRef<PhotoSession | null>(null)
  let session: PhotoSession
  if (personId) {
    session = photoSessionFor(personId, REAL)
  } else {
    own.current ??= createPhotoSession(REAL)
    session = own.current
  }
  const photo = useSyncExternalStore(session.subscribe, session.getState)
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    const sink: PhotoSink = {
      describe: (description) => latest.current.onDescribed(description),
      discard: (description) => latest.current.onDiscarded(description),
    }
    return session.bind(sink)
  }, [session])

  // Only a reader nobody can come back to is stopped on unmount.
  useEffect(() => (personId ? undefined : () => session.stop()), [session, personId])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !e.clipboardData) return
      if (!showing(latest.current.inModal)) return
      const file = imageFromClipboard(e.clipboardData)
      if (!file) return
      e.preventDefault()
      void session.attach(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [session])

  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const carried = (e: DragEvent) => !!e.dataTransfer && mightBeAPicture(e.dataTransfer.types)
    // The highlight is held up by `dragover`, which keeps firing on a timer while
    // anything is over the page, and goes when it stops. A cancelled drag is not
    // reliably followed by a `dragleave` (driven through the DevTools protocol, it
    // never was), and a highlight left up says a drop is coming that isn't.
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      clearTimeout(timer)
      setDragging(false)
    }
    // Accepting the drag is what makes the drop fire at all, and it keeps Chrome
    // from doing its own thing with it: opening the file, or the link, in a new tab
    // it switches to. Not over a text box, which accepts drops itself — the drop
    // still fires there, and a link left alone types its address as it always did.
    // Accepted there, a dropped link typed nothing (checked in Chrome).
    const onOver = (e: DragEvent) => {
      if (!carried(e)) return
      if (!intoText(e.target)) e.preventDefault()
      if (!showing(latest.current.inModal)) return
      setDragging(true)
      clearTimeout(timer)
      timer = setTimeout(done, 1000)
    }
    // Only off the page: within it, leaving one element is entering the next.
    const onLeave = (e: DragEvent) => {
      if (carried(e) && !e.relatedTarget) done()
    }
    const onDrop = (e: DragEvent) => {
      if (!carried(e)) return
      done()
      const image = imageFromDrop(e.dataTransfer!)
      if (image || !intoText(e.target)) e.preventDefault()
      if (image && showing(latest.current.inModal)) void session.attach(image)
    }
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [session])

  return {
    photo,
    dragging,
    attach: session.attach,
    retry: session.retry,
    clear: session.clear,
    discard: session.discard,
  }
}

/**
 * The button that opens the file picker. Paste and drop need no control; this is
 * the other way in. `compact` is the labelled one for a modal's field header, where an icon
 * alone beside a label reads as decoration.
 */
export function PhotoPicker({ reader, compact }: { reader: PhotoReader; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const held = reader.photo.status === 'reading' || reader.photo.status === 'read'
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so choosing the same file again — after discarding it — fires
          // another change event.
          e.target.value = ''
          if (file) void reader.attach(file)
        }}
      />
      <Button
        variant={compact ? 'ghost' : 'secondary'}
        size={compact ? 'sm' : 'md'}
        className={compact ? 'h-6 flex-none gap-1 px-2 text-[11px]' : 'w-10 flex-none px-0'}
        onClick={() => input.current?.click()}
        disabled={held}
        title="Add a photo — it is read into a description you can check before it goes in. You can also paste or drop one."
        aria-label="Add a photo"
      >
        <ImagePlus size={compact ? 12 : 15} />
        {compact ? 'Read a photo' : null}
      </Button>
    </>
  )
}

/**
 * The attached picture beside what is happening to it. The thumbnail stays for as
 * long as the description is being checked — it is the thing to check against —
 * and goes with the description when the turn is added or the photo discarded.
 */
export function PhotoStrip({ reader }: { reader: PhotoReader }) {
  const { photo } = reader
  // Mid-drag, where it will land — or, with a picture already held, why it won't.
  if (reader.dragging) {
    const held = photo.status === 'reading' || photo.status === 'read'
    return (
      <div className="mb-2 flex items-center justify-center gap-2 rounded-md border border-dashed border-action-300 bg-action-soft px-3 py-4 text-[12px] text-action-700">
        <ImagePlus size={15} />
        {held
          ? 'One photo at a time — add this one or discard it first.'
          : "Drop it anywhere — it's read into text you can check."}
      </div>
    )
  }
  if (photo.status === 'idle') return null
  const slices = photo.previews?.length ?? 0
  const lead = thumbnailsKind(photo)
  return (
    <div className="mb-2 flex items-start gap-3 rounded-md border border-border bg-surface p-2">
      {lead === 'slices' ? (
        // A long screenshot is several slices side by side, scrolling if there are
        // more than fit — enough to see it was cut and roughly where, not to read.
        <div className="flex max-w-[40%] flex-none gap-1 overflow-x-auto">
          {photo.previews!.map((src, i) => (
            <img
              key={i}
              src={src}
              // Not a picture to drop back in: dragged onto the page, it would be.
              draggable={false}
              alt={
                slices > 1
                  ? `Slice ${i + 1} of ${slices} of the photo being described`
                  : 'The photo being described'
              }
              className="h-20 max-w-32 flex-none rounded border border-border bg-surface-muted object-contain"
            />
          ))}
        </div>
      ) : lead === 'pending' ? (
        <div className="grid h-20 w-20 flex-none place-items-center rounded bg-surface-muted text-fg-3">
          <Spinner />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 py-0.5 text-[12px] leading-relaxed text-fg-2">
        {photo.status === 'reading' ? (
          <p className="flex items-center gap-2">
            <Spinner />
            Reading the photo{slices > 1 ? ` (${slices} slices)` : ''}
            {photo.reader ? ` with ${photo.reader}` : ''}…
          </p>
        ) : null}
        {photo.status === 'read' ? (
          <p>
            Described{photo.reader ? ` by ${photo.reader}` : ''}. Check it against the photo,
            correct anything it got wrong, and check whose it is. One photo at a time, and only
            this text is kept — not the photo.
          </p>
        ) : null}
        {photo.status === 'failed' ? <p className="break-words text-no">{photo.error}</p> : null}
      </div>
      <div className="flex flex-none items-center gap-1">
        {photo.status === 'failed' && slices ? (
          <Button variant="secondary" size="sm" onClick={reader.retry}>
            <RotateCw size={12} /> Retry
          </Button>
        ) : null}
        <button
          onClick={reader.discard}
          title={photo.status === 'reading' ? 'Cancel' : 'Discard the photo'}
          aria-label={photo.status === 'reading' ? 'Cancel' : 'Discard the photo'}
          className="rounded p-1 text-fg-3 transition hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
