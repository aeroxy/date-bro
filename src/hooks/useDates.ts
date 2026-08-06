import { useCallback, useEffect, useRef, useState } from 'react'

import { deleteDate, listDates, saveDate } from '@/lib/db'
import { newDate, type DateRecord } from '@/types/date'

const LAST_KEY = 'dateBroLastOpened'

/**
 * All dates live in memory once loaded — the whole dataset is a few hundred KB
 * of text at most — and every mutation writes straight through to IndexedDB.
 * No optimistic-update machinery, because there's no server to disagree with.
 *
 * `create` and `remove` write first, then commit. `update` commits first and
 * writes after, and has to: the mirror it commits to is what a second mutation
 * in the same tick merges from, so deferring the commit behind the await drops
 * the first one's fields. The cost is that a rejected `saveDate` leaves memory
 * ahead of the store; it isn't rolled back, because a rollback would also undo
 * whatever landed during the await. Callers surface the failure instead — see
 * `persist` in App.tsx.
 */
export function useDates() {
  const [dates, setDates] = useState<DateRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  /**
   * Mirror of `dates` for the mutation helpers — reading state inside a
   * `setState` updater and assigning out of it isn't safe under StrictMode's
   * double-invocation, and every mutation needs the current record to merge.
   *
   * The mirror is the authority the helpers read, and each of them assigns the
   * list it computed **before** calling `setDates`. Two things follow. Writing a
   * ref during render is the unsafe thing this mirror exists to avoid — React may
   * render and throw the result away, so the sync belongs in an effect. And
   * because state lands a render later, syncing *only* in the effect would leave
   * two mutations in one tick both merging into the pre-first-mutation record,
   * silently dropping the first one's fields.
   */
  const datesRef = useRef<DateRecord[]>([])
  useEffect(() => {
    datesRef.current = dates
  }, [dates])

  /** Single writer: keeps the mirror and the state in step. */
  const commit = useCallback((list: DateRecord[]) => {
    datesRef.current = list
    setDates(list)
  }, [])

  // `loaded` is set in `finally` on purpose: a failed open (blocked IndexedDB,
  // a corrupt store) would otherwise leave the app on its loading spinner
  // forever with nothing on screen to explain why.
  useEffect(() => {
    ;(async () => {
      try {
        const all = await listDates()
        commit(all)
        const last = (await chrome.storage.local.get(LAST_KEY))[LAST_KEY] as string | undefined
        setActiveId(all.find((d) => d.id === last)?.id ?? all[0]?.id ?? null)
      } catch (e) {
        setLoadError((e as Error).message)
      } finally {
        setLoaded(true)
      }
    })()
  }, [commit])

  useEffect(() => {
    if (activeId) chrome.storage.local.set({ [LAST_KEY]: activeId })
  }, [activeId])

  const active = dates.find((d) => d.id === activeId) ?? null

  /**
   * `patch` may be a function of the record as it stands right now. Use that
   * form whenever the new value is derived from the old one and time has passed
   * since you last read it — a model call takes half a minute, and a plain
   * object patch built from a snapshot silently overwrites anything written in
   * the meantime.
   *
   * Returns the record as written, so a caller that needs to keep working with
   * it doesn't have to reconstruct the merge itself.
   *
   * Also maintains the rail's order. `listDates()` reads through the
   * `by-updated` index newest-first and `create()` prepends, so newest-updated-
   * first is the invariant — but this was replacing in place, so a record touched
   * mid-session kept its old slot and showed "just now" from below people last
   * touched days ago, then jumped on reload.
   */
  const update = useCallback(
    async (
      id: string,
      patch: Partial<DateRecord> | ((current: DateRecord) => Partial<DateRecord>),
    ): Promise<DateRecord | null> => {
      const current = datesRef.current.find((d) => d.id === id)
      if (!current) return null
      const resolved = typeof patch === 'function' ? patch(current) : patch
      const now = Date.now()
      const next: DateRecord = {
        ...current,
        ...resolved,
        updatedAt: now,
        // Only a write that touches the transcript moves the staleness clock.
        ...(resolved.turns ? { turnsUpdatedAt: now } : {}),
      }
      // Front, not a re-sort: `next.updatedAt` is `now`, so it is by definition
      // the newest. Sorting would paper over a broken invariant instead of
      // keeping it.
      commit([next, ...datesRef.current.filter((d) => d.id !== id)])
      await saveDate(next)
      return next
    },
    [commit],
  )

  const create = useCallback(
    async (name: string) => {
      const record = newDate(name.trim() || 'Untitled')
      await saveDate(record)
      commit([record, ...datesRef.current])
      setActiveId(record.id)
      return record
    },
    [commit],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteDate(id)
      // Computed off the mirror rather than inside the updater — see above;
      // a setState updater has to stay pure.
      const next = datesRef.current.filter((d) => d.id !== id)
      if (id === activeId) setActiveId(next[0]?.id ?? null)
      commit(next)
    },
    [activeId, commit],
  )

  return { dates, active, activeId, setActiveId, loaded, loadError, create, update, remove }
}
