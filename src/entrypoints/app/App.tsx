import { useCallback, useRef, useState } from 'react'
import { AlertCircle, Heart, RotateCw, Settings, Sparkles, Square, Trash2, User, UserRound, X } from 'lucide-react'

import { ago } from '@/lib/ago'
import { ConversationPanel } from '@/components/ConversationPanel'
import { PersonContextView, SelfContextView } from '@/components/ContextView'
import { DateRail } from '@/components/DateRail'
import { FeedbackThread } from '@/components/FeedbackThread'
import { ProfileModal } from '@/components/ProfileModal'
import { SettingsModal } from '@/components/SettingsModal'
import { SuggestionView } from '@/components/SuggestionView'
import { Button } from '@/components/ui/Button'
import { Chip, Eyebrow } from '@/components/ui/Card'
import { Logo } from '@/components/ui/Logo'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { rebuildPersonContext, rebuildSelfContext, suggestMove } from '@/coach/run'
import { useDates } from '@/hooks/useDates'
import { cn } from '@/lib/cn'
import { mergeResearchNotes } from '@/lib/research-notes'
import type { ThinkingSummary } from '@/types/coach'
import { STAGES, type DateRecord, type Engine } from '@/types/date'

type Tab = Engine
/** Runs keep going when you switch profiles, so a run is tagged with its date. */
type Busy = { id: string; tab: Tab } | null

const TAB_LABEL: Record<Tab, string> = { them: 'Them', me: 'You', next: 'Next move' }

const FEEDBACK_PLACEHOLDER: Record<Tab, (name: string) => string> = {
  them: (name) => `e.g. drop the avoidant read — ${name} works nights, that's why the replies land at 2am`,
  me: () => "e.g. you're reading my short replies wrong — that's just how I text",
  next: () => 'e.g. stop suggesting bars, and drop the "just checking in" opener',
}

/**
 * A read is stale the moment the transcript moves under it — and only then.
 * Both sides of the comparison are `turnsUpdatedAt` values, so rebuilding the
 * other tab, editing the profile, or leaving a note doesn't count, and a turn
 * added *while* the run was in flight does.
 */
function isStale(record: DateRecord, basis?: number): boolean {
  if (basis === undefined) return false
  return record.turnsUpdatedAt > basis
}

export default function App() {
  const { dates, active, activeId, setActiveId, loaded, loadError, create, update, remove } =
    useDates()
  const [tab, setTab] = useState<Tab>('them')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<{ id: string; tab: Tab; message: string } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [situation, setSituation] = useState('')
  const [showProfile, setShowProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [viewingSuggestion, setViewingSuggestion] = useState<string | null>(null)
  const [activity, setActivity] = useState<string[]>([])
  const [thinking, setThinking] = useState<ThinkingSummary | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The real mutex. `busy` drives the UI, but it only lands on the next render,
  // so two calls in one tick (a fast double-click, Enter held down) would both
  // read it as null and start. A ref is set synchronously.
  const runningRef = useRef(false)

  const run = useCallback(
    async (which: Tab, note?: string) => {
      if (!active || runningRef.current) return
      runningRef.current = true
      const id = active.id
      setTab(which)
      setBusy({ id, tab: which })
      setError(null)
      setActivity([])
      setThinking(null)
      const controller = new AbortController()
      abortRef.current = controller

      let record = active

      try {
        // A note joins the thread before the run, so this run already sees it
        // and it survives a failure — feedback shouldn't be lost to a network
        // error. Inside the try because a failed write here still has to clear
        // `busy`, or every button stays disabled for good.
        if (note?.trim()) {
          const trimmed = note.trim()
          const written = await update(id, (current) => ({
            feedback: { ...current.feedback, [which]: [...current.feedback[which], trimmed] },
          }))
          if (written) record = written
        }

        if (which === 'them') {
          const ctx = await rebuildPersonContext(record, controller.signal, setThinking)
          await update(id, { themContext: ctx })
        } else if (which === 'me') {
          const ctx = await rebuildSelfContext(record, controller.signal, setThinking)
          await update(id, { meContext: ctx })
        } else {
          const suggestion = await suggestMove(
            record,
            situation,
            controller.signal,
            (label) => setActivity((prev) => [...prev, label]),
            setThinking,
          )
          // Against `current`, not the snapshot this run started from: the user
          // can edit the research notes or delete a suggestion while the model
          // is thinking, and a snapshot-derived patch would undo them.
          await update(id, (current) => ({
            suggestions: [suggestion, ...current.suggestions].slice(0, 20),
            researchNotes: mergeResearchNotes(current.researchNotes, suggestion.research_notes),
          }))
          setViewingSuggestion(suggestion.id)
          setSituation('')
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError({ id, tab: which, message: (e as Error).message })
        }
      } finally {
        runningRef.current = false
        abortRef.current = null
        setBusy(null)
      }
    },
    [active, situation, update],
  )

  /** Tear down the in-flight run. `run`'s catch swallows the AbortError. */
  const stop = useCallback(() => abortRef.current?.abort(), [])

  /**
   * For writes that aren't inside `run`'s try/catch. `update` and `remove` await
   * IndexedDB, so a rejected write — blocked store, quota, a corrupt db — was an
   * unhandled rejection: the UI had already re-rendered from state, so the change
   * looked saved and silently wasn't. Surfaces it on the panel instead.
   */
  const persist = useCallback(
    (work: Promise<unknown>, tab: Tab) => {
      const id = activeId
      // First run, before anything is selected: there's no panel to put this
      // on, so it goes to the rail's own slot. Without somewhere to land, a
      // failed first create cleared the box and looked like a dead button.
      if (!id) {
        work.catch((e: unknown) => setCreateError((e as Error).message))
        return
      }
      work.catch((e: unknown) => {
        setError({ id, tab, message: `Couldn't save that: ${(e as Error).message}` })
      })
    },
    [activeId],
  )

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-fg-3">
        <Spinner />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <AlertCircle size={20} className="mx-auto mb-3 text-no" />
          <h1 className="text-[15px] font-bold tracking-[-0.02em]">Couldn't open your data</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-2">
            Everything is stored in this browser's IndexedDB, and it didn't open. Reloading usually
            fixes it; if it doesn't, the store may be blocked by another tab of this extension.
          </p>
          <p className="mt-3 break-words font-mono text-[11px] text-fg-3">{loadError}</p>
        </div>
      </div>
    )
  }

  const suggestion =
    active?.suggestions.find((s) => s.id === viewingSuggestion) ?? active?.suggestions[0]
  // A run belonging to another profile shouldn't render as this one thinking.
  const busyTab = busy && busy.id === activeId ? busy.tab : null
  // ...but it still has to be stoppable from wherever the user ended up. `busy`
  // outliving its own profile is the sharp case: delete the record mid-run and
  // no `activeId` can ever match it again.
  const runningElsewhere = busy && busyTab !== tab ? busy : null
  const runningName = runningElsewhere
    ? (dates.find((d) => d.id === runningElsewhere.id)?.name ?? 'a deleted profile')
    : null
  const shownError = error && error.id === activeId ? error : null

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />

      <DateRail
        dates={dates}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id)
          setViewingSuggestion(null)
          setSituation('')
        }}
        createError={createError}
        onCreate={(name) => {
          // Surfaces on the current panel when there is one, and in the rail's
          // own slot when there isn't (see `persist`).
          setCreateError(null)
          persist(
            create(name).then(() => setShowProfile(true)),
            tab,
          )
        }}
      />

      {!active ? (
        <Welcome onSettings={() => setShowSettings(true)} />
      ) : (
        <main className="relative flex min-w-0 flex-1 flex-col">
          <header className="flex flex-none items-center gap-3 border-b border-border bg-surface px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[19px] font-bold tracking-[-0.03em]">{active.name}</h1>
                <Chip tone="live">
                  {STAGES.find((s) => s.value === active.stage)?.label ?? active.stage}
                </Chip>
              </div>
              {/* Closed while this record is rebuilding. The run works from a
                  snapshot taken at the start, so an edit landing mid-run comes
                  back as a read labelled "just now" that contradicts what the
                  user just wrote — and staleness deliberately tracks turns
                  only, so nothing would flag it. A run on some *other* profile
                  is no reason to lock this one. */}
              <button
                onClick={() => setShowProfile(true)}
                disabled={busy?.id === active.id}
                title={busy?.id === active.id ? 'Finishes rebuilding first' : undefined}
                className="text-[11.5px] text-fg-3 transition hover:text-action disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg-3"
              >
                {active.seedThem.trim() ? 'Edit profile & context' : 'Add what you know about them →'}
              </button>
            </div>

            <span className="flex-1" />

            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => run('them')}>
              {busyTab === 'them' ? <Spinner /> : <Heart size={13} />}
              Rebuild them
            </Button>
            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => run('me')}>
              {busyTab === 'me' ? <Spinner /> : <UserRound size={13} />}
              Rebuild you
            </Button>
            <Button variant="accent" size="sm" disabled={!!busy} onClick={() => run('next')}>
              {busyTab === 'next' ? <Spinner /> : <Sparkles size={13} />}
              What do I say?
            </Button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-md p-2 text-fg-3 transition hover:bg-surface-muted hover:text-fg"
              title="Settings"
            >
              <Settings size={15} />
            </button>
          </header>

          <div className="flex min-h-0 flex-1">
            {/* Keyed so drafts and the import box don't follow you to another profile. */}
          <ConversationPanel
            key={active.id}
            record={active}
            onChange={(turns) => persist(update(active.id, { turns }), tab)}
          />

            <aside className="flex h-full w-[440px] flex-none flex-col border-l border-border bg-surface">
              <div className="flex flex-none items-center gap-1 border-b border-border px-3 py-2">
                {(
                  [
                    { id: 'them' as Tab, label: 'Them', icon: Heart },
                    { id: 'me' as Tab, label: 'You', icon: User },
                    { id: 'next' as Tab, label: 'Next move', icon: Sparkles },
                  ]
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition',
                      tab === id
                        ? 'bg-surface-muted text-fg'
                        : 'text-fg-3 hover:bg-surface-muted/60 hover:text-fg-2',
                    )}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
                <span className="flex-1" />
                {/* Becomes the only way out of a long run — a Qwen anti-bot
                    back-off is three 30s waits, and every other control is
                    disabled while one is in flight. Shown for *any* run in
                    flight, not just this tab's: it used to be gated on
                    `busyTab === tab`, so switching profile or tab hid the one
                    control that could end the run the user was waiting on. The
                    spinner still only spins for this tab's own run. */}
                {busy ? (
                  <button
                    onClick={stop}
                    className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold text-fg-3 transition hover:bg-no-soft hover:text-no-strong"
                    title={runningName ? `Stop the run on ${runningName}` : 'Stop this run'}
                  >
                    {runningElsewhere ? (
                      <Square size={11} className="fill-current" />
                    ) : (
                      <>
                        <Spinner className="group-hover:hidden" />
                        <Square size={11} className="hidden fill-current group-hover:block" />
                      </>
                    )}
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => run(tab)}
                    disabled={!!busy}
                    className="rounded-md p-1.5 text-fg-3 transition hover:bg-surface-muted hover:text-action disabled:opacity-40"
                    title="Run again"
                  >
                    <RotateCw size={13} />
                  </button>
                )}
              </div>

              <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {/* Shown on whichever tab is open, not only the one that failed
                    — a failure the user never sees is the same as a silent one.
                    Dismissable, because otherwise it sits there past the point
                    where the cause has been fixed. */}
                {shownError ? (
                  <div className="mb-4 flex gap-2.5 rounded-md border border-no/40 bg-no-soft px-3.5 py-3">
                    <AlertCircle size={15} className="mt-0.5 flex-none text-no" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-no-strong">
                        {shownError.tab === tab
                          ? "That didn't run"
                          : `${TAB_LABEL[shownError.tab]} didn't run`}
                      </p>
                      <p className="mt-0.5 break-words text-[12px] leading-relaxed text-fg-2">
                        {shownError.message}
                      </p>
                    </div>
                    <button
                      onClick={() => setError(null)}
                      className="-mr-1 -mt-1 flex-none self-start rounded p-1 text-fg-3 transition hover:text-fg"
                      aria-label="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : null}

                {tab === 'next' ? (
                  <div className="mb-4">
                    {/* One-shot, unlike the notes thread in the footer. */}
                    <Eyebrow className="mb-1.5 block">Anything specific right now?</Eyebrow>
                    <Input
                      value={situation}
                      disabled={!!busy}
                      onChange={(e) => setSituation(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') run('next')
                      }}
                      placeholder="e.g. she left me on read for 2 days — optional"
                    />
                  </div>
                ) : null}

                {busyTab === tab ? (
                  <Thinking tab={tab} name={active.name} activity={activity} thinking={thinking} />
                ) : tab === 'them' ? (
                  active.themContext ? (
                    <>
                      <Freshness
                        at={active.themContext.generatedAt}
                        stale={isStale(active, active.themContext.turnsAt)}
                        onClear={() => {
                          if (confirm(`Delete this read on ${active.name}? You can rebuild it any time.`)) {
                            persist(update(active.id, { themContext: undefined }), 'them')
                          }
                        }}
                      />
                      <PersonContextView ctx={active.themContext} name={active.name} />
                    </>
                  ) : (
                    <BlankSlate
                      title={`No read on ${active.name} yet`}
                      body="Write what you know in the profile, add some of the conversation, then rebuild. Everything you get back cites the turn it came from."
                      cta="Rebuild them"
                      onRun={() => run('them')}
                    />
                  )
                ) : tab === 'me' ? (
                  active.meContext ? (
                    <>
                      <Freshness
                        at={active.meContext.generatedAt}
                        stale={isStale(active, active.meContext.turnsAt)}
                        onClear={() => {
                          if (confirm('Delete this read on you? You can rebuild it any time.')) {
                            persist(update(active.id, { meContext: undefined }), 'me')
                          }
                        }}
                      />
                      <SelfContextView ctx={active.meContext} />
                    </>
                  ) : (
                    <BlankSlate
                      title="No read on you yet"
                      body="This is the half you control — how you're landing, what's working, and what your messages say about what you actually want."
                      cta="Rebuild you"
                      onRun={() => run('me')}
                    />
                  )
                ) : suggestion ? (
                  <>
                    <Freshness
                      at={suggestion.generatedAt}
                      stale={isStale(active, suggestion.turnsAt)}
                      label="Suggested"
                      clearLabel="Delete this suggestion"
                      onClear={() => {
                        if (confirm("Delete this suggestion? This can't be undone.")) {
                          const remaining = active.suggestions.filter((s) => s.id !== suggestion.id)
                          persist(update(active.id, { suggestions: remaining }), 'next')
                          setViewingSuggestion(remaining[0]?.id ?? null)
                        }
                      }}
                    />
                    {active.suggestions.length > 1 ? (
                      <div className="mb-4 flex flex-wrap gap-1.5">
                        {active.suggestions.map((s, i) => (
                          <button
                            key={s.id}
                            onClick={() => setViewingSuggestion(s.id)}
                            className={cn(
                              'rounded-full border px-2.5 py-0.5 text-[11px] transition',
                              s.id === suggestion.id
                                ? 'border-action-300 bg-action-soft text-action-700'
                                : 'border-border text-fg-3 hover:text-fg',
                            )}
                          >
                            {i === 0 ? 'latest' : ago(s.generatedAt)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <SuggestionView suggestion={suggestion} />
                  </>
                ) : (
                  <BlankSlate
                    title="Nothing suggested yet"
                    body="You'll get two or three genuinely different options — with the actual text to send, why it works, and how to read what comes back."
                    cta="What do I say?"
                    onRun={() => run('next')}
                  />
                )}
              </div>

              <FeedbackThread
                key={`${active.id}:${tab}`}
                notes={active.feedback[tab]}
                busy={!!busy}
                placeholder={FEEDBACK_PLACEHOLDER[tab](active.name)}
                onRemove={(i) =>
                  persist(
                    update(active.id, (current) => ({
                      feedback: {
                        ...current.feedback,
                        [tab]: current.feedback[tab].filter((_, j) => j !== i),
                      },
                    })),
                    tab,
                  )
                }
                onSend={(note) => run(tab, note)}
              />
            </aside>
          </div>
        </main>
      )}

      {active ? (
        // Keyed on the person, like ConversationPanel and FeedbackThread. The
        // overlay blocks pointer input on the rail but not Tab, so a keyboard
        // switch while this was open left the draft holding person A's data and
        // `onSave` writing it to person B. Remounting discards the stale draft.
        <ProfileModal
          key={active.id}
          open={showProfile}
          record={active}
          onClose={() => setShowProfile(false)}
          onSave={(patch) => persist(update(active.id, patch), tab)}
          onDelete={() => persist(remove(active.id), tab)}
        />
      ) : null}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={() => setError(null)}
      />
    </div>
  )
}

function Freshness({
  at,
  stale,
  onClear,
  label = 'Rebuilt',
  clearLabel = 'Delete this rebuild',
}: {
  at: number
  stale: boolean
  onClear?: () => void
  label?: string
  clearLabel?: string
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Eyebrow>
        {label} {ago(at)}
      </Eyebrow>
      <span className="h-px flex-1 bg-border" />
      {stale ? <Chip tone="warn">conversation has moved on</Chip> : null}
      {onClear ? (
        <button
          onClick={onClear}
          className="rounded p-1 text-fg-3 transition hover:bg-no-soft hover:text-no-strong"
          title={clearLabel}
        >
          <Trash2 size={12} />
        </button>
      ) : null}
    </div>
  )
}

function Thinking({
  tab,
  name,
  activity,
  thinking,
}: {
  tab: Tab
  name: string
  activity: string[]
  thinking: ThinkingSummary | null
}) {
  const line =
    tab === 'them'
      ? `Reading everything ${name} has said…`
      : tab === 'me'
        ? 'Reading how you come across…'
        : 'Working out what to do next…'

  // Tool calls when there are any, otherwise the model's own reasoning headings.
  // On the Anthropic backend both can arrive in one run — the summary has no
  // headings, so it lands in `thought` below and research keeps the step list.
  const steps = activity.length ? activity : (thinking?.titles ?? [])
  const thought = thinking?.thoughts.length ? thinking.thoughts[thinking.thoughts.length - 1] : null

  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <Spinner className="h-5 w-5 text-action" />
      <p className="animate-breathe text-[13px] text-fg-3">{line}</p>
      {steps.length ? (
        <ul className="mt-1 max-w-[320px] space-y-1 text-left">
          {steps.map((label, i) => (
            <li
              key={i}
              className={cn(
                'flex items-start gap-1.5 text-[11.5px] leading-relaxed',
                i === steps.length - 1 ? 'text-fg-2' : 'text-fg-3 line-through decoration-neutral-300',
              )}
            >
              <span className="mt-1 h-1 w-1 flex-none rounded-full bg-neutral-300" />
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="max-w-[280px] text-[11.5px] leading-relaxed text-fg-3">
          This one's a long think — it re-reads the whole transcript against the seed context.
        </p>
      )}
      {thought ? (
        // Clamped so a long summary can't push the page around while it streams.
        <p className="line-clamp-4 max-w-[380px] whitespace-pre-line text-left text-[11px] italic leading-relaxed text-fg-3/80">
          {thought}
        </p>
      ) : null}
    </div>
  )
}

function BlankSlate({
  title,
  body,
  cta,
  onRun,
}: {
  title: string
  body: string
  cta: string
  onRun: () => void
}) {
  return (
    <div className="py-14 text-center">
      <h3 className="text-[14px] font-bold tracking-[-0.02em] text-fg">{title}</h3>
      <p className="mx-auto mt-2 max-w-[300px] text-[12.5px] leading-relaxed text-fg-3">{body}</p>
      <Button variant="accent" size="sm" className="mt-4" onClick={onRun}>
        {cta}
      </Button>
    </div>
  )
}

function Welcome({ onSettings }: { onSettings: () => void }) {
  return (
    <main className="relative flex flex-1 items-center justify-center px-6">
      <div className="max-w-lg text-center">
        <Logo size={34} className="mx-auto mb-4" />
        <Eyebrow>Date Bro</Eyebrow>
        <h1 className="display mt-3">Know where you stand.</h1>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-fg-2">
          Write down what you know about the person you're seeing, paste in your conversation, and
          get an evidence-backed read on them, on you, and on what to do next. Everything stays in
          this browser.
        </p>
        <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-fg-3">
          Add someone in the sidebar to start. First time here, point it at a model in{' '}
          <button onClick={onSettings} className="font-semibold text-action-700 hover:underline">
            Settings
          </button>
          .
        </p>
      </div>
    </main>
  )
}
