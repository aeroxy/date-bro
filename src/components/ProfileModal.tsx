import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

import { Button } from './ui/Button'
import { Field, Input, Textarea } from './ui/Field'
import { Select } from './ui/Select'
import { Modal } from './ui/Modal'
import { STAGES, type DateRecord, type Stage } from '@/types/date'

/**
 * The seed context — everything the user knows going in. The two rebuild
 * engines treat this as a prior and the transcript as the evidence, so it's
 * worth writing honestly rather than aspirationally.
 */
export function ProfileModal({
  open,
  record,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean
  record: DateRecord
  onClose: () => void
  onSave: (patch: Partial<DateRecord>) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(record)
  // Whether the user has touched `researchNotes` this time the modal was open.
  // "What do I say?" writes the same field while the modal can be open, so on
  // save we need to tell "left it alone" from "edited it" — and that has to be
  // tracked as intent, not inferred by comparing against the opening value: a
  // user who edits and then deliberately reverts is *not* untouched, and
  // treating them as such silently drops the revert. See `save`.
  const notesDirty = useRef(false)

  // Seeded on open only. `record` is replaced wholesale whenever a background
  // rebuild lands, and re-seeding on that would wipe whatever the user is
  // part-way through typing.
  useEffect(() => {
    if (open) {
      setDraft(record)
      notesDirty.current = false
    }
  }, [open])

  const set = <K extends keyof DateRecord>(key: K, value: DateRecord[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const setMeta = (key: keyof DateRecord['meta'], value: string) =>
    setDraft((d) => ({ ...d, meta: { ...d.meta, [key]: value } }))
  /** Every path that lets the user change the notes goes through here. */
  const setNotes = (value: string) => {
    notesDirty.current = true
    set('researchNotes', value)
  }

  const save = () => {
    onSave({
      name: draft.name.trim() || 'Untitled',
      stage: draft.stage,
      meta: draft.meta,
      seedThem: draft.seedThem,
      seedMe: draft.seedMe,
      goal: draft.goal,
      // Omitted unless the user actually touched the field, so saving the profile
      // can't roll back notes a run merged in while this was open. Once they have
      // touched it their value wins outright — including a revert to what the
      // field said when the modal opened, which is a real edit, not a no-op.
      ...(notesDirty.current ? { researchNotes: draft.researchNotes ?? '' } : {}),
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      eyebrow="Profile"
      title={draft.name || 'Untitled'}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto text-no hover:bg-no-soft hover:text-no-strong"
            onClick={() => {
              if (confirm(`Delete ${record.name} and the whole conversation? This can't be undone.`)) {
                onDelete()
                onClose()
              }
            }}
          >
            <Trash2 size={14} /> Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Where this is">
            <Select
              value={draft.stage}
              onChange={(stage) => set('stage', stage as Stage)}
              options={STAGES.map((s) => ({ value: s.value, label: s.label }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Field label="Age" hint="optional">
            <Input value={draft.meta.age ?? ''} onChange={(e) => setMeta('age', e.target.value)} />
          </Field>
          <Field label="Pronouns" hint="optional">
            <Input
              value={draft.meta.pronouns ?? ''}
              onChange={(e) => setMeta('pronouns', e.target.value)}
              placeholder="she/her"
            />
          </Field>
          <Field label="How you met" hint="optional">
            <Input
              value={draft.meta.howWeMet ?? ''}
              onChange={(e) => setMeta('howWeMet', e.target.value)}
              placeholder="Hinge"
            />
          </Field>
          <Field label="Talking since" hint="optional">
            <Input
              value={draft.meta.since ?? ''}
              onChange={(e) => setMeta('since', e.target.value)}
              placeholder="early June"
            />
          </Field>
        </div>

        <Field
          label="What you know about them"
          hint="the seed the coach starts from"
        >
          <Textarea
            rows={7}
            value={draft.seedThem}
            onChange={(e) => set('seedThem', e.target.value)}
            placeholder={
              'Their job, where they live, what they were like on the dates you\'ve had, what they talk about, what they seem to care about, anything they\'ve told you about their last relationship, what you noticed in person that never made it into a text.\n\nWrite it the way you\'d tell a friend. Guesses are fine — mark them as guesses.'
            }
          />
        </Field>

        <Field
          label="Research notes"
          hint={
            (draft.researchNotes ?? '').trim() ? (
              <button
                type="button"
                onClick={() => setNotes('')}
                className="font-semibold text-fg-3 hover:text-no"
              >
                Clear
              </button>
            ) : (
              'filled in automatically by "What do I say?"'
            )
          }
        >
          <Textarea
            rows={4}
            value={draft.researchNotes ?? ''}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Facts the coach has looked up and confirmed — venue hours, a checked claim — show up here so it doesn't re-search them. Edit or delete anything freely."
          />
        </Field>

        <Field label="You, in this one" hint="how you show up with this specific person">
          <Textarea
            rows={6}
            value={draft.seedMe}
            onChange={(e) => set('seedMe', e.target.value)}
            placeholder={
              "What you're like around them, what you've told them about yourself, what you're nervous about here, what you've been doing that you're not sure about, how you usually behave when you like someone."
            }
          />
        </Field>

        <Field label="What you want from this" hint="be honest — the coach calibrates to it">
          <Textarea
            rows={3}
            value={draft.goal}
            onChange={(e) => set('goal', e.target.value)}
            placeholder="Something serious. Or: no idea yet, I just like them. Or: a good second date."
          />
        </Field>
      </div>
    </Modal>
  )
}
