import { useCallback, useEffect, useRef, useState } from 'react'

import { deleteDate, listDates, saveDate } from '@/lib/db'
import { newDate, type DateRecord } from '@/types/date'

const LAST_KEY = 'dateBroLastOpened'

/**
 * All dates live in memory once loaded — the whole dataset is a few hundred KB
 * of text at most — and every mutation writes straight through to IndexedDB.
 * No optimistic-update machinery, because there's no server to disagree with.
 */
export function useDates() {
  const [dates, setDates] = useState<DateRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Mirror of `dates` for the mutation helpers — reading state inside a
  // setState updater and assigning out of it isn't safe under StrictMode's
  // double-invocation, and every mutation needs the current record to merge.
  const datesRef = useRef<DateRecord[]>([])
  datesRef.current = dates

  useEffect(() => {
    ;(async () => {
      const all = await listDates()
      setDates(all)
      const last = (await chrome.storage.local.get(LAST_KEY))[LAST_KEY] as string | undefined
      setActiveId(all.find((d) => d.id === last)?.id ?? all[0]?.id ?? null)
      setLoaded(true)
    })()
  }, [])

  useEffect(() => {
    if (activeId) chrome.storage.local.set({ [LAST_KEY]: activeId })
  }, [activeId])

  const active = dates.find((d) => d.id === activeId) ?? null

  const update = useCallback(async (id: string, patch: Partial<DateRecord>) => {
    const current = datesRef.current.find((d) => d.id === id)
    if (!current) return
    const next: DateRecord = { ...current, ...patch, updatedAt: Date.now() }
    setDates((prev) => prev.map((d) => (d.id === id ? next : d)))
    await saveDate(next)
  }, [])

  const create = useCallback(async (name: string) => {
    const record = newDate(name.trim() || 'Untitled')
    await saveDate(record)
    setDates((prev) => [record, ...prev])
    setActiveId(record.id)
    return record
  }, [])

  const remove = useCallback(
    async (id: string) => {
      await deleteDate(id)
      setDates((prev) => {
        const next = prev.filter((d) => d.id !== id)
        if (id === activeId) setActiveId(next[0]?.id ?? null)
        return next
      })
    },
    [activeId],
  )

  return { dates, active, activeId, setActiveId, loaded, create, update, remove }
}
