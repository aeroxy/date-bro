import { useState } from 'react'
import { Plus, Heart } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Button } from './ui/Button'
import { Input } from './ui/Field'
import { Eyebrow } from './ui/Card'
import { STAGES, type DateRecord } from '@/types/date'

function relative(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

const stageLabel = (record: DateRecord) =>
  STAGES.find((s) => s.value === record.stage)?.label ?? record.stage

export function DateRail({
  dates,
  activeId,
  onSelect,
  onCreate,
}: {
  dates: DateRecord[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const submit = () => {
    if (!name.trim()) return
    onCreate(name.trim())
    setName('')
    setAdding(false)
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

      <div className="scroll-slim flex-1 overflow-y-auto px-2 pb-4">
        {dates.length === 0 ? (
          <p className="px-2 py-6 text-[12.5px] leading-relaxed text-fg-3">
            No one here yet. Add the person you're seeing, write down what you know about them, and
            paste in your conversation.
          </p>
        ) : null}

        {dates.map((d) => {
          const active = d.id === activeId
          return (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
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
                  {d.name}
                </span>
                <span className="block truncate text-[11px] text-fg-3">
                  {stageLabel(d)} · {d.turns.length} turns · {relative(d.updatedAt)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
