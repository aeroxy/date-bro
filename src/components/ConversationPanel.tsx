import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Pencil, Phone, Trash2, Users } from 'lucide-react'

import { cn } from '@/lib/cn'
import { parsePastedLog, speakerLabel, transcriptStats } from '@/lib/transcript'
import type { Channel, DateRecord, Speaker, Turn } from '@/types/date'
import { Button } from './ui/Button'
import { Chip, Eyebrow } from './ui/Card'
import { Field, Input, Textarea } from './ui/Field'
import { Select } from './ui/Select'
import { Modal } from './ui/Modal'

const CHANNEL_ICON = {
  text: null,
  call: <Phone size={11} />,
  irl: <Users size={11} />,
} satisfies Record<Channel, React.ReactNode>

// How many turns to render at once. Older turns render in on scroll-up
// rather than all at mount, so long imported transcripts stay smooth.
const PAGE_SIZE = 40

export function ConversationPanel({
  record,
  onChange,
}: {
  record: DateRecord
  onChange: (turns: Turn[]) => void
}) {
  const [speaker, setSpeaker] = useState<Speaker>('them')
  const [text, setText] = useState('')
  const [at, setAt] = useState('')
  const [channel, setChannel] = useState<Channel>('text')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<Turn | null>(null)
  const [importing, setImporting] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const prevTurnCount = useRef(0)
  const prevScrollHeight = useRef(0)

  const visibleTurns = record.turns.slice(-visibleCount)
  const hiddenCount = record.turns.length - visibleTurns.length

  // Scroll to the bottom on mount, and whenever a turn is appended (add or
  // import) — but not when older turns page in at the top, or a turn is
  // edited/deleted in place.
  useLayoutEffect(() => {
    const grew = record.turns.length > prevTurnCount.current
    prevTurnCount.current = record.turns.length
    const el = scrollRef.current
    if (el && grew) el.scrollTop = el.scrollHeight
  }, [record.turns.length])

  // Loading older turns shifts everything down; hold the viewport steady by
  // restoring the distance from the bottom instead of jumping to the top.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && prevScrollHeight.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeight.current
      prevScrollHeight.current = 0
    }
  }, [visibleCount])

  useEffect(() => {
    const sentinel = loadMoreRef.current
    const el = scrollRef.current
    if (!sentinel || !el || hiddenCount === 0) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        prevScrollHeight.current = el.scrollHeight
        setVisibleCount((c) => c + PAGE_SIZE)
      },
      { root: el },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hiddenCount])

  const stats = transcriptStats(record)

  const add = () => {
    if (!text.trim()) return
    const turn: Turn = {
      id: crypto.randomUUID(),
      speaker,
      text: text.trim(),
      at: at.trim() || undefined,
      channel: channel === 'text' ? undefined : channel,
      note: note.trim() || undefined,
    }
    onChange([...record.turns, turn])
    setText('')
    setNote('')
    // Alternating is the common case — flip the speaker so the next turn is
    // one keystroke closer.
    setSpeaker(speaker === 'them' ? 'me' : 'them')
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-2.5">
        <Eyebrow>Conversation</Eyebrow>
        <span className="h-px flex-1 bg-border" />
        {stats.total > 0 ? (
          <span className="tabular text-[11px] text-fg-3">
            {stats.themTurns}/{stats.myTurns} turns · {stats.themWords}/{stats.myWords} words ·{' '}
            {stats.themQuestions}/{stats.myQuestions} asked
          </span>
        ) : null}
        {record.turns.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-fg-3 hover:bg-no-soft hover:text-no-strong"
            onClick={() => {
              if (confirm(`Clear all ${record.turns.length} turns? This can't be undone.`)) {
                onChange([])
              }
            }}
          >
            <Trash2 size={13} /> Clear
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setImporting(true)}>
          <ClipboardPaste size={13} /> Paste a log
        </Button>
      </div>

      <div ref={scrollRef} className="scroll-slim flex-1 overflow-y-auto px-5 py-4">
        {record.turns.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <p className="text-[13.5px] leading-relaxed text-fg-3">
              Nothing recorded yet. Add turns one at a time below, or paste a whole thread — every
              line starting <code className="font-mono text-[12px] text-fg-2">Me:</code> or{' '}
              <code className="font-mono text-[12px] text-fg-2">{record.name}:</code> becomes a turn.
            </p>
          </div>
        ) : null}

        {hiddenCount > 0 ? (
          <div ref={loadMoreRef} className="mb-3 text-center">
            <button
              onClick={() => {
                const el = scrollRef.current
                if (el) prevScrollHeight.current = el.scrollHeight
                setVisibleCount((c) => c + PAGE_SIZE)
              }}
              className="rounded-md px-3 py-1 text-[11.5px] font-medium text-fg-3 hover:bg-surface-muted hover:text-fg"
            >
              Load {Math.min(hiddenCount, PAGE_SIZE)} earlier turns ({hiddenCount} hidden)
            </button>
          </div>
        ) : null}

        <ol className="space-y-2.5">
          {visibleTurns.map((turn, i) => {
            const mine = turn.speaker === 'me'
            return (
              <li
                key={turn.id}
                className={cn('group flex min-w-0 gap-3', mine ? 'flex-row-reverse' : 'flex-row')}
              >
                <span className="tabular mt-2 w-5 flex-none text-right font-mono text-[10px] text-neutral-300">
                  {hiddenCount + i + 1}
                </span>
                <div className={cn('min-w-0 max-w-[min(560px,78%)]', mine && 'text-right')}>
                  <div
                    className={cn(
                      'inline-block whitespace-pre-wrap break-words rounded-lg px-3.5 py-2 text-left text-[13.5px] leading-relaxed',
                      mine
                        ? 'bg-ink text-white'
                        : 'border border-border bg-surface text-fg shadow-xs',
                    )}
                  >
                    {turn.text}
                  </div>
                  <div
                    className={cn(
                      'mt-1 flex items-center gap-2 text-[10.5px] text-fg-3',
                      mine && 'justify-end',
                    )}
                  >
                    <span className="font-mono uppercase tracking-[0.1em]">
                      {speakerLabel(record, turn.speaker)}
                    </span>
                    {turn.at ? <span>{turn.at}</span> : null}
                    {turn.channel && turn.channel !== 'text' ? (
                      <span className="inline-flex items-center gap-1">
                        {CHANNEL_ICON[turn.channel]}
                        {turn.channel === 'irl' ? 'in person' : 'call'}
                      </span>
                    ) : null}
                    {/* Hidden until hover, so it also has to appear on keyboard
                        focus — same rule as FeedbackThread's drop button.
                        Invisible isn't gone: without pointer-events-none, delete
                        stays clickable under the cursor while it reads as absent. */}
                    <span className="pointer-events-none flex items-center gap-1 opacity-0 transition focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                      <button
                        onClick={() => setEditing(turn)}
                        className="rounded p-0.5 hover:text-fg"
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => onChange(record.turns.filter((t) => t.id !== turn.id))}
                        className="rounded p-0.5 hover:text-no"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </div>
                  {turn.note ? (
                    <p
                      className={cn(
                        'mt-1 break-words text-[11.5px] italic leading-snug text-fg-3',
                        mine && 'text-right',
                      )}
                    >
                      {turn.note}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="border-t border-border bg-surface-sunken px-5 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(['them', 'me'] as Speaker[]).map((s) => (
              <button
                key={s}
                onClick={() => setSpeaker(s)}
                className={cn(
                  'px-3 py-1 text-[12px] font-semibold transition',
                  speaker === s ? 'bg-ink text-white' : 'bg-surface text-fg-3 hover:text-fg',
                )}
              >
                {speakerLabel(record, s)}
              </button>
            ))}
          </div>
          <Input
            value={at}
            onChange={(e) => setAt(e.target.value)}
            placeholder="when — 'Tue 9pm', 'next morning'"
            className="h-8 max-w-[220px] text-[12.5px]"
          />
          <Select
            value={channel}
            onChange={(c) => setChannel(c as Channel)}
            className="h-8 w-[130px] text-[12.5px]"
            options={[
              { value: 'text', label: 'Text' },
              { value: 'call', label: 'Call' },
              { value: 'irl', label: 'In person' },
            ]}
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="your note — tone, what you left out"
            className="h-8 flex-1 text-[12.5px]"
          />
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add()
            }}
            placeholder={`What ${speaker === 'me' ? 'you' : record.name} said…   (⌘↵ to add)`}
            className="flex-1"
          />
          <Button onClick={add} disabled={!text.trim()}>
            Add turn
          </Button>
        </div>
      </div>

      {/* Keyed by turn, so reopening one you cancelled starts from the saved text. */}
      {editing ? (
        <EditTurnModal
          key={editing.id}
          turn={editing}
          record={record}
          onClose={() => setEditing(null)}
          onSave={(updated) => {
            onChange(record.turns.map((t) => (t.id === updated.id ? updated : t)))
            setEditing(null)
          }}
        />
      ) : null}

      {/* Mounted only while open, so each open starts with an empty box. */}
      {importing ? (
        <ImportModal
          record={record}
          onClose={() => setImporting(false)}
          onImport={(turns, mode) => {
            onChange(mode === 'replace' ? turns : [...record.turns, ...turns])
            setImporting(false)
          }}
        />
      ) : null}
    </section>
  )
}

function EditTurnModal({
  turn,
  record,
  onClose,
  onSave,
}: {
  turn: Turn
  record: DateRecord
  onClose: () => void
  onSave: (turn: Turn) => void
}) {
  const [draft, setDraft] = useState<Turn>(turn)

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={speakerLabel(record, draft.speaker)}
      title="Edit turn"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" onClick={() => onSave(draft)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Said">
          <Textarea
            rows={5}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Who">
            <Select
              value={draft.speaker}
              onChange={(speaker) => setDraft({ ...draft, speaker: speaker as Speaker })}
              options={[
                { value: 'them', label: speakerLabel(record, 'them') },
                { value: 'me', label: speakerLabel(record, 'me') },
              ]}
            />
          </Field>
          <Field label="When">
            <Input
              value={draft.at ?? ''}
              onChange={(e) => setDraft({ ...draft, at: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Your note" hint="tone, body language, what didn't make it into text">
          <Input
            value={draft.note ?? ''}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  )
}

function ImportModal({
  record,
  onClose,
  onImport,
}: {
  record: DateRecord
  onClose: () => void
  onImport: (turns: Turn[], mode: 'append' | 'replace') => void
}) {
  const [raw, setRaw] = useState('')
  // Memoised: this runs on every keystroke, and a pasted thread can be long.
  const parsed = useMemo(
    () => (raw.trim() ? parsePastedLog(raw, record.name) : []),
    [raw, record.name],
  )

  return (
    <Modal
      open
      onClose={onClose}
      wide
      eyebrow="Import"
      title="Paste a conversation"
      footer={
        <>
          <span className="mr-auto text-[12px] text-fg-3">
            {parsed.length ? `${parsed.length} turns found` : 'Nothing recognised yet'}
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!parsed.length}
            onClick={() => {
              // Same guard as Clear, for the same reason: this discards the
              // recorded conversation and nothing gets it back.
              if (
                !record.turns.length ||
                confirm(
                  `Replace all ${record.turns.length} recorded turns with these ${parsed.length}? This can't be undone.`,
                )
              ) {
                onImport(parsed, 'replace')
              }
            }}
          >
            Replace all
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={!parsed.length}
            onClick={() => onImport(parsed, 'append')}
          >
            Append
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] leading-relaxed text-fg-3">
        One message per line, labelled. <code className="font-mono text-fg-2">Me:</code> for you;{' '}
        <code className="font-mono text-fg-2">{record.name}:</code>,{' '}
        <code className="font-mono text-fg-2">Them:</code>, or{' '}
        <code className="font-mono text-fg-2">Her:</code>/<code className="font-mono text-fg-2">Him:</code>{' '}
        for them. Unlabelled lines join the message above, so multi-line texts survive. Add a
        timestamp in brackets right after the label if you have one —{' '}
        <code className="font-mono text-fg-2">Me [Tue 9pm]:</code> — free-form, same as the "when"
        field below; it's optional and safe to leave off.
      </p>
      <Textarea
        rows={14}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        className="font-mono text-[12.5px]"
        placeholder={`Me [Sat 11pm]: hey — how was the thing on Saturday?\n${record.name} [Sun 9am]: honestly a disaster, my sister showed up late and then\nmade it everyone's problem\nMe: oh no. the classic`}
      />
      {parsed.length ? (
        <div className="mt-3 space-y-1.5">
          <Eyebrow>Preview</Eyebrow>
          {parsed.slice(0, 6).map((t) => (
            <div key={t.id} className="flex gap-2 text-[12.5px]">
              <Chip tone={t.speaker === 'me' ? 'action' : 'live'}>
                {speakerLabel(record, t.speaker)}
              </Chip>
              {t.at ? <span className="flex-none text-[11px] text-fg-3">{t.at}</span> : null}
              <span className="line-clamp-1 text-fg-2">{t.text}</span>
            </div>
          ))}
          {parsed.length > 6 ? (
            <p className="text-[11.5px] text-fg-3">+{parsed.length - 6} more</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
