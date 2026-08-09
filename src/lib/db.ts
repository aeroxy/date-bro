import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import {
  personJudgment,
  personToMarkdown,
  renameLegacySections,
  selfJudgment,
  selfToMarkdown,
} from '@/coach/profile'
import { adviceTurn } from '@/lib/transcript'
import type { PersonContext, SelfContext } from '@/types/coach'
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
/**
 * `seedThem` / `seedMe` used to be permanent prompt inputs — a blob the user was
 * expected to keep current, re-read on every rebuild, sitting above the
 * transcript as if it outranked what was actually said. They're gone: what the
 * user knows lives in `turns` as `context` entries now, one pool with one
 * chronology and one numbering. Records written before that come back carrying
 * the old fields, so their text moves into the pool as notes ahead of turn one,
 * where the rebuild engines read it as what it always was — something the user
 * wrote down, not a second source of truth.
 *
 * Ids are derived from the record id rather than minted fresh. This runs on
 * every read, and a new uuid each time would churn React keys and re-add the
 * same note after the first save; the presence check makes it idempotent even
 * if a record somehow gets written back still carrying the old fields.
 */
function migrateSeed(record: DateRecord): DateRecord {
  const legacy = record as DateRecord & { seedThem?: string; seedMe?: string }
  if (legacy.seedThem === undefined && legacy.seedMe === undefined) return record
  const { seedThem, seedMe, ...rest } = legacy
  const carried = (
    [
      ['seed-them', seedThem],
      ['seed-me', seedMe],
    ] as const
  ).flatMap(([suffix, text]) => {
    const trimmed = text?.trim()
    const id = `${record.id}:${suffix}`
    if (!trimmed || record.turns.some((t) => t.id === id)) return []
    return [{ id, speaker: 'context' as const, text: trimmed }]
  })
  return { ...rest, turns: [...carried, ...record.turns] }
}

/**
 * `themContext` / `meContext` were fixed schemas, thrown away and regenerated
 * from zero on every rebuild. They're markdown profiles now, amended by section
 * — see `coach/profile.ts`. Every field of the old shapes has a home in the new
 * one (the section headings were derived from them), so nothing is lost in the
 * move, and the structured half that prose can't carry — the interest read, the
 * flags, the open questions — survives intact as the judgment.
 *
 * Pure and total, like `migrateSeed`: this runs on every read, and a record that
 * is read a hundred times before it is next saved renders the same bytes each
 * time. Once saved, the old fields are gone and this stops firing.
 */
function migrateContexts(record: DateRecord): DateRecord {
  const legacy = record as DateRecord & { themContext?: PersonContext; meContext?: SelfContext }
  if (!legacy.themContext && !legacy.meContext) return record
  const { themContext, meContext, ...rest } = legacy

  return {
    ...rest,
    themProfile:
      record.themProfile ??
      (themContext
        ? {
            generatedAt: themContext.generatedAt,
            turnsAt: themContext.turnsAt,
            markdown: personToMarkdown(themContext),
            judgment: personJudgment(themContext),
          }
        : undefined),
    meProfile:
      record.meProfile ??
      (meContext
        ? {
            generatedAt: meContext.generatedAt,
            turnsAt: meContext.turnsAt,
            markdown: selfToMarkdown(meContext),
            judgment: selfJudgment(meContext),
          }
        : undefined),
  }
}

/**
 * Heading renames applied to markdown already written under the old name.
 *
 * Without this a rename isn't one: `applyProfileUpdate` matches by heading, so
 * an amendment aimed at the new name would create a second section and leave the
 * old one holding half the content.
 */
function migrateSectionNames(record: DateRecord): DateRecord {
  const rename = <P extends { markdown: string }>(profile: P | undefined): P | undefined => {
    if (!profile) return profile
    const markdown = renameLegacySections(profile.markdown)
    return markdown === profile.markdown ? profile : { ...profile, markdown }
  }
  return { ...record, themProfile: rename(record.themProfile), meProfile: rename(record.meProfile) }
}

/**
 * The most recent stored suggestion becomes the `coach` turn it would be today.
 *
 * Only the newest one. The rest stay in the retired `suggestions` array, unread
 * — they can't be placed. A suggestion records `turnsAt` as a wall clock, not
 * as a position, so there is no way to work out where in the transcript it was
 * given, and inventing an order for twenty of them would put fabricated
 * chronology into the one list this app treats as fact. The newest is the
 * exception worth making: it was generated from the transcript as it then
 * stood, so the end is where it goes, and it means the panel still has
 * something in it after the upgrade.
 *
 * Idempotent by taking the suggestion's own id for the turn — once the next
 * save persists it, the `some` check sees it and this stops firing.
 */
function migrateSuggestions(record: DateRecord): DateRecord {
  const latest = record.suggestions?.[0]
  // `options` is what `adviceTurn` reads; a record predating the field, or one
  // stored by a version that let a malformed response through, must not take
  // down every read in the app.
  if (!latest?.id || !Array.isArray(latest.options)) return record
  if (record.turns.some((t) => t.id === latest.id)) return record
  return { ...record, turns: [...record.turns, adviceTurn(latest)] }
}

// Every default below reads from `migrated`, never from `record`. Reading the
// original would quietly undo whatever a migration just did — a default built
// from the untouched record restores exactly what a migration was there to
// move, leaving the same content in two places forever.
function normalize(record: DateRecord): DateRecord {
  const migrated = migrateSuggestions(
    migrateSectionNames(migrateContexts(migrateSeed(record))),
  )
  return {
    ...migrated,
    researchNotes: migrated.researchNotes ?? '',
    // 0, not `updatedAt`: a record written before turn tracking existed has no
    // honest answer here, and 0 is the one that can't produce a false "the
    // conversation has moved on" — it just waits for the next real turn edit.
    turnsUpdatedAt: migrated.turnsUpdatedAt ?? 0,
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
