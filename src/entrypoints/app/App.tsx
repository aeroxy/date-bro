import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, Heart, RotateCw, Settings, Sparkles, Square, Trash2, User, UserRound, X } from 'lucide-react'

import { ago } from '@/lib/ago'
import { ConversationPanel } from '@/components/ConversationPanel'
import { PersonContextView, SelfContextView } from '@/components/ContextView'
import { DateRail } from '@/components/DateRail'
import { AskComposer, type ProfileEdit } from '@/components/AskComposer'
import { MindButton, MindModal } from '@/components/MindModal'
import { ProfileModal } from '@/components/ProfileModal'
import { SettingsModal } from '@/components/SettingsModal'
import { SuggestionView } from '@/components/SuggestionView'
import { Button } from '@/components/ui/Button'
import { Chip, Eyebrow } from '@/components/ui/Card'
import { Logo } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { chatAboutProfile, rebuildPersonContext, rebuildSelfContext, suggestMove } from '@/coach/run'
import { useDates } from '@/hooks/useDates'
import { cn } from '@/lib/cn'
import { mergeResearchNotes } from '@/lib/research-notes'
import { adviceTurn } from '@/lib/transcript'
import type { ThinkingSummary } from '@/types/coach'
import { STAGES, type ChatEngine, type DateRecord, type Engine, type Turn } from '@/types/date'

type Tab = Engine
/** Runs keep going when you switch profiles, so a run is tagged with its date. */
type Busy = { id: string; tab: Tab } | null

const TAB_LABEL: Record<Tab, string> = { them: 'Them', me: 'You', next: 'Next move' }

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

/**
 * The two halves of a profile go stale separately, so one chip can't describe
 * both. The prose is amended without touching the judgment, so an amendment that
 * has just read every turn still leaves the interest read, the flags and the open
 * questions dated to the last full rebuild.
 *
 * Saying "conversation has moved on" in that state is wrong in the way that
 * matters: the user has just told it about the new turns, watched it rewrite the
 * profile from them, and is then told the conversation has moved on.
 */
type Staleness = 'fresh' | 'judgment' | 'stale'

function staleness(
  record: DateRecord,
  profile?: { turnsAt?: number; amendedTurnsAt?: number },
): Staleness {
  if (!profile) return 'fresh'
  const prose = profile.amendedTurnsAt ?? profile.turnsAt
  if (isStale(record, prose)) return 'stale'
  return isStale(record, profile.turnsAt) ? 'judgment' : 'fresh'
}

export default function App() {
  const { dates, active, activeId, setActiveId, loaded, loadError, create, update, remove } =
    useDates()
  const [tab, setTab] = useState<Tab>('them')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<{ id: string; tab: Tab; message: string } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMind, setShowMind] = useState(false)
  // Which coach turn's advice the `next` panel is showing. Null means the most
  // recent one — so a new run doesn't have to reach back and clear this, and
  // switching people lands on their latest rather than on nothing.
  const [viewingAdvice, setViewingAdvice] = useState<string | null>(null)
  const [activity, setActivity] = useState<string[]>([])
  const [thinking, setThinking] = useState<ThinkingSummary | null>(null)
  // The last profile amendment, shown once under the composer. Not persisted —
  // see `sendChat`. Tagged with the record and tab it belongs to, like `busy`
  // and `error`, rather than cleared on every switch path: a result about one
  // profile means nothing under another, and tagging can't miss a route.
  const [edit, setEdit] = useState<({ id: string; tab: ChatEngine } & ProfileEdit) | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The real mutex. `busy` drives the UI, but it only lands on the next render,
  // so two calls in one tick (a fast double-click, Enter held down) would both
  // read it as null and start. A ref is set synchronously.
  const runningRef = useRef(false)

  // The three tabs share one scroll container, so React keeps its offset across
  // a switch: leaving Them halfway down dropped you into the middle of option
  // three on Next move. Reset before paint, or the wrong position is visible for
  // a frame. Switching person too — it's a different conversation.
  const panelRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0
  }, [tab, activeId])

  /**
   * `message` is one-shot on all three engines and never stored: what's going on
   * right now for `next`, and for a first rebuild on Them/You, whatever the user
   * pasted in to say who these people are. It reaches the model in the volatile
   * tail and what survives is only what the profile absorbed from it.
   */
  const run = useCallback(
    async (which: Tab, message = ''): Promise<boolean> => {
      if (!active || runningRef.current) return false
      runningRef.current = true
      const id = active.id
      setTab(which)
      setBusy({ id, tab: which })
      setError(null)
      setActivity([])
      setThinking(null)
      const controller = new AbortController()
      abortRef.current = controller

      const record = active

      try {
        if (which === 'them') {
          const ctx = await rebuildPersonContext(record, message, controller.signal, setThinking)
          await update(id, { themProfile: ctx })
        } else if (which === 'me') {
          const ctx = await rebuildSelfContext(record, message, controller.signal, setThinking)
          await update(id, { meProfile: ctx })
        } else {
          const suggestion = await suggestMove(
            record,
            message,
            controller.signal,
            (label) => setActivity((prev) => [...prev, label]),
            setThinking,
          )
          // Against `current`, not the snapshot this run started from: the user
          // can add turns or edit the research notes while the model is
          // thinking, and a snapshot-derived patch would undo them.
          //
          // `evidence: false` because the advice is the coach's own line, not
          // something either person said — without it, asking "what do I say?"
          // would immediately mark both profiles as stale.
          await update(
            id,
            (current) => ({
              turns: [...current.turns, adviceTurn(suggestion)],
              researchNotes: mergeResearchNotes(current.researchNotes, suggestion.research_notes),
            }),
            { evidence: false },
          )
          setViewingAdvice(suggestion.id)
        }
        return true
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError({ id, tab: which, message: (e as Error).message })
        }
        // An abort counts as sent: the user stopped it on purpose, and handing
        // their text back as if the app had failed is just noise.
        return (e as Error).name === 'AbortError'
      } finally {
        runningRef.current = false
        abortRef.current = null
        setBusy(null)
      }
    },
    [active, update],
  )

  /** Tear down the in-flight run. `run`'s catch swallows the AbortError. */
  const stop = useCallback(() => abortRef.current?.abort(), [])

  /**
   * One instruction to amend a profile, applied and forgotten.
   *
   * Only the profile is written. The instruction and the reply are held in
   * component state and shown once, because the instruction's whole effect has
   * already landed in `markdown` — storing it as well would keep the same
   * information twice and re-send the redundant copy on every later request.
   *
   * `markdown`, `amendedAt`, `amendedTurnsAt` — and the headline, when the
   * amendment made the old one wrong. The rest of the judgment is left exactly
   * as the last full rebuild produced it: re-deciding where things *stand* off
   * the back of one remark is how a read starts drifting, and `Rebuild` is right
   * there.
   *
   * The headline is the exception because it isn't a judgment about the person,
   * it's a description of the prose — and the prose just changed. Leaving it
   * put a stale sentence directly above a correction that contradicted it, which
   * is what actually happened: "you haven't spoken to them yet" sitting on top of
   * nine cited messages.
   */
  const sendChat = useCallback(
    async (engine: ChatEngine, message: string): Promise<boolean> => {
      if (!active || runningRef.current) return false
      runningRef.current = true
      const id = active.id
      setBusy({ id, tab: engine })
      setError(null)
      // Cleared like `run` does. `Thinking` renders whenever the busy tab is
      // the visible one, so an amend on Them inherited the last next-move's
      // "Searching: …" lines and claimed to be doing research it isn't.
      setActivity([])
      setThinking(null)
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const { reply, headline, markdown, changed } = await chatAboutProfile(
          active,
          engine,
          message,
          controller.signal,
          setThinking,
        )
        const now = Date.now()
        const profileKey = engine === 'them' ? 'themProfile' : 'meProfile'
        // The transcript this amendment actually read, captured before the call
        // rather than taken from `current` below: a turn added while the model
        // was thinking is one it didn't see.
        const sawTurns = active.turnsUpdatedAt

        // Against `current`, not the snapshot: the user can add turns or edit
        // the profile while the model is thinking.
        await update(id, (current) => {
          const profile = current[profileKey]
          // An instruction before the first rebuild has no profile to amend, and
          // inventing one here would fabricate a judgment nothing produced.
          if (!profile) return {}
          return {
            [profileKey]: {
              ...profile,
              markdown,
              amendedAt: now,
              amendedTurnsAt: sawTurns,
              ...(headline
                ? { judgment: { ...profile.judgment, headline } }
                : {}),
            },
          }
        })
        setEdit({ id, tab: engine, reply, changed })
        return true
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError({ id, tab: engine, message: (e as Error).message })
        }
        return (e as Error).name === 'AbortError'
      } finally {
        runningRef.current = false
        abortRef.current = null
        setBusy(null)
      }
    },
    [active, update],
  )

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

  /**
   * An answer to one of an engine's own open questions. It lands in the pool as
   * a note carrying the question, which is what makes a three-word reply mean
   * something later — and what fixes attribution for free, since a question
   * about her can't produce an answer that gets filed under him.
   *
   * Appended, not inserted: this is known *now*, whatever period it describes.
   */
  const answerQuestion = useCallback(
    (question: string, answer: string) => {
      if (!active) return
      const turn: Turn = {
        id: crypto.randomUUID(),
        speaker: 'context',
        text: answer.trim(),
        asked: question,
      }
      persist(
        update(active.id, (current) => ({ turns: [...current.turns, turn] })),
        tab,
      )
    },
    [active, persist, tab, update],
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

  // The advice history *is* the conversation now — no parallel list, no cap, no
  // pills. Reading it back out of `turns` keeps one source: delete the bubble
  // and the suggestion is gone with it, because they were never two things.
  const adviceTurns = active?.turns.filter((t) => t.speaker === 'coach' && t.advice) ?? []
  const shownAdvice =
    adviceTurns.find((t) => t.id === viewingAdvice) ?? adviceTurns[adviceTurns.length - 1]
  const suggestion = shownAdvice?.advice
  // Which drafts have been sent, derived rather than flagged — the same trick
  // as `answered` below. A draft is sent when a turn of the user's holds that
  // exact text, which survives a reload and can't drift out of step with the
  // transcript. Edit the wording before sending and it won't match, which is
  // correct: what's in the pool is then not the draft.
  const sentDrafts = new Set(
    active?.turns.filter((t) => t.speaker === 'me').map((t) => t.text.trim()) ?? [],
  )
  // Derived from the pool rather than tracked: a question is done when a turn
  // answers it, which survives reloads and clears itself on the next rebuild.
  const answerProps = active
    ? {
        answered: new Set(
          active.turns.map((t) => t.asked).filter((q): q is string => Boolean(q)),
        ),
        onAnswer: answerQuestion,
        disabled: !!busy,
      }
    : undefined
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
  // Them/You before their first rebuild. The footer box has no profile to amend
  // in that state, so it seeds one instead of sitting there disabled.
  const seeding = !!active && tab !== 'next' && !(tab === 'them' ? active.themProfile : active.meProfile)

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />

      <DateRail
        dates={dates}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id)
          setViewingAdvice(null)
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
                {active.goal.trim() ? 'Edit profile' : 'What do you want from this? →'}
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
            <MindButton onClick={() => setShowMind(true)} />
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
            // A coach bubble is the summary; the panel holds the rest of it.
            // Switching tab as well, because a click that visibly changes
            // nothing reads as a dead control — the full version is over there.
            // Only while the panel is actually showing it. The `next` tab
            // defaults to the newest advice whether or not anyone is looking at
            // it, and a bubble that says "shown in the panel" while the panel
            // shows the read of her is just wrong.
            viewingAdvice={tab === 'next' ? (shownAdvice?.id ?? null) : null}
            onOpenAdvice={(id) => {
              setViewingAdvice(id)
              setTab('next')
            }}
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

              <div ref={panelRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
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

                {busyTab === tab ? (
                  <Thinking tab={tab} name={active.name} activity={activity} thinking={thinking} />
                ) : tab === 'them' ? (
                  active.themProfile ? (
                    <>
                      <Freshness
                        at={active.themProfile.generatedAt}
                        amendedAt={active.themProfile.amendedAt}
                        stale={staleness(active, active.themProfile)}
                        onClear={() => {
                          if (
                            confirm(
                              `Start over on ${active.name}?\n\nThis throws away everything written down about them so far. The next rebuild starts from a blank page and reads the conversation again — which is the point when the notes have drifted, and a waste when they haven't.\n\nAnything you typed straight into the box below was read once and never stored, so it isn't in the conversation to be read again.`,
                            )
                          ) {
                            persist(update(active.id, { themProfile: undefined }), 'them')
                          }
                        }}
                      />
                      <PersonContextView ctx={active.themProfile} name={active.name} answer={answerProps} />
                    </>
                  ) : (
                    <BlankSlate
                      title={`No read on ${active.name} yet`}
                      body={`Tell it what you know in the box below — a bio, a dating profile, whatever you've got. Add some of the conversation too: everything you get back cites the line it came from.`}
                      cta="Rebuild them"
                      onRun={() => run('them')}
                    />
                  )
                ) : tab === 'me' ? (
                  active.meProfile ? (
                    <>
                      <Freshness
                        at={active.meProfile.generatedAt}
                        amendedAt={active.meProfile.amendedAt}
                        stale={staleness(active, active.meProfile)}
                        onClear={() => {
                          if (
                            confirm(
                              "Start over on you?\n\nThis throws away everything written down about you in this connection. The next rebuild starts from a blank page and reads the conversation again.\n\nAnything you typed straight into the box below — a CV, what you do — was read once and never stored, so it isn't in the conversation to be read again.",
                            )
                          ) {
                            persist(update(active.id, { meProfile: undefined }), 'me')
                          }
                        }}
                      />
                      <SelfContextView ctx={active.meProfile} answer={answerProps} />
                    </>
                  ) : (
                    <BlankSlate
                      title="No read on you yet"
                      body="This is the half you control — how you're landing, what's working, and what your messages say about what you actually want. Paste your CV in the box below if you want it to know the background."
                      cta="Rebuild you"
                      onRun={() => run('me')}
                    />
                  )
                ) : suggestion ? (
                  <>
                    <Freshness
                      at={suggestion.generatedAt}
                      // A suggestion has no prose/judgment split to report on:
                      // it is regenerated whole or not at all.
                      stale={isStale(active, suggestion.turnsAt) ? 'stale' : 'fresh'}
                      label="Suggested"
                      clearLabel="Delete this suggestion"
                      onClear={() => {
                        if (confirm("Delete this suggestion? This can't be undone.")) {
                          // The turn and the advice are one object, so this is
                          // one delete. `evidence: false` for the same reason
                          // the append was: removing the coach's own line
                          // doesn't change what either person said.
                          persist(
                            update(
                              active.id,
                              (current) => ({
                                turns: current.turns.filter((t) => t.id !== shownAdvice!.id),
                              }),
                              { evidence: false },
                            ),
                            'next',
                          )
                          setViewingAdvice(null)
                        }
                      }}
                    />
                    {/* No history pills. Earlier advice is in the conversation,
                        in the position it was given — click a COACH bubble to
                        read it there, next to what the user actually did. */}
                    <SuggestionView
                      suggestion={suggestion}
                      sent={sentDrafts}
                      onSend={(draft) => {
                        const turn: Turn = {
                          id: crypto.randomUUID(),
                          speaker: 'me',
                          text: draft.trim(),
                        }
                        persist(
                          update(active.id, (current) => ({ turns: [...current.turns, turn] })),
                          'next',
                        )
                      }}
                    />
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

              {/* One box per tab, in the same place, all one-shot. Keyed on the
                  person *and* the tab so a half-typed instruction about her
                  can't reappear under him, or under the drafts. */}
              {tab === 'next' ? (
                <AskComposer
                  key={`${active.id}:next`}
                  label="Anything specific right now?"
                  placeholder="e.g. she left me on read for 2 days — optional"
                  cta="What do I say?"
                  hint="Used for this answer only."
                  busy={!!busy}
                  onSend={(message) => run('next', message)}
                />
              ) : seeding ? (
                /* No profile yet, so there is nothing to amend and this used to
                   be disabled. It seeds the first rebuild instead — the one
                   place a new user can hand over a CV or a pasted bio without
                   it becoming a turn they later have to go and delete. Read
                   once, absorbed into the profile, never stored. */
                <AskComposer
                  key={`${active.id}:${tab}`}
                  label={`Tell it about ${tab === 'them' ? active.name : 'you'}`}
                  placeholder={
                    tab === 'them'
                      ? `Paste ${active.name}'s bio or dating profile, or just say what you already know`
                      : 'Paste your CV, or just say what you do and what your life looks like'
                  }
                  cta="Rebuild"
                  hint="Read once, not kept — what it learns goes in the profile."
                  busy={!!busy}
                  needsText
                  onSend={(message) => run(tab, message)}
                />
              ) : (
                <AskComposer
                  key={`${active.id}:${tab}`}
                  label={`Change what it knows about ${tab === 'them' ? active.name : 'you'}`}
                  // Tab-specific: the example under "change what it knows about
                  // you" used to be a correction about *her*, which reads as the
                  // box editing the wrong profile.
                  placeholder={
                    tab === 'them'
                      ? "e.g. drop the avoidant read — she works nights, that's why the 2am replies"
                      : "e.g. I'm not looking for anything serious — stop reading my replies as hesitation"
                  }
                  cta="Apply"
                  hint="Applied once. The notes above are what gets kept."
                  busy={!!busy}
                  needsText
                  edit={edit && edit.id === active.id && edit.tab === tab ? edit : null}
                  onDismiss={() => setEdit(null)}
                  onSend={(message) => sendChat(tab, message)}
                />
              )}
            </aside>
          </div>
        </main>
      )}

      {active ? (
        // Keyed on the person, like ConversationPanel and AskComposer. The
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

      <MindModal open={showMind} onClose={() => setShowMind(false)} />

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
  amendedAt,
  stale,
  onClear,
  label = 'Rebuilt',
  clearLabel = 'Delete this rebuild',
}: {
  at: number
  /**
   * Shown beside the rebuild time rather than replacing it, because the two
   * halves of a profile age separately: a chat turn amends the prose and leaves
   * the judgment alone. One clock would have to misdate one of them.
   */
  amendedAt?: number
  stale: Staleness
  onClear?: () => void
  label?: string
  clearLabel?: string
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Eyebrow>
        {label} {ago(at)}
        {amendedAt && amendedAt > at ? ` · edited ${ago(amendedAt)}` : ''}
      </Eyebrow>
      <span className="h-px flex-1 bg-border" />
      {stale === 'stale' ? (
        <Chip tone="warn">conversation has moved on</Chip>
      ) : stale === 'judgment' ? (
        // The prose has read every turn; only what a rebuild produces hasn't.
        <Chip tone="warn">judgment predates these turns</Chip>
      ) : null}
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
