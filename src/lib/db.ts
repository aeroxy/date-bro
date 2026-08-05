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

export async function getDate(id: string): Promise<DateRecord | undefined> {
  const record = await (await db()).get('dates', id)
  return record ? normalize(record) : undefined
}

export async function saveDate(record: DateRecord): Promise<void> {
  await (await db()).put('dates', { ...record, updatedAt: Date.now() })
}

export async function deleteDate(id: string): Promise<void> {
  await (await db()).delete('dates', id)
}
