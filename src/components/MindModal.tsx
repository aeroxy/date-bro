import { useEffect, useState } from 'react'
import { Brain, RotateCcw } from 'lucide-react'

import {
  MIND_PARTS,
  missingHeadings,
  mindText,
  resetBeliefs,
  seedSection,
  writeMindSection,
} from '@/coach/mind'
import { key, parseSections, profileWords } from '@/coach/profile'
import { ago } from '@/lib/ago'
import { getMind, saveMind } from '@/lib/storage'
import { cn } from '@/lib/cn'
import { Button } from './ui/Button'
import { Eyebrow } from './ui/Card'
import { Textarea } from './ui/Field'
import { Modal } from './ui/Modal'
import { Spinner } from './ui/Spinner'

/**
 * The coach, editable.
 *
 * One section at a time rather than one enormous textarea: the whole document is
 * ~5k tokens, and a box that long is a box nobody scrolls to the bottom of. The
 * list on the left is also the only honest picture of what a given engine
 * actually receives — each row says which calls its section is sent to.
 *
 * Raw markdown, with no rendered-view-then-edit toggle. This is the one document
 * in the app the user is meant to argue with, and a click between someone and
 * deleting a line that is wrong about them is a click too many.
 *
 * Loaded on open rather than held in App state, because a next-move run rewrites
 * it underneath the UI.
 */
export function MindModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [loaded, setLoaded] = useState('')
  const [updatedAt, setUpdatedAt] = useState(0)
  const [active, setActive] = useState(MIND_PARTS[0]!.heading)
  const [error, setError] = useState<string | null>(null)
  // Bumped whenever the whole document is replaced under the user — a load, a
  // reset, a revert. The box is uncontrolled (see the textarea), so remounting
  // it is what re-seeds it with text it didn't type.
  const [revision, setRevision] = useState(0)
  const replace = (markdown: string) => {
    setDraft(markdown)
    setRevision((n) => n + 1)
  }

  useEffect(() => {
    if (!open) return
    let live = true
    setDraft(null)
    setError(null)
    getMind()
      .then((m) => {
        if (!live) return
        // `mindText` resolves the seed when nothing is stored, so an untouched
        // installation opens on the shipped coach rather than on a blank page.
        const text = mindText(m)
        replace(text)
        // What "unsaved" is measured against on the way out.
        setLoaded(text)
        setUpdatedAt(m.updatedAt)
      })
      .catch((e: unknown) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [open])

  const sections = draft === null ? [] : parseSections(draft)
  // The same `key` every other reader of this document uses. Trimming and
  // lowercasing on its own is weaker: it keeps punctuation, so a section the
  // coach retyped with a typographic apostrophe still matched for
  // `missingHeadings` and `writeMindSection` and missed here — the row read
  // "deleted" and the box came up empty over text that was sitting right there.
  const body = sections.find((s) => key(s.heading) === key(active))
  const missing = draft === null ? [] : missingHeadings(draft)
  const shipped = seedSection(active)
  // The heading isn't in the box — it's the section's address, shown in the list
  // on the left, and an editable copy of it here would let a typo silently
  // detach a section from the engine that reads it.
  const current = body?.body ?? ''
  const edited = shipped !== null && current.trim() !== shipped

  const writeSection = (text: string) => {
    if (draft === null) return
    setDraft(writeMindSection(draft, active, text))
  }

  // Everything here is held in memory until Save, and this is the one document
  // in the app the user writes by hand rather than generates — so closing it is
  // the one place their own words can go.
  const close = () => {
    if (draft !== null && draft !== loaded && !confirm('Discard your changes to the coach?')) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      eyebrow="The coach"
      title="Who it is, and everything it believes"
      footer={
        <>
          <span className="mr-auto text-[12px] text-fg-3">
            {updatedAt ? `Edited ${ago(updatedAt)}` : 'Unchanged from what shipped'}
            {draft ? ` · ${profileWords(draft)} words` : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-fg-3"
            onClick={() => {
              if (
                !confirm(
                  'Reset everything the coach believes to what shipped?\n\nYour edits to those sections, and its own, are discarded. What it has learned about you is kept, and so is any section you added yourself.',
                )
              )
                return
              // Not `SEED_MIND` flat — see `resetBeliefs` for what survives and
              // why. Both kinds it keeps have no shipped version to be restored
              // to, so resetting them would be deletion wearing a restore's
              // label.
              replace(resetBeliefs(draft ?? ''))
            }}
          >
            Reset beliefs
          </Button>
          <Button variant="secondary" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={draft === null}
            onClick={() => {
              if (draft === null) return
              // `loaded` is the document as it stood when this modal opened, so
              // a run that amended a section while it was open keeps its
              // amendment instead of being overwritten by this draft.
              saveMind(draft, loaded)
                .then(onClose)
                .catch((e: unknown) => setError((e as Error).message))
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {error ? (
        <p className="mb-3 rounded-md border border-no/40 bg-no-soft px-3 py-2 text-[12px] text-no-strong">
          {error}
        </p>
      ) : null}

      <p className="mb-3 text-[12.5px] leading-relaxed text-fg-3">
        This <em>is</em> the coach — its voice, everything it believes about reading people and
        about what to do next, and whatever it has worked out since. Each call is sent the
        sections it needs, listed on the left, so edit one and the advice changes. The coach
        amends it too, after a next move, when something it tried actually landed or didn't.
      </p>

      {draft === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="flex gap-4">
          <nav className="w-[190px] flex-none space-y-0.5">
            {MIND_PARTS.map((part) => {
              const gone = missing.includes(part.heading)
              return (
                <button
                  key={part.heading}
                  onClick={() => setActive(part.heading)}
                  className={cn(
                    'block w-full rounded-md px-2.5 py-1.5 text-left text-[12px] leading-snug transition',
                    part.heading === active
                      ? 'bg-surface-muted font-semibold text-fg'
                      : 'text-fg-3 hover:bg-surface-muted/60 hover:text-fg-2',
                  )}
                >
                  {part.heading}
                  <span className="mt-0.5 block text-[10.5px] font-normal text-fg-3">
                    {gone ? 'deleted' : part.blurb}
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <Eyebrow>{body ? active : `${active} — deleted`}</Eyebrow>
              <span className="flex-1" />
              {edited ? (
                <button
                  onClick={() => shipped !== null && replace(writeMindSection(draft, active, shipped))}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-3 transition hover:bg-surface-muted hover:text-fg"
                >
                  <RotateCcw size={10} /> Revert to shipped
                </button>
              ) : null}
            </div>
            {/* Uncontrolled, keyed on what it's showing. Controlled, every
                keystroke round-tripped through the document and came back
                parsed — which trims — so a trailing newline was deleted as
                fast as it was typed and pressing Enter at the end of a section
                did nothing at all. The key remounts it when the section changes
                or the document is replaced; between those, the box keeps
                exactly what was typed and `draft` follows it. */}
            <Textarea
              key={`${active}:${revision}`}
              rows={20}
              defaultValue={current}
              onChange={(e) => writeSection(e.target.value)}
              className="font-mono text-[12px] leading-relaxed"
              placeholder={'Deleted. The calls that used this section now run without it — type here to bring it back, or revert to shipped.'}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Header button. Beside Settings — it's the app's coach, not one person's. */
export function MindButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md p-2 text-fg-3 transition hover:bg-surface-muted hover:text-fg"
      title="The coach — who it is and what it believes"
    >
      <Brain size={15} />
    </button>
  )
}
