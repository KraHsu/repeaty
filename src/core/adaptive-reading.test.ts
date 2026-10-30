import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { fixture, now } from './test-fixtures'
import { addSource, prepareSource } from './sources'
import { adaptiveReadingPlan, nextAdaptiveReading } from './adaptive-reading'
import { arrangeSource } from './source-queue'
import { sourceArrangement, readingUndoFor, undoReading } from './reading-operations'
import { sourceSchema } from './source-data'
import { reviewCard } from './scheduler'
import { createRepository } from './storage'
import { exportBackup, parseBackup } from './backups'
import { exportArchive, parseArchive } from './archive'
import { migrateLibrary } from './model'

function setup() {
  const prepared = prepareSource(
    { title: 'Adaptive', url: '', format: 'plain', content: '中文🙂 reading material' },
    now,
  )
  return { ...prepared, library: addSource(fixture(), prepared.source, prepared.asset) }
}
it('uses comprehension and elapsed calendar days, with bounded early and overdue intervals', () => {
  const { source } = setup()
  expect(nextAdaptiveReading(source, 'again', now).intervalDays).toBe(1)
  expect(nextAdaptiveReading(source, 'good', now).intervalDays).toBe(2)
  expect(nextAdaptiveReading(source, 'easy', now).intervalDays).toBe(3)
  const read = { ...source, adaptiveReading: nextAdaptiveReading(source, 'good', now) }
  expect(nextAdaptiveReading(read, 'good', now).intervalDays).toBe(2)
  expect(nextAdaptiveReading(read, 'good', new Date('2026-10-19T18:00:00Z')).intervalDays).toBe(4)
  expect(nextAdaptiveReading(read, 'good', new Date('2027-10-19T18:00:00Z')).intervalDays).toBe(8)
  const mature = {
    ...source,
    adaptiveReading: { ...read.adaptiveReading, intervalDays: 365, factor: 3 },
  }
  expect(nextAdaptiveReading(mature, 'easy', new Date('2030-01-01T18:00:00Z')).intervalDays).toBe(
    365,
  )
  const low = {
    ...source,
    adaptiveReading: { ...read.adaptiveReading, intervalDays: 1, factor: 1.3 },
  }
  expect(nextAdaptiveReading(low, 'again', now)).toMatchObject({ intervalDays: 1, factor: 1.3 })
  const early = {
    ...source,
    adaptiveReading: { ...read.adaptiveReading, intervalDays: 7, factor: 2.8 },
  }
  expect(nextAdaptiveReading(early, 'easy', now).intervalDays).toBeLessThanOrEqual(7)
  const boundary = adaptiveReadingPlan(source, 'easy', new Date('2026-12-31T12:00:00'))
  expect(boundary.date).toBe('2027-01-03')
})

it('commits a confirmed plan once, preserves card progress and rejects stale or forged plans', () => {
  const { source, library } = setup()
  const action = {
    type: 'read-adaptive' as const,
    feedback: 'good' as const,
    ...adaptiveReadingPlan(source, 'good', now),
  }
  const result = arrangeSource(library, source.id, source.mediaId, action, now)
  expect(library.sources[0]).not.toHaveProperty('adaptiveReading')
  expect(result.sources[0]!.adaptiveReading).toMatchObject({
    intervalDays: 2,
    readCount: 1,
    feedback: 'good',
  })
  expect(result.cards).toBe(library.cards)
  expect(result.reviews).toBe(library.reviews)
  for (const invalid of [
    action,
    { ...action, expectedReadCount: 1, intervalDays: 365 },
    { ...action, expectedReadCount: 1, date: '2099-01-01' },
  ])
    expect(() => arrangeSource(result, source.id, source.mediaId, invalid, now)).toThrow('重新确认')
  const archived = arrangeSource(library, source.id, source.mediaId, { type: 'archive' }, now)
  expect(() => arrangeSource(archived, source.id, source.mediaId, action, now)).toThrow('重新确认')
})

it('undo restores adaptive state while preserving a later card rating; custom dates and resets are independent', () => {
  const { source, library } = setup()
  const next = arrangeSource(
    library,
    source.id,
    source.mediaId,
    { type: 'read-adaptive', feedback: 'easy', ...adaptiveReadingPlan(source, 'easy', now) },
    now,
  )
  const undo = readingUndoFor(library, next, 'local:test')!
  const rated = reviewCard(next, next.cards[0]!.id, 3, now)
  const restored = undoReading(rated, undo)
  expect(sourceArrangement(restored.sources[0]!)).toEqual(sourceArrangement(source))
  expect(restored.cards).toBe(rated.cards)
  expect(restored.reviews).toBe(rated.reviews)
  const custom = arrangeSource(
    next,
    source.id,
    source.mediaId,
    { type: 'defer', date: '2028-01-01' },
    now,
  )
  expect(custom.sources[0]!.adaptiveReading).toEqual(next.sources[0]!.adaptiveReading)
  const reset = arrangeSource(custom, source.id, source.mediaId, { type: 'reset-interval' }, now)
  expect(reset.sources[0]!.adaptiveReading).toBeUndefined()
  expect(reset.sources[0]!.queue).toEqual(custom.sources[0]!.queue)
})

it('preserves adaptive state through both backups, storage and checkpoints, and upgrades v12 without inventing feedback', async () => {
  const { source, library, asset } = setup()
  expect(migrateLibrary({ ...library, version: 12 })).toEqual(library)
  const next = arrangeSource(
    library,
    source.id,
    source.mediaId,
    { type: 'read-adaptive', feedback: 'good', ...adaptiveReadingPlan(source, 'good', now) },
    now,
  )
  const json = parseBackup(await exportBackup(next, async () => asset.blob))
  const archive = await parseArchive((await exportArchive(next, async () => asset.blob))!)
  for (const restored of [json, archive]) expect(restored.library).toEqual(next)
  const repository = createRepository(`adaptive-${crypto.randomUUID()}`)
  try {
    await repository.save(library, 0, { assets: [asset] })
    await repository.save(next, 1, { reason: '更改阅读安排前' })
    expect((await repository.load()).library).toEqual(next)
    const checkpoint = (await repository.listBackups()).find(
      (row) => row.reason === '更改阅读安排前',
    )!
    expect(await repository.getBackup(checkpoint.id)).toEqual(library)
  } finally {
    await repository.close()
  }
})

it('rejects invalid adaptive feedback, counters, dates and unbounded factors', () => {
  const { source } = setup()
  const state = nextAdaptiveReading(source, 'good', now)
  for (const patch of [
    { intervalDays: 0 },
    { intervalDays: 36501 },
    { factor: 10.1 },
    { factor: 0.9 },
    { readCount: 0 },
    { readCount: 1.5 },
    { feedback: 'accepted' },
    { lastReadOn: 'invalid' },
  ])
    expect(
      sourceSchema.safeParse({ ...source, adaptiveReading: { ...state, ...patch } }).success,
    ).toBe(false)
})

it('does not introduce undefined adaptive fields when arranging an unread legacy source', () => {
  const { source, library } = setup()
  const deferred = arrangeSource(
    library,
    source.id,
    source.mediaId,
    { type: 'defer', date: '2027-01-01' },
    now,
  )
  expect(Object.hasOwn(deferred.sources[0]!, 'adaptiveReading')).toBe(false)
  expect(Object.hasOwn(deferred.sources[0]!, 'readingIntervalDays')).toBe(false)
})
