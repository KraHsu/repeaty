import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, it, vi } from 'vitest'
import { fixture, now } from './test-fixtures'
import {
  addSource,
  prepareSource,
  recentSource,
  saveReadingPosition,
  sourceExcerpt,
  readSource,
} from './sources'
import { sourceSchema, characterBoundary } from './source-data'
import { librarySchema, migrateLibrary } from './model'
import { createRepository, recordStores } from './storage'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { DraftSession } from './draft-proposals'
import { renderMarkdown, renderReadingMarkdown } from './content'

function sample(format: 'plain' | 'markdown' = 'markdown') {
  const text = '# Header\n\n' + '中文段落🙂 repeated\n\n'.repeat(100)
  const { source, asset } = prepareSource({ title: 'Reading', url: '', format, content: text }, now)
  return { text, source, asset, library: addSource(fixture(), source, asset) }
}
it('saves both reading views on one immutable snapshot without changing learning or media records', () => {
  const { library, source } = sample()
  const position = { offset: 100, fraction: 0.4, view: 'preview' as const }
  const next = saveReadingPosition(library, source.id, source.mediaId, position, now)
  librarySchema.parse(next)
  expect(next.sources[0]!.reading).toEqual({ ...position, updatedAt: now.toISOString() })
  for (const store of recordStores.filter((store) => store !== 'sources'))
    expect(next[store]).toBe(library[store])
  expect(saveReadingPosition(next, source.id, source.mediaId, position, now)).toBe(next)
  expect(
    saveReadingPosition(
      next,
      source.id,
      source.mediaId,
      { offset: 0, fraction: 0, view: 'source' },
      now,
    ).sources[0]!.reading?.offset,
  ).toBe(0)
  expect(() => saveReadingPosition(next, source.id, 'old-snapshot', position, now)).toThrow(
    '材料已变化',
  )
  expect(() => saveReadingPosition(next, 'deleted', source.mediaId, position, now)).toThrow(
    '材料已变化',
  )
  expect(() =>
    saveReadingPosition(
      next,
      source.id,
      source.mediaId,
      { ...position, offset: source.characters + 1 },
      now,
    ),
  ).toThrow()
  expect(() =>
    sourceSchema.parse({
      ...source,
      reading: { ...position, view: 'source', updatedAt: now.toISOString() },
    }),
  ).toThrow()
  expect(() =>
    sourceSchema.parse({
      ...source,
      format: 'plain',
      reading: { ...position, updatedAt: now.toISOString() },
    }),
  ).toThrow()
})

it('chooses the most recently saved material and keeps Unicode offsets at character boundaries', () => {
  const { source, library } = sample(),
    second = { ...source, id: 'second' }
  expect(recentSource([])).toBeUndefined()
  expect(recentSource([source, second])).toBe(second)
  const first = saveReadingPosition(
    library,
    source.id,
    source.mediaId,
    { offset: 10, fraction: 0, view: 'source' },
    now,
  ).sources[0]!
  const later = {
    ...second,
    reading: { ...first.reading!, updatedAt: new Date(now.getTime() + 1000).toISOString() },
  }
  expect(recentSource([first, later])?.id).toBe('second')
  expect(characterBoundary('中🙂文', 2)).toBe(1)
  expect(characterBoundary('中🙂文', 3)).toBe(3)
  expect(characterBoundary('中🙂文', 100)).toBe(4)
})

it('maps Markdown blocks to their original offsets, including lists, tables, code and math, without enabling HTML', () => {
  const text =
    '# Title\n\nSame🙂\n\nSame🙂\n\n- One\n- Two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n$$x^2$$\n\n<script>bad()</script>\n\n![image](https://example.invalid/x.png)'
  const html = renderReadingMarkdown(text)
  const offsets = [...html.matchAll(/data-reading-offset="(\d+)"/g)].map((match) =>
    Number(match[1]),
  )
  expect(offsets).toEqual([
    0,
    text.indexOf('Same'),
    text.lastIndexOf('Same'),
    text.indexOf('- One'),
    text.indexOf('| A'),
    text.indexOf('```'),
    text.indexOf('$$'),
    text.indexOf('<script>'),
    text.indexOf('![image]'),
  ])
  expect(html).toContain('katex-display')
  expect(html).toContain('<table>')
  expect(html).not.toMatch(/<script|<img|src="https:/)
  expect(renderMarkdown(text)).not.toContain('data-reading-offset')
})

it('round-trips positions through archive, JSON and rekeying, and migrates v6 without inventing progress', async () => {
  const { source, asset, library, text } = sample()
  const next = saveReadingPosition(
    library,
    source.id,
    source.mediaId,
    { offset: 200, fraction: 0.25, view: 'preview' },
    now,
  )
  const json = await exportBackup(next, async () => asset.blob)
  expect(JSON.parse(json).version).toBe(19)
  for (const data of [
    parseBackup(json),
    await parseArchive((await exportArchive(next, async () => asset.blob))!),
  ]) {
    const restored = rekeyBackup(data)
    expect(restored.library.version).toBe(19)
    expect(restored.library.sources[0]!.reading).toEqual(next.sources[0]!.reading)
    expect(
      await readSource(
        restored.library.sources[0]!,
        restored.library,
        async (id) => restored.assets.find((asset) => asset.meta.id === id)?.blob,
      ),
    ).toBe(text)
  }
  const old = { ...library, version: 6 }
  const migrated = migrateLibrary(old)
  expect(migrated).toEqual(library)
  expect(migrated.sources[0]!.reading).toBeUndefined()
  const oldJson = JSON.parse(await exportBackup(library, async () => asset.blob))
  oldJson.version = 6
  oldJson.library.version = 6
  expect(parseBackup(JSON.stringify(oldJson)).library).toEqual(library)
})

it.each([9, 10, 11, 12, 13, 14])(
  'upgrades normalized v%s records, checkpoints and pending drafts; reading write failures roll back',
  async (seedVersion) => {
    const name = `reading-v${seedVersion}-${crypto.randomUUID()}`
    const { library, source, asset, text } = sample()
    if (seedVersion >= 11)
      library.sources[0]!.queue = { state: 'active', availableOn: '2026-10-25' }
    if (seedVersion >= 12) library.sources[0]!.priority = 'high'
    if (seedVersion >= 14) library.sources[0]!.readingIntervalDays = 7
    const session = new DraftSession(),
      scope = `local:${name}`
    session.bindScope(scope)
    const context = { library, revision: 7, scope }
    session.share(context, sourceExcerpt(source, text, 0, 8), 'deck', source.mediaId, text)
    const draft = session.prepare(context, {
      selectionId: session.selection!.selectionId,
      requestId: 'pending',
      cards: [{ type: 'basic', front: 'Q', back: 'A' }],
    }).drafts[0]!
    const old = await openDB(name, seedVersion, {
      upgrade(db) {
        for (const store of [
          'workspace',
          'assets',
          'backups',
          'meta',
          'checkpoints',
          'attemptSummaries',
          'cardDrafts',
          ...recordStores,
        ])
          db.createObjectStore(store)
        const history = db.createObjectStore('history')
        history.createIndex('revision', 'revision')
        history.createIndex('store', 'store')
      },
    })
    const tx = old.transaction(
      [...recordStores, 'assets', 'meta', 'checkpoints', 'cardDrafts'],
      'readwrite',
    )
    for (const store of recordStores)
      for (const [position, value] of library[store].entries())
        await tx.objectStore(store).put({ id: value.id, value, position }, value.id)
    await tx.objectStore('meta').put(
      {
        revision: 7,
        counts: Object.fromEntries(recordStores.map((store) => [store, library[store].length])),
      },
      'main',
    )
    await tx.objectStore('assets').put(asset.blob, asset.meta.id)
    await tx.objectStore('cardDrafts').put(draft, draft.id)
    await tx
      .objectStore('checkpoints')
      .put(
        { id: 'v9', revision: 7, reason: 'test', createdAt: now.toISOString(), notes: 1, cards: 1 },
        'v9',
      )
    await tx.done
    old.close()
    const repo = createRepository(name),
      loaded = await repo.load()
    expect(loaded).toEqual({ library, revision: 7 })
    expect(await repo.readCardDrafts()).toEqual([draft])
    expect(await repo.getBackup('v9')).toEqual(library)
    await expect(openDB(name, seedVersion)).rejects.toMatchObject({ name: 'VersionError' })
    const next = saveReadingPosition(
      loaded.library,
      source.id,
      source.mediaId,
      { offset: 100, fraction: 0, view: 'source' },
      now,
    )
    await repo.save(next, 7)
    const original = IDBObjectStore.prototype.put
    const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === 'sources')
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
      return original.apply(this, args)
    })
    try {
      await expect(
        repo.save(
          saveReadingPosition(
            next,
            source.id,
            source.mediaId,
            { offset: 300, fraction: 0, view: 'source' },
            now,
          ),
          8,
        ),
      ).rejects.toMatchObject({ name: 'QuotaExceededError' })
    } finally {
      fail.mockRestore()
    }
    expect((await repo.load()).library).toEqual(next)
    expect(await repo.readCardDrafts()).toEqual([draft])
    await repo.save(await repo.getBackup('v9'), 8)
    expect((await repo.load()).library.sources[0]!.reading).toBeUndefined()
    await repo.close()
  },
)
