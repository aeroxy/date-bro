import { useDeferredValue, useMemo, useState } from 'react'
import { Plus, Heart, Search, X } from 'lucide-react'

import { ago } from '@/lib/ago'
import { cn } from '@/lib/cn'
import { searchDates, type Marked, type SearchHit } from '@/lib/search'
import { Button } from './ui/Button'
import { Input } from './ui/Field'
import { Eyebrow } from './ui/Card'
import { Spinner } from './ui/Spinner'
import type { PhotoState } from '@/lib/photo-attachment'
import { STAGES, type DateRecord } from '@/types/date'

const stageLabel = (record: DateRecord) =>
  STAGES.find((s) => s.value === record.stage)?.label ?? record.stage

/** A name or a line with the search match picked out. */
function Mark({ parts }: { parts: Marked }) {
  return (
    <>
      {parts.before}
      <mark className="rounded-[2px] bg-action/20 text-inherit">{parts.match}</mark>
      {parts.after}
    </>
  )
}

export function DateRail({
  dates,
  activeId,
  onSelect,
  onCreate,
  createError,
  running,
  photos,
}: {
  dates: DateRecord[]
  activeId: string | null
  /** `turn` when a search result is opened at a line of the conversation. */
  onSelect: (id: string, turn?: string) => void
  onCreate: (name: string) => void
  /** Only ever set on a first-ever create, when there's no panel to show it on. */
  createError?: string | null
  /**
   * Who has a run in flight. Runs are per-person and don't lock anyone else, so
   * a rebuild you started and switched away from has nothing else on screen
   * saying it exists — this row is the only place it shows, and the way back to
   * the panel that can stop it.
   */
  running?: Set<string>
  /**
   * Who has a photo being read, or read and waiting to be checked. The same case as
   * `running`, one level down: the read belongs to the person and carries on when
   * you switch away, so without this a photo you started and left has nothing on
   * screen saying it is still going, or that it finished.
   */
  photos?: ReadonlyMap<string, PhotoState['status']>
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  // Matching reads every turn of everyone, so it trails the keystrokes rather
  // than holding them up.
  const settled = useDeferredValue(query)
  const hits = useMemo(() => (settled.trim() ? searchDates(dates, settled) : null), [dates, settled])
  const rows: SearchHit[] = hits ?? dates.map((record) => ({ record }))

  const submit = () => {
    if (!name.trim()) return
    onCreate(name.trim())
    setName('')
    setAdding(false)
    // Someone just added matches nothing yet, and a filter that hides them the
    // moment they exist reads as the add having failed.
    setQuery('')
  }

  return (
    <aside className="flex h-full w-[248px] flex-none flex-col border-r border-border bg-surface-sunken">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <Eyebrow className="flex-1">People · {String(dates.length).padStart(2, '0')}</Eyebrow>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-md p-1 text-fg-3 transition hover:bg-surface-muted hover:text-action"
          title="Add someone"
        >
          <Plus size={15} />
        </button>
      </div>

      {adding ? (
        <div className="flex gap-1.5 px-3 pb-3">
          <Input
            autoFocus
            value={name}
            placeholder="Their name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setAdding(false)
            }}
            className="h-8 text-[13px]"
          />
          <Button size="sm" variant="accent" onClick={submit}>
            Add
          </Button>
        </div>
      ) : null}

      {createError ? (
        <p className="px-3 pb-3 text-[11.5px] leading-snug text-no">
          Couldn't add them: {createError}
        </p>
      ) : null}

      {dates.length > 0 ? (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
            />
            <Input
              value={query}
              placeholder="Search names and messages"
              aria-label="Search names and conversations"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              className="h-8 pl-8 pr-7 text-[12.5px]"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-fg-3 transition hover:text-fg"
                title="Clear search"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="scroll-slim flex-1 overflow-y-auto px-2 pb-4">
        {dates.length === 0 ? (
          <p className="px-2 py-6 text-[12.5px] leading-relaxed text-fg-3">
            No one here yet. Add the person you're seeing, write down what you know about them, and
            paste in your conversation.
          </p>
        ) : null}

        {hits?.length === 0 ? (
          <p className="px-2 py-6 text-[12.5px] leading-relaxed text-fg-3">
            No name or conversation has “{settled.trim()}” in it.
          </p>
        ) : null}

        {rows.map(({ record: d, name: inName, turn }) => {
          const active = d.id === activeId
          const busy = running?.has(d.id) ?? false
          const photo = photos?.get(d.id)
          // A run outranks a photo in the row's one line, and each is the only thing it says.
          const summary = busy
            ? 'thinking…'
            : photo === 'reading'
              ? 'reading a photo…'
              : photo === 'read'
                ? 'photo ready to check'
                : photo === 'failed'
                  ? "couldn't read a photo"
                  : `${stageLabel(d)} · ${d.turns.length} turns · ${ago(d.updatedAt)}`
          return (
            <button
              key={d.id}
              onClick={() => onSelect(d.id, turn?.id)}
              className={cn(
                'mb-1 flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition',
                active ? 'bg-surface shadow-sm' : 'hover:bg-surface-muted',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold',
                  active ? 'bg-action text-white' : 'bg-neutral-200 text-fg-3',
                )}
              >
                {d.name.trim().charAt(0).toUpperCase() || <Heart size={11} />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[13.5px] font-semibold',
                    active ? 'text-fg' : 'text-fg-2',
                  )}
                >
                  {inName ? <Mark parts={inName} /> : d.name}
                </span>
                {/* The line that matched stands in for the summary while there's
                    a query: it is the answer to what was just asked, and the
                    status is back once the box is cleared. The spinner stays. */}
                {turn ? (
                  <span className="flex items-baseline gap-1.5 text-[11px] text-fg-3">
                    <span className="min-w-0 truncate">
                      <Mark parts={turn.line} />
                    </span>
                    {turn.count > 1 ? (
                      <span
                        className="tabular flex-none"
                        title={`${turn.count} turns mention it — this is the newest`}
                      >
                        +{turn.count - 1}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span
                    className={cn(
                      'block truncate text-[11px] text-fg-3',
                      !busy && photo === 'read' && 'font-medium text-action-700',
                      !busy && photo === 'failed' && 'text-no',
                    )}
                  >
                    {summary}
                  </span>
                )}
              </span>
              {busy || photo === 'reading' ? <Spinner className="mt-1.5 flex-none text-action" /> : null}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
