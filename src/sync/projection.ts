import { emptyLibrary, recordSchemas, workspaceLibrarySchema, type Library } from '../core/model'
import { attemptSchema, attemptSummarySchema } from '../core/practice-data'
import { z } from 'zod'
import { retiredNoteSchema, type RetiredNote } from '../desktop/retirement'
import { referencedSource } from '../core/source-data'
import { materialLocatorMatches } from '../core/material-data'
import {
  canonicalSyncValue,
  retiredStores,
  syncFailure,
  syncStore,
  type SyncSnapshot,
  type SyncRow,
} from './protocol'

export function emptySyncSnapshot(): SyncSnapshot {
  return { records: {}, values: {}, retired: {} }
}

export function snapshotFromLibrary(library: Library): SyncSnapshot {
  const snapshot = emptySyncSnapshot()
  for (const store of Object.keys(recordSchemas) as (keyof typeof recordSchemas)[]) {
    const rows: Record<string, SyncRow> = Object.create(null)
    for (const [position, value] of library[store].entries())
      rows[value.id] = { position, value: JSON.parse(JSON.stringify(value)) }
    snapshot.records[store] = rows
  }
  return snapshot
}

export function syncRows(snapshot: SyncSnapshot, encodedStore: string): Record<string, SyncRow> {
  const { section, store } = syncStore(encodedStore)
  return Object.hasOwn(snapshot[section], store) ? snapshot[section][store]! : {}
}

export function syncRow(snapshot: SyncSnapshot, store: string, id: string): SyncRow | undefined {
  const rows = syncRows(snapshot, store)
  return Object.hasOwn(rows, id) ? rows[id] : undefined
}

export function orderedSyncRows(rows: Record<string, SyncRow>): SyncRow[] {
  return Object.entries(rows)
    .sort(([idA, a], [idB, b]) => a.position - b.position || (idA < idB ? -1 : idA > idB ? 1 : 0))
    .map(([, row]) => row)
}

export function libraryFromSnapshot(snapshot: SyncSnapshot): Library {
  const library: Record<string, unknown> = { ...emptyLibrary() }
  for (const store of Object.keys(recordSchemas))
    library[store] = orderedSyncRows(snapshot.records[store] ?? {}).map((row) => row.value)
  return workspaceLibrarySchema.parse(library)
}

const rowSchema = z.strictObject({
  position: z.number().int().min(0).max(1_600_000),
  value: z.unknown(),
})
const documentSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('note').optional(),
  path: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  raw: z.string().optional(),
})
const attemptRecordSchema = z.union([attemptSchema, attemptSummarySchema])

/** Checks the active projection and references into retained history, without reading any files. */
export function validateSyncSnapshot(snapshot: SyncSnapshot): void {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Object.keys(snapshot).some((key) => !['records', 'values', 'retired'].includes(key))
  )
    return syncFailure('sync-invalid-snapshot')
  canonicalSyncValue(snapshot)
  for (const section of ['records', 'values', 'retired'] as const) {
    const stores = snapshot[section]
    if (!stores || Array.isArray(stores) || typeof stores !== 'object')
      return syncFailure('sync-invalid-snapshot')
    for (const [store, rows] of Object.entries(stores)) {
      syncStore(section === 'records' ? store : `${section}:${store}`)
      if (!rows || Array.isArray(rows) || typeof rows !== 'object')
        return syncFailure('sync-invalid-snapshot')
      for (const [id, raw] of Object.entries(rows)) {
        if (section === 'values' && store === 'settings' && !id.startsWith('plugin:'))
          return syncFailure('sync-nonportable-value')
        const row = rowSchema.safeParse(raw)
        if (!id || id.length > 512 || !row.success || raw.value === null || raw.value === undefined)
          return syncFailure('sync-invalid-snapshot')
        if (section === 'values') continue
        const schema =
          store === 'documents'
            ? documentSchema
            : store === 'attempts'
              ? attemptRecordSchema
              : recordSchemas[store as keyof typeof recordSchemas]
        const value = schema?.safeParse(raw.value)
        if (!value?.success || (value.data as { id: string }).id !== id)
          return syncFailure('sync-invalid-record')
      }
    }
  }
  try {
    libraryFromSnapshot(snapshot)
  } catch {
    return syncFailure('sync-invalid-references')
  }
  const exists = (store: string, id: unknown) =>
    typeof id === 'string' &&
    Boolean(syncRow(snapshot, store, id) || syncRow(snapshot, `retired:${store}`, id))
  const retiredExists = (store: string, id: unknown) =>
    typeof id === 'string' && Boolean(syncRow(snapshot, `retired:${store}`, id))
  const variants = new Set(
    Object.values(snapshot.records.cards ?? {}).map(({ value }) => {
      const card = value as Library['cards'][number]
      return JSON.stringify([card.noteId, card.variant])
    }),
  )
  for (const store of retiredStores) {
    for (const { value } of Object.values(snapshot.retired[store] ?? {})) {
      const row = value as Record<string, unknown>
      if (
        (store === 'cards' && !exists('notes', row.noteId)) ||
        (['reviews', 'practices'].includes(store) && !retiredExists('cards', row.cardId)) ||
        (store === 'attempts' && !retiredExists('practices', row.practiceId)) ||
        (store === 'documents' && !exists('notes', row.id))
      )
        return syncFailure('sync-invalid-retired-references')
      if (
        ['cards', 'reviews', 'practices', 'attempts'].includes(store) &&
        syncRow(snapshot, store, String(row.id))
      )
        return syncFailure('sync-duplicate-retired-record')
      if (store === 'cards') {
        const variant = JSON.stringify([row.noteId, row.variant])
        if (variants.has(variant)) return syncFailure('sync-duplicate-retired-variant')
        variants.add(variant)
      }
      if (store === 'reviews' && row.practiceId) {
        const practice = syncRow(snapshot, 'retired:practices', String(row.practiceId))?.value as
          Library['practices'][number] | undefined
        if (!practice || practice.cardId !== row.cardId)
          return syncFailure('sync-invalid-retired-references')
      }
      if (store === 'practices' && row.reviewId) {
        const review = syncRow(snapshot, 'retired:reviews', String(row.reviewId))?.value as
          Library['reviews'][number] | undefined
        if (
          !review ||
          review.practiceId !== row.id ||
          review.cardId !== row.cardId ||
          review.rating !== row.rating
        )
          return syncFailure('sync-invalid-retired-references')
      }
      if (store === 'notes') {
        const note = value as Library['notes'][number]
        for (const mediaId of [
          ...note.frontMedia,
          ...note.backMedia,
          ...(note.inlineMedia ?? []).map((ref) => ref.mediaId),
        ])
          if (!exists('media', mediaId)) return syncFailure('sync-invalid-retired-references')
        if (note.excerpt) {
          const source = syncRow(snapshot, 'sources', note.excerpt.sourceId)?.value as
            Library['sources'][number] | undefined
          const version = source && referencedSource(source, note.excerpt)
          if (
            !version ||
            note.excerpt.end > version.characters ||
            (note.excerpt.locator && !materialLocatorMatches(version, note.excerpt.locator)) ||
            Object.values(note.plugin?.variantLocators ?? {}).some(
              (locator) => !materialLocatorMatches(version, locator),
            )
          )
            return syncFailure('sync-invalid-retired-references')
        }
      }
    }
  }
}

/** Positions are a local dense projection; simultaneous appends use stable record IDs. */
export function normalizeSyncPositions(snapshot: SyncSnapshot): void {
  // Native values and retirement tables have no dense ordering contract.
  // Renumbering their zero positions would emit another event after every reload.
  const stores = snapshot.records
  for (const [store, rows] of Object.entries(stores)) {
    const ordered = Object.entries(rows).sort(
      ([idA, a], [idB, b]) => a.position - b.position || (idA < idB ? -1 : idA > idB ? 1 : 0),
    )
    stores[store] = Object.fromEntries(
      ordered.map(([id, row], position) => [id, { ...row, position }]),
    )
  }
}

export function cloneSyncSnapshot(snapshot: SyncSnapshot): SyncSnapshot {
  return JSON.parse(canonicalSyncValue(snapshot)) as SyncSnapshot
}

/** Portable retirement groups keep full code; document objects are fetched explicitly. */
export function snapshotToRetired(
  snapshot: SyncSnapshot,
  documentBodies: Record<string, string> = {},
): RetiredNote[] {
  validateSyncSnapshot(snapshot)
  const rows = (store: string) =>
    orderedSyncRows(snapshot.retired[store] ?? {}).map(
      ({ value }) => value as Record<string, unknown>,
    )
  const cards = rows('cards'),
    reviews = rows('reviews'),
    practices = rows('practices'),
    attempts = rows('attempts')
  const noteIds = new Set([
    ...rows('notes').map((note) => String(note.id)),
    ...cards.map((card) => String(card.noteId)),
  ])
  const assignedMedia = new Set<string>()
  const result = [...noteIds].sort().map((id) => {
    const note =
      syncRow(snapshot, 'retired:notes', id)?.value ?? syncRow(snapshot, 'notes', id)?.value ?? null
    const owned = cards.filter((card) => card.noteId === id)
    const cardIds = new Set(owned.map((card) => card.id))
    const ownedPractices = practices.filter((practice) => cardIds.has(practice.cardId))
    const practiceIds = new Set(ownedPractices.map((practice) => practice.id))
    const ownedAttempts = attempts.filter((attempt) => practiceIds.has(attempt.practiceId))
    // A compact active index is not a portable history body.
    if (ownedAttempts.some((attempt) => !attemptSchema.safeParse(attempt).success))
      return syncFailure('sync-retired-attempt-body-required')
    const document = syncRow(snapshot, 'retired:documents', id)?.value as
      { id: string; path: string; hash: string; raw?: string } | undefined
    const raw = document && (document.raw ?? documentBodies[document.hash])
    if (document && raw === undefined) return syncFailure('sync-retired-document-body-required')
    const mediaIds = new Set<string>()
    if (note) {
      const value = note as Library['notes'][number]
      for (const mediaId of [...value.frontMedia, ...value.backMedia]) mediaIds.add(mediaId)
      for (const reference of value.inlineMedia ?? []) mediaIds.add(reference.mediaId)
    }
    const media = [...mediaIds]
      .sort()
      .map(
        (mediaId) =>
          syncRow(snapshot, 'retired:media', mediaId)?.value ??
          syncRow(snapshot, 'media', mediaId)?.value ??
          syncFailure('sync-invalid-retired-references'),
      )
    for (const mediaId of mediaIds) assignedMedia.add(mediaId)
    return retiredNoteSchema.parse({
      revision: 0,
      note,
      document: document ? { ...document, kind: 'note', raw } : null,
      cards: owned,
      reviews: reviews.filter((review) => cardIds.has(review.cardId)),
      practices: ownedPractices,
      attempts: ownedAttempts,
      media,
    })
  })
  if (result.length)
    for (const media of rows('media'))
      if (!assignedMedia.has(String(media.id)))
        result[0]!.media.push(media as Library['media'][number])
  if (rows('documents').some((document) => !noteIds.has(String(document.id))))
    return syncFailure('sync-unassigned-retired-document')
  return result
}
