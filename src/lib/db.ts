import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { DateRecord } from '@/types/date'

interface DateBroDB extends DBSchema {
  dates: {
    key: string
    value: DateRecord
    indexes: { 'by-updated': number }
  }
}

let dbPromise: Promise<IDBPDatabase<DateBroDB>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<DateBroDB>('date-bro', 1, {
      upgrade(database) {
        const store = database.createObjectStore('dates', { keyPath: 'id' })
        store.createIndex('by-updated', 'updatedAt')
      },
    })
    // A cached rejection would be permanent: the usual reason an open fails is
    // another tab of this extension blocking an upgrade, which clears on its
    // own. Drop the failed promise so the next call actually retries.
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

// Records saved before a field existed come back from IndexedDB missing it
// entirely (undefined, not '') — there's no migration step, so normalize on
// every read instead. Keeps every consumer free to assume the shape is
// complete rather than re-guarding `?? ''` at each call site.
function normalize(record: DateRecord): DateRecord {
  return {
    ...record,
    researchNotes: record.researchNotes ?? '',
    // 0, not `updatedAt`: a record written before turn tracking existed has no
    // honest answer here, and 0 is the one that can't produce a false "the
    // conversation has moved on" — it just waits for the next real turn edit.
    turnsUpdatedAt: record.turnsUpdatedAt ?? 0,
    suggestions: record.suggestions ?? [],
    feedback: {
      them: record.feedback?.them ?? [],
      me: record.feedback?.me ?? [],
      next: record.feedback?.next ?? [],
    },
  }
}

export async function listDates(): Promise<DateRecord[]> {
  const all = await (await db()).getAllFromIndex('dates', 'by-updated')
  return all.reverse().map(normalize)
}

// Stores `updatedAt` as given rather than re-stamping it. Both callers already
// set it, and the second stamp landed a millisecond or two later than the value
// the in-memory list was ordered on — so the order the rail showed and the order
// `listDates()` would return were computed from different numbers.
export async function saveDate(record: DateRecord): Promise<void> {
  await (await db()).put('dates', record)
}

export async function deleteDate(id: string): Promise<void> {
  await (await db()).delete('dates', id)
}
