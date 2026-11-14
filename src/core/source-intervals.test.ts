import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, it, vi } from 'vitest'
import { fixture, now } from './test-fixtures'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  removeSource,
  saveReadingPosition,
  sourceExcerpt,
} from './sources'
import { arrangeSource, nextReadingInterval } from './source-queue'
import { sourceSchema, type Source, type SourceQueueAction } from './source-data'
import { localDay, migrateLibrary } from './model'
import { createRepository, recordStores } from './storage'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { cardDraftSchema } from './card-draft-data'

function sample() {
  const text = '# Reading\n\n中文🙂 long text\n\n'.repeat(50)
  const { source, asset } = prepareSource(
    { title: 'Intervals', url: '', format: 'markdown', content: text },
    now,
  )
  const library = saveReadingPosition(
    addSource(fixture(), source, asset),
    source.id,
    source.mediaId,
    { offset: 20, fraction: 0.2, view: 'preview' },
    now,
  )
  const change = (current: typeof library, action: SourceQueueAction, at = now) =>
    arrangeSource(current, source.id, source.mediaId, action, at)
  return { text, source, asset, library, change }
}

it('advances only confirmed reads through calendar intervals and caps at 30 days', () => {
  const { library, change } = sample()
  let current = library,
    at = new Date('2026-12-31T12:00:00')
  for (const [days, date] of [
    [1, '2027-01-01'],
    [3, '2027-01-04'],
    [7, '2027-01-11'],
    [14, '2027-01-25'],
    [30, '2027-02-24'],
    [30, '2027-03-26'],
  ] as const) {
    const plan = nextReadingInterval(current.sources[0]!, at)
    expect(plan).toEqual({ intervalDays: days, date })
    const before = structuredClone(current)
    const next = change(current, { type: 'read', ...plan }, at)
    expect(current).toEqual(before)
    expect(next.sources[0]!.readingIntervalDays).toBe(days)
    expect(next.sources[0]!.queue).toEqual({ state: 'active', availableOn: date })
    expect(next.sources[0]!.reading).toEqual(library.sources[0]!.reading)
    for (const store of recordStores.filter(
      (store) => store !== 'sources' && store !== 'studyEvents',
    ))
      expect(next[store]).toBe(library[store])
    expect(next.studyEvents).toHaveLength(current.studyEvents.length + 1)
    expect(next.studyEvents.at(-1)).toMatchObject({
      kind: 'reading',
      sourceId: current.sources[0]!.id,
      occurredAt: at.toISOString(),
      studyDay: localDay(at),
    })
    if (days === 30) expect(change(next, { type: 'read', ...plan }, at)).toBe(next)
    current = next
    at = new Date(`${date}T12:00:00`)
  }
})

it('advances from an imported interval that is not on the ladder instead of restarting at one day', () => {
  const { source } = sample()
  const imported = (days: number) =>
    nextReadingInterval(
      { ...source, readingIntervalDays: days as Source['readingIntervalDays'] },
      now,
    )
  // Configured intervals need not be on the legacy ladder when switching back to legacy mode.
  expect(imported(2)).toMatchObject({ intervalDays: 3 })
  expect(imported(5)).toMatchObject({ intervalDays: 7 })
  expect(nextReadingInterval({ ...source, readingIntervalDays: 30 }, now)).toMatchObject({
    intervalDays: 30,
  })
})

it('retains the last interval through custom dates, priority, archive, restore and position saves; reset keeps the date', () => {
  const { library, source, change } = sample()
  const first = change(library, { type: 'read', ...nextReadingInterval(source, now) })
  let current = change(first, { type: 'read', ...nextReadingInterval(first.sources[0]!, now) })
  for (const action of [
    { type: 'defer', date: '2027-06-01' },
    { type: 'priority', priority: 'high' },
    { type: 'archive' },
    { type: 'restore' },
  ] as const) {
    current = change(current, action)
    expect(current.sources[0]!.readingIntervalDays).toBe(3)
  }
  current = saveReadingPosition(
    current,
    source.id,
    source.mediaId,
    { offset: 30, fraction: 0, view: 'source' },
    now,
  )
  expect(current.sources[0]!.readingIntervalDays).toBe(3)
  const reset = change(current, { type: 'reset-interval' })
  expect(reset.sources[0]).not.toHaveProperty('readingIntervalDays')
  expect(reset.sources[0]!.queue).toEqual(current.sources[0]!.queue)
  expect(reset.sources[0]!.reading).toEqual(current.sources[0]!.reading)
  expect(reset.sources[0]!.priority).toBe('high')
  expect(nextReadingInterval(reset.sources[0]!, now).intervalDays).toBe(1)
  expect(change(reset, { type: 'reset-interval' })).toBe(reset)
})

it('rejects skipped steps, stale confirmations, archived reads and unsupported interval values', () => {
  const { library, source, change } = sample()
  const plan = nextReadingInterval(source, now)
  for (const interval of [0, -1, 1.5, 36501, '1', null, Number.NaN, Infinity])
    expect(() => sourceSchema.parse({ ...source, readingIntervalDays: interval })).toThrow()
  expect(() => change(library, { type: 'read', ...plan, intervalDays: 3 })).toThrow('重新确认')
  expect(() => change(library, { type: 'read', ...plan, date: '2027-01-01' })).toThrow('重新确认')
  const saved = change(library, { type: 'read', ...plan })
  expect(() => change(saved, { type: 'read', ...plan })).toThrow('重新确认')
  expect(() =>
    change(library, { type: 'read', ...plan }, new Date('2026-10-19T12:00:00Z')),
  ).toThrow()
  const archived = change(library, { type: 'archive' })
  expect(() => change(archived, { type: 'read', ...plan })).toThrow('重新确认')
  expect(() => arrangeSource(library, source.id, 'replaced', { type: 'read', ...plan })).toThrow(
    '材料已变化',
  )
  expect(library.sources[0]).not.toHaveProperty('readingIntervalDays')
})

it('starts excerpts independently and retains their interval after the original is reset or deleted', () => {
  const { library, source, text, change } = sample()
  const parent = { ...source, readingIntervalDays: 7 as const }
  const child = prepareSourceExcerpt(parent, text, sourceExcerpt(parent, text, 0, 9), 'Child', now)
  const initial = addSource({ ...library, sources: [parent] }, child.source, child.asset)
  expect(child.source.readingIntervalDays).toBeUndefined()
  const next = arrangeSource(
    initial,
    child.source.id,
    child.source.mediaId,
    { type: 'read', ...nextReadingInterval(child.source, now) },
    now,
  )
  expect(next.sources[0]!.readingIntervalDays).toBe(7)
  expect(next.sources[1]!.readingIntervalDays).toBe(1)
  const reset = change(next, { type: 'reset-interval' })
  expect(reset.sources[1]!.readingIntervalDays).toBe(1)
  const detached = removeSource(reset, source.id)
  expect(detached.sources[0]!.readingIntervalDays).toBe(1)
  expect(detached.sources[0]!.origin).toBeUndefined()
  expect(detached.cards).toEqual(library.cards)
})

it('round-trips intervals and positions through both backup formats, rekeying and repository checkpoints', async () => {
  const { library, source, asset, change } = sample()
  const next = change(library, { type: 'read', ...nextReadingInterval(source, now) })
  for (const restored of [
    parseBackup(await exportBackup(next, async () => asset.blob)),
    await parseArchive((await exportArchive(next, async () => asset.blob))!),
  ]) {
    const rekeyed = rekeyBackup(restored)
    expect(rekeyed.library.sources[0]!.readingIntervalDays).toBe(1)
    expect(rekeyed.library.sources[0]!.queue).toEqual(next.sources[0]!.queue)
    expect(rekeyed.library.sources[0]!.reading).toEqual(next.sources[0]!.reading)
    expect(rekeyed.library.sources[0]!.mediaId).not.toBe(source.mediaId)
  }
  expect(migrateLibrary({ ...library, version: 10 })).toEqual(library)
  const repo = createRepository(`interval-checkpoint-${crypto.randomUUID()}`)
  await repo.save(library, 0, { assets: [asset] })
  const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')
  try {
    await repo.save(next, 1, { reason: '更改阅读安排前' })
    expect(reads).not.toHaveBeenCalled()
  } finally {
    reads.mockRestore()
  }
  expect((await repo.load()).library).toEqual(next)
  const snapshot = (await repo.listBackups()).find((entry) => entry.reason === '更改阅读安排前')!
  expect(await repo.getBackup(snapshot.id)).toEqual(library)
  await repo.close()
})

it.each([13, 14, 15])(
  'upgrades a v%i record database while preserving drafts, snapshots, media and learning identity',
  async (oldVersion) => {
    const { library, source, asset } = sample()
    const name = `interval-upgrade-${crypto.randomUUID()}`
    const draft = cardDraftSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      position: 0,
      selectionId: crypto.randomUUID(),
      scope: `local:${name}`,
      mediaId: source.mediaId,
      deckId: 'deck',
      title: source.title,
      format: 'markdown',
      excerpt: { sourceId: source.id, start: 0, end: 9, quote: '# Reading' },
      receivedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      input: { type: 'basic', format: 'markdown', front: '', back: 'Unfinished', tags: [] },
      uploads: [],
    })
    const old = await openDB(name, oldVersion, {
      upgrade(db) {
        for (const store of [
          ...recordStores,
          'workspace',
          'assets',
          'backups',
          'meta',
          'checkpoints',
          'cardDrafts',
          'attemptSummaries',
        ])
          db.createObjectStore(store)
        const history = db.createObjectStore('history')
        history.createIndex('store', 'store')
        history.createIndex('revision', 'revision')
      },
    })
    const tx = old.transaction(
      [...recordStores, 'meta', 'assets', 'checkpoints', 'cardDrafts'],
      'readwrite',
    )
    for (const store of recordStores)
      for (const [position, value] of library[store].entries())
        await tx
          .objectStore(store)
          .put(
            { id: value.id, value, position, deckId: store === 'cards' ? 'deck' : undefined },
            value.id,
          )
    await tx.objectStore('meta').put(
      {
        revision: 7,
        counts: Object.fromEntries(recordStores.map((store) => [store, library[store].length])),
      },
      'main',
    )
    await tx.objectStore('assets').put(asset.blob, asset.meta.id)
    await tx.objectStore('cardDrafts').put(draft, draft.id)
    await tx.objectStore('checkpoints').put(
      {
        id: 'before-upgrade',
        revision: 7,
        createdAt: now.toISOString(),
        reason: '手动快照',
        cards: library.cards.length,
        notes: library.notes.length,
      },
      'before-upgrade',
    )
    await tx.done
    old.close()
    const repo = createRepository(name)
    expect(await repo.load()).toEqual({ revision: 7, library })
    expect((await repo.load()).library.sources[0]!.readingIntervalDays).toBeUndefined()
    expect(await repo.getBackup('before-upgrade')).toEqual(library)
    expect(await repo.readCardDrafts()).toEqual([draft])
    expect(await (await repo.getMedia(asset.meta.id))!.text()).toBe(await asset.blob.text())
    await expect(openDB(name, oldVersion)).rejects.toMatchObject({ name: 'VersionError' })
    await repo.close()
  },
)
