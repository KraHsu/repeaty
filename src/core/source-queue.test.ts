import 'fake-indexeddb/auto'
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, now } from './test-fixtures'
import { addSource, prepareSource, saveReadingPosition, sourceExcerpt } from './sources'
import { arrangeSource, nextReadingDay, queuedSources, sourceQueueState } from './source-queue'
import { sourceSchema, type Source, type SourcePriority } from './source-data'
import { localDay, migrateLibrary } from './model'
import { createRepository, recordStores } from './storage'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup, rekeyBackup } from './backups'

function sample() {
  const text = '# Reading\n\n' + '中文长文🙂\n\n'.repeat(100)
  const { source, asset } = prepareSource(
    { title: 'Material', url: '', format: 'markdown', content: text },
    now,
  )
  let library = addSource(fixture(), source, asset)
  library = saveReadingPosition(
    library,
    source.id,
    source.mediaId,
    { offset: 100, fraction: 0.3, view: 'preview' },
    now,
  )
  library.notes[0]!.excerpt = sourceExcerpt(source, text, 0, 9)
  const change = (current: typeof library, action: Parameters<typeof arrangeSource>[3], at = now) =>
    arrangeSource(current, source.id, source.mediaId, action, at)
  return { library, source, asset, change }
}
afterEach(() => vi.unstubAllEnvs())

it('changes only reading priority, defaults old sources to normal and preserves it through queue actions', () => {
  const { library, source, change } = sample()
  expect(change(library, { type: 'priority', priority: 'normal' })).toBe(library)
  expect(library.sources[0]!.priority).toBeUndefined()
  const high = change(library, { type: 'priority', priority: 'high' })
  expect(high.sources[0]).toEqual({ ...library.sources[0], priority: 'high' })
  expect(change(high, { type: 'priority', priority: 'high' })).toBe(high)
  const later = change(high, { type: 'defer', date: nextReadingDay(now) })
  const low = change(later, { type: 'priority', priority: 'low' })
  expect(low.sources[0]).toEqual({ ...later.sources[0], priority: 'low' })
  const archived = change(low, { type: 'archive' })
  const restored = change(archived, { type: 'restore' })
  const normal = change(restored, { type: 'priority', priority: 'normal' })
  expect(normal.sources[0]!.priority).toBe('normal')
  for (const next of [high, later, low, archived, restored, normal]) {
    for (const store of recordStores.filter((store) => store !== 'sources'))
      expect(next[store]).toBe(library[store])
    expect(next.sources[0]!.reading).toEqual(library.sources[0]!.reading)
    expect(next.sources[0]!.mediaId).toBe(source.mediaId)
  }
  expect(archived.sources[0]!.priority).toBe('low')
  expect(restored.sources[0]!.priority).toBe('low')
  for (const priority of ['', 'urgent', 0, null]) {
    expect(() => sourceSchema.parse({ ...source, priority })).toThrow()
    expect(() =>
      change(library, { type: 'priority', priority: priority as SourcePriority }),
    ).toThrow('阅读安排无效')
  }
})

it('orders ready sources by priority then date without releasing future or archived high priority sources', () => {
  const { source } = sample()
  const sources: Source[] = [
    { ...source, id: 'normal', createdAt: '2026-10-14T00:00:00Z' },
    { ...source, id: 'high-new', priority: 'high', createdAt: '2026-10-17T00:00:00Z' },
    { ...source, id: 'low', priority: 'low', createdAt: '2026-10-01T00:00:00Z' },
    { ...source, id: 'high-old', priority: 'high', createdAt: '2026-10-16T00:00:00Z' },
    { ...source, id: 'explicit-normal', priority: 'normal', createdAt: '2026-10-15T00:00:00Z' },
    { ...source, id: 'high-tie', priority: 'high', createdAt: '2026-10-17T00:00:00Z' },
    {
      ...source,
      id: 'future-high',
      priority: 'high',
      queue: { state: 'active', availableOn: '2026-10-21' },
    },
    {
      ...source,
      id: 'future-low',
      priority: 'low',
      queue: { state: 'active', availableOn: '2026-10-20' },
    },
    {
      ...source,
      id: 'archived-high',
      priority: 'high',
      queue: { state: 'archived', availableOn: '2026-10-01' },
    },
  ]
  const original = structuredClone(sources)
  const ready = ['high-old', 'high-new', 'high-tie', 'normal', 'explicit-normal', 'low']
  expect(queuedSources(sources, 'ready', '2026-10-19').map((entry) => entry.id)).toEqual(ready)
  expect(queuedSources(sources, 'all', '2026-10-19').map((entry) => entry.id)).toEqual([
    ...ready,
    'future-low',
    'future-high',
    'archived-high',
  ])
  expect(queuedSources(sources, 'ready', '2026-10-21').map((entry) => entry.id)).toEqual([
    'high-old',
    'high-new',
    'high-tie',
    'future-high',
    'normal',
    'explicit-normal',
    'low',
    'future-low',
  ])
  expect(sources).toEqual(original)
})

it('defers until the local date and archives or restores without changing snapshots, excerpts or study records', () => {
  const { library, source, change } = sample()
  const tomorrow = nextReadingDay(now),
    today = localDay(now)
  expect(sourceQueueState(source, today)).toBe('ready')
  const later = change(library, { type: 'defer', date: tomorrow })
  expect(sourceQueueState(later.sources[0]!, today)).toBe('deferred')
  expect(sourceQueueState(later.sources[0]!, tomorrow)).toBe('ready')
  expect(change(later, { type: 'defer', date: tomorrow })).toBe(later)
  const archived = change(later, { type: 'archive' })
  expect(sourceQueueState(archived.sources[0]!, '9999-12-31')).toBe('archived')
  const restored = change(archived, { type: 'restore' })
  expect(restored.sources[0]!.queue).toEqual({ state: 'active', availableOn: today })
  for (const next of [later, archived, restored]) {
    for (const store of recordStores.filter((store) => store !== 'sources'))
      expect(next[store]).toBe(library[store])
    expect(next.sources[0]!.reading).toEqual(library.sources[0]!.reading)
    expect(next.sources[0]!.mediaId).toBe(source.mediaId)
  }
})

it('rejects invalid dates, stale snapshots and deleted sources instead of changing their arrangements', () => {
  const { library, source, change } = sample()
  for (const date of [
    '2026-02-30',
    '2026-13-01',
    'tomorrow',
    '2026-10-18T00:00:00Z',
    '',
    localDay(now),
    '2026-01-01',
  ])
    expect(() => change(library, { type: 'defer', date })).toThrow()
  expect(() =>
    arrangeSource(library, source.id, 'another-snapshot', { type: 'archive' }, now),
  ).toThrow('材料已变化')
  expect(() => arrangeSource(library, 'deleted', source.mediaId, { type: 'archive' }, now)).toThrow(
    '材料已变化',
  )
  expect(() =>
    sourceSchema.parse({ ...source, queue: { state: 'completed', availableOn: '2026-10-20' } }),
  ).toThrow()
  expect(() =>
    sourceSchema.parse({ ...source, queue: { state: 'active', availableOn: '2026-02-30' } }),
  ).toThrow()
  expect(library.sources[0]!.queue).toBeUndefined()
})

it('orders by reading date with stable ties and leaves library order unchanged as positions are saved', () => {
  const { library, source } = sample()
  const older = { ...source, id: 'older', createdAt: '2026-10-15T00:00:00Z' }
  const deferred = {
    ...source,
    id: 'later',
    queue: { state: 'active' as const, availableOn: '2026-10-20' },
  }
  const archived = {
    ...source,
    id: 'archived',
    queue: { state: 'archived' as const, availableOn: '2026-10-01' },
  }
  const sources = [deferred, source, archived, older],
    today = localDay(now)
  expect(queuedSources(sources, 'ready', today).map((entry) => entry.id)).toEqual([
    'older',
    source.id,
  ])
  expect(queuedSources(sources, 'all', today).map((entry) => entry.id)).toEqual([
    'older',
    source.id,
    'later',
    'archived',
  ])
  expect(queuedSources(sources, 'deferred', today)).toEqual([deferred])
  expect(queuedSources(sources, 'archived', today, 'MATERIAL')).toEqual([archived])
  const visited = saveReadingPosition(
    { ...library, sources },
    source.id,
    source.mediaId,
    { offset: 200, fraction: 0.5, view: 'preview' },
    now,
  )
  expect(queuedSources(visited.sources, 'all', today).map((entry) => entry.id)).toEqual([
    'older',
    source.id,
    'later',
    'archived',
  ])
  expect(sources.map((entry) => entry.id)).toEqual(['later', source.id, 'archived', 'older'])
})

it('uses calendar dates across midnight, UTC offsets and daylight-saving changes', () => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
  expect(nextReadingDay(new Date('2026-03-07T12:00:00-08:00'))).toBe('2026-03-08')
  expect(nextReadingDay(new Date('2026-03-07T23:30:00-08:00'), 3)).toBe('2026-03-10')
  expect(nextReadingDay(new Date('2026-11-01T00:30:00-07:00'))).toBe('2026-11-02')
  expect(nextReadingDay(new Date('2026-10-31T23:30:00-07:00'), 7)).toBe('2026-11-07')
  expect(localDay(new Date('2026-10-20T02:00:00Z'))).toBe('2026-10-19')
  vi.stubEnv('TZ', 'Asia/Shanghai')
  expect(nextReadingDay(new Date('2026-12-31T23:59:00+08:00'))).toBe('2027-01-01')
  expect(nextReadingDay(new Date('2026-12-31T23:59:00+08:00'), 3)).toBe('2027-01-03')
  expect(nextReadingDay(new Date('2028-02-27T23:59:00+08:00'), 7)).toBe('2028-03-05')
  expect(localDay(new Date('2026-10-19T23:00:00Z'))).toBe('2026-10-20')
})

it('retains reading arrangements in archives, JSON, rekeying, stored revisions and snapshot recovery', async () => {
  const { library, source, asset, change } = sample()
  const archived = change(
    change(change(library, { type: 'priority', priority: 'high' }), {
      type: 'defer',
      date: nextReadingDay(now),
    }),
    { type: 'archive' },
  )
  for (const backup of [
    await parseArchive((await exportArchive(archived, async () => asset.blob))!),
    parseBackup(await exportBackup(archived, async () => asset.blob)),
  ]) {
    const restored = rekeyBackup(backup)
    expect(restored.library.sources[0]!.queue).toEqual(archived.sources[0]!.queue)
    expect(restored.library.sources[0]!.priority).toBe('high')
    expect(restored.library.sources[0]!.reading).toEqual(archived.sources[0]!.reading)
    expect(restored.library.notes[0]!.excerpt).toEqual(archived.notes[0]!.excerpt)
    expect(restored.library.sources[0]!.mediaId).not.toBe(source.mediaId)
  }
  const repo = createRepository(`reading-queue-${crypto.randomUUID()}`)
  await repo.load()
  await repo.save(library, 0, { assets: [asset] })
  await repo.save(archived, 1, { reason: '更改阅读安排前' })
  expect((await repo.load()).library).toEqual(archived)
  const prior = (await repo.listBackups()).find((entry) => entry.reason === '更改阅读安排前')!
  await repo.save(await repo.getBackup(prior.id), 2)
  expect((await repo.load()).library).toEqual(library)
  await repo.close()
})

it.each([7, 8, 9])(
  'migrates v%i libraries and backups without inventing priority or arrangements',
  async (version) => {
    const { library, asset } = sample()
    if (version >= 8)
      library.sources[0]!.queue = { state: 'active', availableOn: nextReadingDay(now) }
    if (version === 9) library.sources[0]!.priority = 'high'
    const old = { ...library, version }
    expect(migrateLibrary(old)).toEqual(library)
    const json = JSON.parse(await exportBackup(library, async () => asset.blob))
    json.version = version
    json.library.version = version
    expect(parseBackup(JSON.stringify(json)).library).toEqual(library)
    const input = new ZipReader(
      new BlobReader((await exportArchive(library, async () => asset.blob))!),
    )
    const output = new BlobWriter(),
      writer = new ZipWriter(output, { useWebWorkers: false })
    for (const entry of await input.getEntries()) {
      if (entry.directory) continue
      let content = await entry.getData(new BlobWriter())
      if (entry.filename === 'manifest.json') {
        const manifest = JSON.parse(await content.text())
        content = new Blob([
          JSON.stringify({ ...manifest, version: version - 3, libraryVersion: version }),
        ])
      }
      await writer.add(entry.filename, new BlobReader(content))
    }
    await writer.close()
    await input.close()
    const restored = (await parseArchive(await output.getData())).library
    expect(restored).toEqual(library)
    expect(restored.sources[0]!.queue).toEqual(library.sources[0]!.queue)
    expect(restored.sources[0]!.priority).toBe(library.sources[0]!.priority)
    expect(restored.sources[0]!.kind).toBeUndefined()
  },
)
