import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, Heart, RotateCw, Settings, Sparkles, Square, Trash2, User, UserRound, X } from 'lucide-react'

import { ago } from '@/lib/ago'
import { ConversationPanel } from '@/components/ConversationPanel'
import { PersonContextView, SelfContextView } from '@/components/ContextView'
import { DateRail } from '@/components/DateRail'
import { AskComposer, type ProfileEdit } from '@/components/AskComposer'
import { ExportButton, ExportModal } from '@/components/ExportModal'
import { MindButton, MindModal } from '@/components/MindModal'
import { ProfileModal } from '@/components/ProfileModal'
import { SettingsModal } from '@/components/SettingsModal'
import { SuggestionView } from '@/components/SuggestionView'
import { Button } from '@/components/ui/Button'
import { Chip, Eyebrow } from '@/components/ui/Card'
import { Logo } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { applyProfileUpdate } from '@/coach/profile'
import { chatAboutProfile, rebuildPersonContext, rebuildSelfContext, suggestMove } from '@/coach/run'
import { useDates } from '@/hooks/useDates'
import { cn } from '@/lib/cn'
import { applyResearchNotes } from '@/lib/research-notes'
import { adviceTurn } from '@/lib/transcript'
import type { ThinkingSummary } from '@/types/coach'
import { STAGES, type ChatEngine, type DateRecord, type Engine, type Turn } from '@/types/date'

type Tab = Engine

const TAB_LABEL: Record<Tab, string> = { them: 'Them', me: 'You', next: 'Next move' }

/**
 * A copy without one key, or the same object when there was nothing to remove —
 * so clearing state a person never had doesn't re-render. Every run-scoped map
 * below is keyed by record id and pruned through this.
 */
function omit<T>(map: Record<string, T>, id: string): Record<string, T> {
  if (!(id in map)) return map
  const next = { ...map }
  delete next[id]
  return next
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
  /**
   * Everything a run owns is keyed by person, because a run belongs to one.
   * Two profiles share nothing but the backend, so a single global slot meant
   * a rebuild on one disabled every control on all of them — waiting out Mira's
   * rebuild to ask what to say to Sam, for no reason either of them could see.
   *
   * Still one run *per person*: `runs[id]` is which tab is going, and the maps
   * below are that run's failure and its two progress streams. They'd have to
   * be keyed anyway — a single `thinking` would be overwritten by whichever
   * profile streamed last, and switching to the other would show its thoughts.
   */
  const [runs, setRuns] = useState<Record<string, Tab>>({})
  const [errors, setErrors] = useState<Record<string, { tab: Tab; message: string }>>({})
  const [activity, setActivity] = useState<Record<string, string[]>>({})
  const [thinking, setThinking] = useState<Record<string, ThinkingSummary>>({})
  const [createError, setCreateError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMind, setShowMind] = useState(false)
  // Which coach turn's advice each `next` panel is showing. No entry means that
  // person's most recent one, so a new run doesn't have to reach back and clear
  // anything and a first visit lands on their latest rather than on nothing.
  //
  // Keyed for the same reason the maps above are: a next-move run finishing on
  // one person wrote this, and while you were reading an older suggestion of
  // someone else's, it jumped you to their newest. Their selection is theirs and
  // survives switching away now.
  const [viewingAdvice, setViewingAdvice] = useState<Record<string, string>>({})
  // The last profile amendment, shown once under the composer. Not persisted —
  // see `sendChat`. Keyed like the run maps above rather than cleared on every
  // switch path: a result about one profile means nothing under another, and a
  // key can't miss a route. One slot for all of them would also mean two people
  // amended at once and only the one that finished last got a reply.
  const [edits, setEdits] = useState<Record<string, { tab: ChatEngine } & ProfileEdit>>({})
  /**
   * The real mutex, and the abort handle each run is stopped by. `runs` drives
   * the UI but only lands on the next render, so two calls in one tick (a fast
   * double-click, Enter held down) would both read the slot as free and start.
   * A ref is set synchronously.
   */
  const runsRef = useRef(new Map<string, AbortController>())

  /**
   * Take this person's one run slot, or refuse. A second run on the same record
   * would race the first one's writes and have nowhere of its own to render.
   */
  const claim = useCallback((id: string, which: Tab): AbortController | null => {
    if (runsRef.current.has(id)) return null
    const controller = new AbortController()
    runsRef.current.set(id, controller)
    setRuns((prev) => ({ ...prev, [id]: which }))
    // This run's own slate: the last failure, and the last run's steps and
    // reasoning, all of which described something that is no longer happening.
    setErrors((prev) => omit(prev, id))
    setActivity((prev) => omit(prev, id))
    setThinking((prev) => omit(prev, id))
    return controller
  }, [])

  /** Give it back. The stream and any error stay — they're what's left to read. */
  const release = useCallback((id: string) => {
    runsRef.current.delete(id)
    setRuns((prev) => omit(prev, id))
  }, [])

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
      if (!active) return false
      const id = active.id
      const controller = claim(id, which)
      if (!controller) return false
      setTab(which)

      const record = active
      const onThinking = (t: ThinkingSummary) => setThinking((prev) => ({ ...prev, [id]: t }))

      try {
        if (which === 'them') {
          const ctx = await rebuildPersonContext(record, message, controller.signal, onThinking)
          await update(id, { themProfile: ctx })
        } else if (which === 'me') {
          const ctx = await rebuildSelfContext(record, message, controller.signal, onThinking)
          await update(id, { meProfile: ctx })
        } else {
          const suggestion = await suggestMove(
            record,
            message,
            controller.signal,
            (label) => setActivity((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), label] })),
            onThinking,
          )
          // Against `current`, not the snapshot this run started from: the user
          // can add turns or edit the research notes while the model is
          // thinking, and a snapshot-derived patch would undo them. The notes
          // need both — the snapshot to know which mode the prompt asked for and
          // which lines the model saw, `current` for what the user typed since.
          //
          // `evidence: false` because the advice is the coach's own line, not
          // something either person said — without it, asking "what do I say?"
          // would immediately mark both profiles as stale.
          await update(
            id,
            (current) => ({
              turns: [...current.turns, adviceTurn(suggestion)],
              researchNotes: applyResearchNotes(
                record.researchNotes,
                current.researchNotes,
                suggestion.research_notes,
              ),
            }),
            { evidence: false },
          )
          setViewingAdvice((prev) => ({ ...prev, [id]: suggestion.id }))
        }
        return true
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setErrors((prev) => ({ ...prev, [id]: { tab: which, message: (e as Error).message } }))
        }
        // An abort counts as sent: the user stopped it on purpose, and handing
        // their text back as if the app had failed is just noise.
        return (e as Error).name === 'AbortError'
      } finally {
        release(id)
      }
    },
    [active, claim, release, update],
  )

  /** Tear down one person's run. `run`'s catch swallows the AbortError. */
  const stop = useCallback((id: string) => runsRef.current.get(id)?.abort(), [])

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
      if (!active) return false
      const id = active.id
      // `claim` wipes this person's steps and reasoning as well. `Thinking`
      // renders whenever their busy tab is the visible one, so an amend on Them
      // inherited the last next-move's "Searching: …" lines and claimed to be
      // doing research it isn't.
      const controller = claim(id, engine)
      if (!controller) return false

      try {
        const { reply, headline, markdown, changed } = await chatAboutProfile(
          active,
          engine,
          message,
          controller.signal,
          (t) => setThinking((prev) => ({ ...prev, [id]: t })),
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
        setEdits((prev) => ({ ...prev, [id]: { tab: engine, reply, changed } }))
        return true
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setErrors((prev) => ({ ...prev, [id]: { tab: engine, message: (e as Error).message } }))
        }
        return (e as Error).name === 'AbortError'
      } finally {
        release(id)
      }
    },
    [active, claim, release, update],
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
        setErrors((prev) => ({
          ...prev,
          [id]: { tab, message: `Couldn't save that: ${(e as Error).message}` },
        }))
      })
    },
    [activeId],
  )

  /**
   * Accept an amendment the coach proposed while working out the next move.
   *
   * Local and instant: the model already wrote the amendment and it was
   * validated against this document when it did, so accepting is an apply, not
   * another call. The judgment is left exactly as its last rebuild produced it,
   * for the reason `sendChat` leaves it — one accepted fact is not grounds to
   * re-decide where things stand — and the headline with it, since a proposal
   * has no reply channel that could rewrite it honestly.
   *
   * `appliedAt` is written back into the stored advice turn in the same
   * transaction as the profile, so the offer and its outcome can't disagree
   * across a reload.
   */
  const applyProposal = useCallback(
    (adviceId: string) => {
      if (!active) return
      const id = active.id
      const advice = active.turns.find((t) => t.id === adviceId)?.advice
      const proposal = advice?.profile
      if (!advice || !proposal || proposal.appliedAt) return
      const now = Date.now()
      const key = proposal.target === 'them' ? 'themProfile' : 'meProfile'

      persist(
        // Against `current`, not the snapshot: this is a click, so the user has
        // had as long as they liked to change something else first.
        update(
          id,
          (current) => {
            const profile = current[key]
            // No profile on that side yet. `validateProposal` refuses to let the
            // model aim at one, so this is only reachable if it was cleared
            // between the run and the click — and inventing a profile here would
            // fabricate a judgment nothing produced, the same rule `sendChat`
            // follows.
            if (!profile) return {}
            return {
              [key]: {
                ...profile,
                markdown: applyProfileUpdate(profile.markdown, proposal.update),
                amendedAt: now,
                // The transcript the amendment was written from, which is the
                // suggestion's, not this moment's.
                amendedTurnsAt: advice.turnsAt,
              },
              turns: current.turns.map((t) =>
                t.id === adviceId && t.advice
                  ? { ...t, advice: { ...t.advice, profile: { ...proposal, appliedAt: now } } }
                  : t,
              ),
            }
          },
          // The amendment changes the profile, not what either person said, so
          // it is not new evidence and must not mark both profiles stale.
          { evidence: false },
        ),
        'next',
      )
    },
    [active, persist, update],
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

  // This person's run, and only theirs — someone else's is their own panel's
  // business now, and locks nothing here.
  const busyTab = activeId ? (runs[activeId] ?? null) : null
  const shownError = activeId ? (errors[activeId] ?? null) : null
  const shownEdit = activeId ? (edits[activeId] ?? null) : null

  // The advice history *is* the conversation now — no parallel list, no cap, no
  // pills. Reading it back out of `turns` keeps one source: delete the bubble
  // and the suggestion is gone with it, because they were never two things.
  const adviceTurns = active?.turns.filter((t) => t.speaker === 'coach' && t.advice) ?? []
  const viewing = activeId ? viewingAdvice[activeId] : undefined
  const shownAdvice =
    adviceTurns.find((t) => t.id === viewing) ?? adviceTurns[adviceTurns.length - 1]
  const suggestion = shownAdvice?.advice
  /**
   * Whether the document a proposal aims at has moved since the proposal was
   * written.
   *
   * One guard covering both clocks, because both invalidate it in the same way:
   * the quotes in an `edit` were checked against the profile as it stood during
   * the run, and a rebuild or a chat amendment since then means they were
   * checked against text that no longer exists. `applyProfileUpdate` would drop
   * whichever ops stopped fitting and silently apply the rest — a half-applied
   * amendment reported as "Applied", which is the one outcome worth spending a
   * disabled button to avoid. Rebuild is the honest answer at that point.
   */
  const proposalStale = (() => {
    const proposal = suggestion?.profile
    if (!active || !suggestion || !proposal || proposal.appliedAt) return false
    const profile = proposal.target === 'them' ? active.themProfile : active.meProfile
    if (!profile) return true
    return Math.max(profile.generatedAt, profile.amendedAt ?? 0) > suggestion.generatedAt
  })()
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
        disabled: !!busyTab,
      }
    : undefined
  // Them/You before their first rebuild. The footer box has no profile to amend
  // in that state, so it seeds one instead of sitting there disabled.
  const seeding = !!active && tab !== 'next' && !(tab === 'them' ? active.themProfile : active.meProfile)
  // Whether this tab has ever produced anything, which is what decides between
  // "build" and "rebuild" wherever the distinction is visible.
  const ranThisTab = tab === 'next' ? !!suggestion : !seeding

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />

      <DateRail
        dates={dates}
        activeId={activeId}
        running={new Set(Object.keys(runs))}
        // No reset: the selection is theirs, and switching to someone with none
        // already lands on their newest.
        onSelect={setActiveId}
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
                disabled={!!busyTab}
                title={busyTab ? 'Finishes rebuilding first' : undefined}
                className="text-[11.5px] text-fg-3 transition hover:text-action disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg-3"
              >
                {active.goal.trim() ? 'Edit profile' : 'What do you want from this? →'}
              </button>
            </div>

            <span className="flex-1" />

            {/* "Rebuild" only once there is something to rebuild. The two halves
                are built separately, so the pair also reads as which of them
                exists yet — Build them / Rebuild you says it at a glance. */}
            <Button variant="secondary" size="sm" disabled={!!busyTab} onClick={() => run('them')}>
              {busyTab === 'them' ? <Spinner /> : <Heart size={13} />}
              {active.themProfile ? 'Rebuild them' : 'Build them'}
            </Button>
            <Button variant="secondary" size="sm" disabled={!!busyTab} onClick={() => run('me')}>
              {busyTab === 'me' ? <Spinner /> : <UserRound size={13} />}
              {active.meProfile ? 'Rebuild you' : 'Build you'}
            </Button>
            <Button variant="accent" size="sm" disabled={!!busyTab} onClick={() => run('next')}>
              {busyTab === 'next' ? <Spinner /> : <Sparkles size={13} />}
              What do I say?
            </Button>
            <ExportButton onClick={() => setShowExport(true)} />
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
              setViewingAdvice((prev) => ({ ...prev, [active.id]: id }))
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
                    back-off is three 30s waits, and this person's every other
                    control is disabled while their run is in flight. Shown for
                    any tab of theirs, not just the open one, so switching tab
                    can't hide the control that ends the run being waited on.
                    Someone else's run is stopped from their own panel — it
                    stops nothing here, so offering to end it here would be
                    reaching across a boundary that now exists. The spinner
                    still only spins for the tab actually running. */}
                {busyTab ? (
                  <button
                    onClick={() => stop(active.id)}
                    className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold text-fg-3 transition hover:bg-no-soft hover:text-no-strong"
                    title={
                      busyTab === tab ? 'Stop this run' : `Stop the ${TAB_LABEL[busyTab]} run`
                    }
                  >
                    {busyTab === tab ? (
                      <>
                        <Spinner className="group-hover:hidden" />
                        <Square size={11} className="hidden fill-current group-hover:block" />
                      </>
                    ) : (
                      <Square size={11} className="fill-current" />
                    )}
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => run(tab)}
                    className="rounded-md p-1.5 text-fg-3 transition hover:bg-surface-muted hover:text-action disabled:opacity-40"
                    title={ranThisTab ? 'Run again' : 'Run'}
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
                      onClick={() => setErrors((prev) => omit(prev, active.id))}
                      className="-mr-1 -mt-1 flex-none self-start rounded p-1 text-fg-3 transition hover:text-fg"
                      aria-label="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : null}

                {busyTab === tab ? (
                  <Thinking
                    tab={tab}
                    name={active.name}
                    activity={activity[active.id] ?? []}
                    thinking={thinking[active.id] ?? null}
                  />
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
                              `Start over on ${active.name}?\n\nThis throws away everything written down about them so far. The next rebuild starts from a blank page and reads the conversation again — which is the point when the notes have drifted, and a waste when they haven't.\n\nAnything you sent straight into the box below was read once and never stored, so it isn't in the conversation to be read again.`,
                            )
                          ) {
                            persist(update(active.id, { themProfile: undefined }), 'them')
                            // The reply describes an amendment to a profile that
                            // no longer exists. Nothing renders it while seeding,
                            // so it wouldn't resurface until the next build —
                            // under a fresh read, describing the deleted one.
                            setEdits((prev) =>
                              prev[active.id]?.tab === 'them' ? omit(prev, active.id) : prev,
                            )
                          }
                        }}
                      />
                      <PersonContextView ctx={active.themProfile} name={active.name} answer={answerProps} />
                    </>
                  ) : (
                    <BlankSlate
                      title={`No read on ${active.name} yet`}
                      body={`Tell it what you know in the box below — a bio, a dating profile, whatever you've got. Add some of the conversation too: everything you get back cites the line it came from.`}
                      cta="Build them"
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
                              "Start over on you?\n\nThis throws away everything written down about you in this connection. The next rebuild starts from a blank page and reads the conversation again.\n\nAnything you sent straight into the box below — a CV, what you do — was read once and never stored, so it isn't in the conversation to be read again.",
                            )
                          ) {
                            persist(update(active.id, { meProfile: undefined }), 'me')
                            setEdits((prev) =>
                              prev[active.id]?.tab === 'me' ? omit(prev, active.id) : prev,
                            )
                          }
                        }}
                      />
                      <SelfContextView ctx={active.meProfile} answer={answerProps} />
                    </>
                  ) : (
                    <BlankSlate
                      title="No read on you yet"
                      body="This is the half you control — how you're landing, what's working, and what your messages say about what you actually want. Paste your CV in the box below if you want it to know the background."
                      cta="Build you"
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
                          setViewingAdvice((prev) => omit(prev, active.id))
                        }
                      }}
                    />
                    {/* No history pills. Earlier advice is in the conversation,
                        in the position it was given — click a COACH bubble to
                        read it there, next to what the user actually did. */}
                    <SuggestionView
                      suggestion={suggestion}
                      sent={sentDrafts}
                      proposalStale={proposalStale}
                      onApplyProposal={() => applyProposal(shownAdvice!.id)}
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
                  person, the tab *and* the mode so a half-typed instruction
                  about her can't reappear under him, under the drafts, or —
                  same slot, same component, so React keeps the draft — in the
                  seed box after Start over, where "drop the avoidant read"
                  would be handed over as background on who she is. */}
              {tab === 'next' ? (
                <AskComposer
                  key={`${active.id}:next`}
                  label="Anything specific right now?"
                  placeholder="e.g. she left me on read for 2 days — optional"
                  cta="What do I say?"
                  hint="Used for this answer only."
                  busy={!!busyTab}
                  onSend={(message) => run('next', message)}
                />
              ) : seeding ? (
                /* No profile yet, so there is nothing to amend and this used to
                   be disabled. It seeds the first rebuild instead — the one
                   place a new user can hand over a CV or a pasted bio without
                   it becoming a turn they later have to go and delete. Read
                   once, absorbed into the profile, never stored. */
                <AskComposer
                  key={`${active.id}:${tab}:seed`}
                  label={`Tell it about ${tab === 'them' ? active.name : 'you'}`}
                  placeholder={
                    tab === 'them'
                      ? `Paste ${active.name}'s bio or dating profile, or just say what you already know`
                      : 'Paste your CV, or just say what you do and what your life looks like'
                  }
                  cta="Build"
                  hint="Read once, not kept — what it learns goes in the profile."
                  busy={!!busyTab}
                  needsText
                  onSend={(message) => run(tab, message)}
                />
              ) : (
                <AskComposer
                  key={`${active.id}:${tab}:amend`}
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
                  busy={!!busyTab}
                  needsText
                  edit={shownEdit && shownEdit.tab === tab ? shownEdit : null}
                  onDismiss={() => setEdits((prev) => omit(prev, active.id))}
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
          onDelete={() => {
            // Their run outlives the record otherwise: nothing renders it, no
            // panel can reach it, and it comes back at the end to write a
            // profile onto a person who isn't there.
            stop(active.id)
            persist(remove(active.id), tab)
          }}
        />
      ) : null}

      {/* Unkeyed, unlike ProfileModal: it holds no draft, so a rail switch
          underneath it just re-derives the document for whoever is selected —
          which is what it should show. */}
      {active ? (
        <ExportModal open={showExport} record={active} onClose={() => setShowExport(false)} />
      ) : null}

      <MindModal open={showMind} onClose={() => setShowMind(false)} />

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={() => setErrors({})}
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
      {thought ? <ThinkingStream text={thought} /> : null}
    </div>
  )
}

/**
 * The reasoning summary, all of it.
 *
 * This was clamped to four lines, which kept a streaming think from pushing the
 * page around at the cost of hiding almost every long one — and a long one is
 * the only kind worth reading. Its own scroll box keeps the layout still
 * without throwing the rest away.
 */
function ThinkingStream({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null)
  // Follow the stream only while the reader is already at the bottom. Otherwise
  // scrolling back a paragraph gets yanked forward on the next delta, which
  // would make this exactly as unreadable as the clamp was.
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      className="scroll-slim max-h-[40vh] w-full max-w-[380px] overflow-y-auto rounded-md border border-border/60 bg-surface-sunken px-3 py-2"
    >
      <p className="whitespace-pre-line text-left text-[11px] italic leading-relaxed text-fg-3/80">
        {text}
      </p>
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
