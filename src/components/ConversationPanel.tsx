import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, Pencil, Phone, Plus, Sparkles, Trash2, Users } from 'lucide-react'

import { cn } from '@/lib/cn'
import {
  getImportLast,
  importFromSource,
  setImportLast,
  SOURCES,
  type SourceDef,
  type SourceId,
} from '@/lib/import/sources'
import { parsePastedLog, speakerLabel, transcriptStats } from '@/lib/transcript'
import type { Channel, DateRecord, Speaker, Turn } from '@/types/date'
import { Button } from './ui/Button'
import { Chip, Eyebrow } from './ui/Card'
import { Field, Input, Textarea } from './ui/Field'
import { Select } from './ui/Select'
import { Spinner } from './ui/Spinner'
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
  viewingAdvice,
  onOpenAdvice,
}: {
  record: DateRecord
  onChange: (turns: Turn[]) => void
  /** Which coach turn the insight panel is currently showing, if any. */
  viewingAdvice?: string | null
  onOpenAdvice?: (id: string) => void
}) {
  const [speaker, setSpeaker] = useState<Speaker>('them')
  const [text, setText] = useState('')
  const [at, setAt] = useState('')
  const [channel, setChannel] = useState<Channel>('text')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<Turn | null>(null)
  // A note belongs where it happened, not wherever the composer happens to be.
  // The id is minted when the gap is clicked rather than during render, so the
  // modal doesn't remount itself out from under a half-typed note.
  // `before` is the id of the turn the new one goes above, not its index. Every
  // other edit in this file addresses a turn by id; a position captured on click
  // and spent after a modal round trip is the one thing here that couldn't
  // survive the list changing underneath it.
  const [inserting, setInserting] = useState<{ before: string; turn: Turn } | null>(null)
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

  // A note isn't spoken, so the fields that describe *how* something was said
  // don't apply to it — see `Speaker` in types/date.ts.
  const isNote = speaker === 'context'

  const add = () => {
    if (!text.trim()) return
    const turn: Turn = {
      id: crypto.randomUUID(),
      speaker,
      text: text.trim(),
      at: at.trim() || undefined,
      channel: isNote || channel === 'text' ? undefined : channel,
      note: isNote ? undefined : note.trim() || undefined,
    }
    onChange([...record.turns, turn])
    setText('')
    setNote('')
    // `at` too. It describes the message just added, not the next one, and
    // leaving it filled meant the following turn silently inherited a timestamp
    // that was only ever right for the one before it.
    setAt('')
    // The speaker deliberately does *not* flip. It used to, on the theory that
    // conversations alternate — but people send three messages in a row and then
    // read four back, so the flip was wrong about as often as it was right, and
    // a wrong speaker is worse than an unset one: it's silent, and it puts words
    // in the other person's mouth in the one list this app treats as fact.
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
          <Download size={13} /> Import
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
            <p className="mt-3 text-[13.5px] leading-relaxed text-fg-3">
              Anything you know that nobody typed — how you met, what they do, what you're like
              around them — goes in with <span className="font-semibold text-fg-2">NOTE</span>. This
              is the only place the coach reads from, so everything lives here.
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
          {visibleTurns.map((turn) => {
            const mine = turn.speaker === 'me'
            // Neither side said it, so it sits in the middle and doesn't wear a
            // bubble — a note that looked like a message would be read back as
            // one at a glance, which is exactly the confusion it exists to avoid.
            // Advice the coach gave is centred for the same reason.
            const isContext = turn.speaker === 'context'
            const isCoach = turn.speaker === 'coach'
            const centred = isContext || isCoach
            const showing = isCoach && viewingAdvice === turn.id
            return (
              <li
                key={turn.id}
                className={cn(
                  'group relative flex min-w-0 gap-3',
                  centred ? 'flex-row justify-center' : mine ? 'flex-row-reverse' : 'flex-row',
                )}
              >
                {/* Sits in the gap above this line and inserts before it, so
                    every position is reachable — the composer covers the end.
                    All three speakers, not just NOTE: inserting a missed message
                    was already possible via NOTE-then-change-the-who, but that's
                    a modal round trip to correct something the thread could just
                    have asked for. Invisible isn't gone: without
                    pointer-events-none they stay clickable across the full width
                    while reading as absent. */}
                <span className="pointer-events-none absolute -top-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 opacity-0 transition focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                  {(['them', 'me', 'context'] as Speaker[]).map((s) => (
                    <button
                      key={s}
                      onClick={() =>
                        setInserting({
                          before: turn.id,
                          turn: { id: crypto.randomUUID(), speaker: s, text: '' },
                        })
                      }
                      title={`Insert ${s === 'context' ? 'a note' : `a turn from ${speakerLabel(record, s)}`} here`}
                      className="flex items-center gap-0.5 rounded-full border border-dashed border-border bg-surface px-2 py-0.5 text-[10px] text-fg-3 transition hover:border-action hover:text-action"
                    >
                      <Plus size={9} />
                      {speakerLabel(record, s)}
                    </button>
                  ))}
                </span>
                {/* The same number the model cites this turn by — `formatTurn`
                    renders `turn.number` into the prompt, so a `[14]` in a
                    profile is findable here. It was `hiddenCount + i + 1`, which
                    matched only because the prompt was equally positional: both
                    re-aimed together the moment a turn was inserted above. So the
                    column is in allocation order, not transcript order, and has
                    gaps — 60, 62, 61 down the page is correct.

                    No positional fallback, deliberately. Every path into
                    `record.turns` numbers them (`normalize` on read, `update`
                    before it commits to memory), and a guessed number here would
                    sit beside citations the coach wrote and disagree with them.
                    An empty cell is the honest failure. */}
                <span className="tabular mt-2 w-5 flex-none text-right font-mono text-[10px] text-neutral-300">
                  {turn.number}
                </span>
                <div
                  className={cn(
                    'min-w-0',
                    centred ? 'max-w-[min(560px,86%)] text-center' : 'max-w-[min(560px,78%)]',
                    mine && !centred && 'text-right',
                  )}
                >
                  {/* The question the answer belongs to. It already rides into
                      the prompt inside the line's label; without it here the
                      reader gets a three-word fragment with no subject. */}
                  {turn.asked ? (
                    <p className="mb-1 text-[11px] italic leading-snug text-fg-3">{turn.asked}</p>
                  ) : null}
                  {/* The bubble is the summary; the panel holds the drafts, the
                      reasoning and what to watch for. Clicking opens it there
                      rather than expanding inline — the advice was written to be
                      read next to the profile it came from, and a conversation
                      that unfolds into four hundred words stops being one. */}
                  {isCoach ? (
                    <button
                      onClick={() => onOpenAdvice?.(turn.id)}
                      className={cn(
                        'block w-full whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-left text-[12.5px] leading-relaxed transition',
                        showing
                          ? 'border-action-300 bg-action-soft text-fg'
                          : 'border-dashed border-border bg-surface-sunken text-fg-2 hover:border-action-300 hover:bg-action-soft hover:text-fg',
                      )}
                    >
                      {turn.text}
                      <span className="mt-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-action-700">
                        <Sparkles size={9} />
                        {showing ? 'shown in the panel' : 'see the drafts'}
                      </span>
                    </button>
                  ) : (
                    <div
                      className={cn(
                        'inline-block whitespace-pre-wrap break-words text-left text-[13.5px] leading-relaxed',
                        isContext
                          ? 'rounded-md border border-dashed border-border bg-surface-sunken px-3 py-1.5 text-[12.5px] text-fg-2'
                          : 'rounded-lg px-3.5 py-2',
                        !isContext &&
                          (mine
                            ? 'bg-ink text-white'
                            : 'border border-border bg-surface text-fg shadow-xs'),
                      )}
                    >
                      {turn.text}
                    </div>
                  )}
                  <div
                    className={cn(
                      'mt-1 flex items-center gap-2 text-[10.5px] text-fg-3',
                      centred ? 'justify-center' : mine && 'justify-end',
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
                        focus.
                        Invisible isn't gone: without pointer-events-none, delete
                        stays clickable under the cursor while it reads as absent. */}
                    <span className="pointer-events-none flex items-center gap-1 opacity-0 transition focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                      {/* No edit on advice. It's a record of what was said to
                          the user, not something they wrote — rewriting it
                          would leave the panel showing drafts the summary above
                          no longer describes. Delete still works. */}
                      {isCoach ? null : (
                        <button
                          onClick={() => setEditing(turn)}
                          className="rounded p-0.5 hover:text-fg"
                          title="Edit"
                        >
                          <Pencil size={11} />
                        </button>
                      )}
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
            {(['them', 'me', 'context'] as Speaker[]).map((s) => (
              <button
                key={s}
                onClick={() => setSpeaker(s)}
                title={s === 'context' ? "Something you know that nobody typed" : undefined}
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
            placeholder={isNote ? "when you found out — optional" : "when — 'Tue 9pm', 'next morning'"}
            className="h-8 max-w-[220px] text-[12.5px]"
          />
          {isNote ? null : (
            <>
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
            </>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add()
            }}
            placeholder={
              isNote
                ? `Something you know that isn't in the messages — ${record.name} said it on a call, a friend mentioned it, you remembered it.   (⌘↵ to add)`
                : `What ${speaker === 'me' ? 'you' : record.name} said…   (⌘↵ to add)`
            }
            className="flex-1"
          />
          <Button onClick={add} disabled={!text.trim()}>
            {isNote ? 'Add note' : 'Add turn'}
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

      {inserting ? (
        <EditTurnModal
          key={inserting.turn.id}
          turn={inserting.turn}
          record={record}
          isNew
          onClose={() => setInserting(null)}
          onSave={(created) => {
            if (created.text.trim()) {
              const next = [...record.turns]
              // Resolved now, not when the pill was clicked. An anchor that has
              // since been deleted leaves nothing to sit above, so the entry
              // appends rather than landing somewhere arbitrary.
              const at = next.findIndex((t) => t.id === inserting.before)
              next.splice(at < 0 ? next.length : at, 0, created)
              onChange(next)
            }
            setInserting(null)
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
  isNew,
  onClose,
  onSave,
}: {
  turn: Turn
  record: DateRecord
  isNew?: boolean
  onClose: () => void
  onSave: (turn: Turn) => void
}) {
  const [draft, setDraft] = useState<Turn>(turn)
  const isNote = draft.speaker === 'context'
  const noun = isNote ? 'note' : 'turn'

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={speakerLabel(record, draft.speaker)}
      title={`${isNew ? 'Add' : 'Edit'} ${noun}`}
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
        <Field label={isNote ? 'What you know' : 'Said'}>
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
              // Switching an entry to a note drops the fields that only describe
              // speech, so saving can't leave a note carrying a channel — and
              // switching away drops `asked`, which is a note's alone. Left on,
              // it renders "asked: …" against a line she actually said.
              onChange={(next) =>
                setDraft(
                  next === 'context'
                    ? { ...draft, speaker: next, channel: undefined, note: undefined }
                    : { ...draft, speaker: next as Speaker, asked: undefined },
                )
              }
              options={[
                { value: 'them', label: speakerLabel(record, 'them') },
                { value: 'me', label: speakerLabel(record, 'me') },
                { value: 'context', label: speakerLabel(record, 'context') },
              ]}
            />
          </Field>
          <Field label={isNote ? 'When you found out' : 'When'}>
            <Input
              value={draft.at ?? ''}
              onChange={(e) => setDraft({ ...draft, at: e.target.value })}
            />
          </Field>
        </div>
        {isNote ? null : (
          <Field label="Your note" hint="tone, body language, what didn't make it into text">
            <Input
              value={draft.note ?? ''}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </Field>
        )}
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
  const [source, setSource] = useState<SourceId | null>(null)
  // Blank means the whole history: the expensive answer is the honest default,
  // since a number picked for you silently drops the messages above it.
  const [last, setLast] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  // A fetch outlives this component unless something stops it: the modal is
  // mounted only while open, so unmounting is every way out of it at once —
  // Cancel, the X, Escape, Append, Replace.
  const running = useRef<AbortController | null>(null)
  useEffect(() => () => running.current?.abort(), [])
  // Which fetch the UI is currently showing. Aborting only stops the *work*,
  // and only between passes — the pass already in flight still runs to its end
  // and still calls back — so every write below is gated on this instead of on
  // the abort having landed.
  const generation = useRef(0)
  // Memoised: this runs on every keystroke, and a pasted thread can be long.
  const parsed = useMemo(
    () => (raw.trim() ? parsePastedLog(raw, record.name) : []),
    [raw, record.name],
  )

  const active = SOURCES.find((s) => s.id === source)

  // The remembered count lands a tick after mount, so it must not overwrite a
  // number the user has already started typing.
  const typedLast = useRef(false)
  useEffect(() => {
    void getImportLast().then((v) => {
      if (v && !typedLast.current) setLast(v)
    })
  }, [])

  // Switching tabs drops whatever the last fetch said: an error or a "142
  // messages" line describes a source you are no longer looking at. It also
  // ends that fetch rather than leaving it to finish into a source nobody is
  // looking at, and takes the spinner with it — nothing is running any more.
  function selectSource(id: SourceId | null) {
    generation.current++
    running.current?.abort()
    setFetching(false)
    setSource(id)
    setError(null)
    setStatus(null)
  }

  async function fetchFrom(def: SourceDef) {
    setFetching(true)
    setError(null)
    setStatus('Looking for the tab…')
    const controller = new AbortController()
    running.current = controller
    const mine = ++generation.current
    const current = () => generation.current === mine
    try {
      // Blank, 0, or anything unreadable means the whole history — the expensive
      // answer, so it has to be asked for rather than fallen into.
      const n = Math.max(0, Math.floor(Number(last.trim())) || 0)
      const result = await importFromSource(
        def,
        n,
        (found) => {
          if (current()) setStatus(`${found} messages so far…`)
        },
        controller.signal,
      )
      if (!current()) return
      // Stored on the way out, so what comes back next time is a count that
      // actually ran — not one from an attempt that died on "no tab open".
      void setImportLast(n ? String(n) : '')
      setRaw(result.text)
      setStatus(
        [
          `${result.count} messages`,
          result.peer ? `from ${result.peer}` : null,
          result.note,
        ]
          .filter(Boolean)
          .join(' · '),
      )
    } catch (e) {
      // Cancelling is something the user did, not something that went wrong.
      if ((e as Error).name === 'AbortError' || !current()) return
      setError((e as Error).message)
      setStatus(null)
    } finally {
      if (current()) setFetching(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      eyebrow="Import"
      title="Import a conversation"
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
      {/* Everything on this row holds its width except the hint, which reflows.
          The row is one source wider than it used to be and the modal is only as
          wide as the window allows, so something has to give — left to itself
          flexbox squeezed the tab strip and clipped a label to one letter.
          The height is held at two lines of that reflowed hint whether or not a
          source is picked, so choosing one doesn't nudge the whole modal down. */}
      <div className="mb-3 flex min-h-10 items-center gap-2">
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
          <button
            onClick={() => selectSource(null)}
            className={cn(
              'px-3 py-1 text-[12px] font-semibold whitespace-nowrap transition',
              source === null ? 'bg-ink text-white' : 'bg-surface text-fg-3 hover:text-fg',
            )}
          >
            Paste
          </button>
          {SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => selectSource(s.id)}
              className={cn(
                'border-l border-border px-3 py-1 text-[12px] font-semibold whitespace-nowrap transition',
                source === s.id ? 'bg-ink text-white' : 'bg-surface text-fg-3 hover:text-fg',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {active ? (
          <>
            <Input
              value={last}
              onChange={(e) => {
                typedLast.current = true
                setLast(e.target.value)
              }}
              placeholder="all"
              className="h-8 w-[92px] shrink-0 text-[12.5px]"
              aria-label="How many recent messages"
            />
            <span className="min-w-0 text-[11.5px] text-fg-3">most recent · blank for all</span>
            <Button
              variant="accent"
              size="sm"
              className="ml-auto shrink-0"
              disabled={fetching}
              onClick={() => fetchFrom(active)}
            >
              {fetching ? <Spinner /> : <Download size={13} />} Fetch
            </Button>
          </>
        ) : null}
      </div>

      {active ? (
        <p className="mb-3 text-[12.5px] leading-relaxed text-fg-3">
          Reads the conversation you have open in your {active.label} tab, straight from the page —
          nothing is uploaded anywhere. Open {active.where}, click into the chat, then Fetch. The log
          lands below for you to check before it goes in.
          {active.id === 'telegram' ? (
            <>
              {' '}
              Telegram only loads history cleanly in one direction, so a capped fetch climbs backwards
              and can skip on a long haul — leave the count blank for the slower, complete read.
            </>
          ) : null}
        </p>
      ) : (
        <p className="mb-3 text-[12.5px] leading-relaxed text-fg-3">
          One message per line, labelled. <code className="font-mono text-fg-2">Me:</code> for you;{' '}
          <code className="font-mono text-fg-2">{record.name}:</code>,{' '}
          <code className="font-mono text-fg-2">Them:</code>, or{' '}
          <code className="font-mono text-fg-2">Her:</code>/
          <code className="font-mono text-fg-2">Him:</code> for them. Unlabelled lines join the
          message above, so multi-line texts survive. Add a timestamp in brackets right after the
          label if you have one — <code className="font-mono text-fg-2">Me [Tue 9pm]:</code> —
          free-form, same as the "when" field below; it's optional and safe to leave off.
        </p>
      )}

      {error ? (
        <p className="mb-3 rounded-md border border-no-strong/30 bg-no-soft px-3 py-2 text-[12.5px] leading-relaxed text-no-strong">
          {error}
        </p>
      ) : status ? (
        <p className="mb-3 text-[12px] text-fg-3">{status}</p>
      ) : null}

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
