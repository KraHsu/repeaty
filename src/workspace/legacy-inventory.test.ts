import { IDBDatabase, IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { fixture, legacyFixture, now } from '../core/test-fixtures'
// This inventory fixture describes the pre-material v16 database only.
const recordStores = [
  'decks',
  'notes',
  'cards',
  'reviews',
  'media',
  'savedSearches',
  'practices',
  'attempts',
  'sources',
] as const
import { summarizeAttempt } from '../core/practice-data'
import {
  captureLegacyInventory,
  legacyFingerprint,
  type LegacyInventoryInput,
} from './legacy-inventory'

const mainNames = [
  ...recordStores,
  'workspace',
  'assets',
  'backups',
  'meta',
  'checkpoints',
  'history',
  'attemptSummaries',
  'cardDrafts',
]
const auxiliaryName = 'repeaty-leetcode-drafts'
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
}
async function create(factory: IDBFactory, name: string, version: number, stores: string[]) {
  const req = factory.open(name, version)
  req.onupgradeneeded = () => {
    for (const store of stores) req.result.createObjectStore(store)
  }
  return request(req)
}
async function put(
  factory: IDBFactory,
  name: string,
  store: string,
  key: IDBValidKey,
  value: unknown,
) {
  const db = await request(factory.open(name))
  try {
    const tx = db.transaction(store, 'readwrite')
    const finished = done(tx)
    tx.objectStore(store).put(value, key)
    await finished
  } finally {
    db.close()
  }
}

async function setup(name = 'm0-fixture') {
  const factory = new IDBFactory()
  const scope = `local:${name}`
  const library = fixture()
  const media = new Blob(['media bytes'], { type: 'audio/mpeg' })
  const text = '摘录🙂正文'
  const sourceBlob = new Blob([text], { type: 'text/plain' })
  library.media.push(
    {
      id: 'audio',
      name: 'audio.mp3',
      type: 'audio/mpeg',
      size: media.size,
      createdAt: now.toISOString(),
    },
    {
      id: 'source-media',
      name: 'source.txt',
      type: 'text/plain',
      size: sourceBlob.size,
      createdAt: now.toISOString(),
    },
  )
  library.sources.push({
    id: 'source',
    title: 'Source',
    url: '',
    format: 'plain',
    mediaId: 'source-media',
    characters: text.length,
    createdAt: now.toISOString(),
  })
  library.notes[0]!.frontMedia = ['audio']
  library.notes[0]!.front = '\nQuestion\r\n'
  library.cards[0]!.schedule.stability = 8.12345678901234
  library.practices.push({
    id: 'practice',
    cardId: library.cards[0]!.id,
    contentRevision: 'original-revision',
    question: {
      front: 'Old question',
      back: '',
      format: 'markdown',
      plugin: { id: 'leetcode', version: 1, data: { slug: 'two-sum' } },
    },
    startedAt: now.toISOString(),
  })
  const attempt = {
    id: 'attempt',
    practiceId: 'practice',
    submittedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    language: 'rust',
    code: 'fn main() { println!("中文🙂"); }',
    elapsedMs: 1278.125,
    status: 'completed' as const,
    result: {
      outcome: 'rejected' as const,
      status: 'Wrong Answer',
      runtime: '',
      memory: '',
      detail: 'Full judge detail\nexpected: 42',
    },
  }
  library.attempts.push(attempt)
  const draftBlob = new Blob(['draft bytes'], { type: 'image/png' })
  const draft = {
    version: 1,
    id: crypto.randomUUID(),
    position: 0,
    selectionId: crypto.randomUUID(),
    scope,
    mediaId: 'source-media',
    deckId: library.decks[0]!.id,
    title: '待完成',
    format: 'plain',
    excerpt: { sourceId: 'source', start: 0, end: 2, quote: '摘录' },
    receivedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    input: {
      type: 'basic',
      format: 'markdown',
      front: '',
      back: '尚未写完\r\n',
      tags: [],
      frontMedia: ['draft-media'],
      backMedia: [],
    },
    uploads: [
      {
        meta: {
          id: 'draft-media',
          name: 'draft.png',
          size: draftBlob.size,
          type: draftBlob.type,
          createdAt: now.toISOString(),
        },
        blob: draftBlob,
      },
    ],
  }
  const codeDraft = {
    practiceId: 'practice',
    revision: 'original-revision',
    lang: 'rust',
    code: { rust: 'fn unfinished() {}' },
    attempts: 2,
    elapsedMs: 123.875,
    answerSeen: false,
    mode: 'automatic',
  }
  const db = await create(factory, name, 16, mainNames)
  const tx = db.transaction(mainNames, 'readwrite'),
    completed = done(tx)
  for (const name of recordStores)
    for (const [position, value] of library[name].entries())
      tx.objectStore(name).put({ id: value.id, position, value }, value.id)
  tx.objectStore('meta').put(
    {
      revision: 17,
      counts: Object.fromEntries(recordStores.map((name) => [name, library[name].length])),
    },
    'main',
  )
  tx.objectStore('assets').put(media, 'audio')
  tx.objectStore('assets').put(sourceBlob, 'source-media')
  tx.objectStore('attemptSummaries').put(
    { id: attempt.id, position: 0, value: summarizeAttempt(attempt) },
    attempt.id,
  )
  tx.objectStore('checkpoints').put(
    { id: 'checkpoint', revision: 16, notes: 1, cards: 1 },
    'checkpoint',
  )
  tx.objectStore('history').put(
    {
      revision: 17,
      store: 'cards',
      id: library.cards[0]!.id,
      before: { id: library.cards[0]!.id, value: library.cards[0], position: 0 },
    },
    [17, 'cards', library.cards[0]!.id],
  )
  tx.objectStore('cardDrafts').put(draft, draft.id)
  await completed
  db.close()
  const auxiliary = await create(factory, auxiliaryName, 1, ['drafts'])
  auxiliary.close()
  await put(
    factory,
    auxiliaryName,
    'drafts',
    JSON.stringify([scope, library.cards[0]!.id]),
    codeDraft,
  )
  await put(factory, auxiliaryName, 'drafts', JSON.stringify(['server:other-account', 'private']), {
    code: { rust: 'OTHER ACCOUNT CODE' },
  })
  const preferences = new Map([
    ['repeaty.locale', 'zh-CN'],
    [
      'repeaty.preferences.v1',
      JSON.stringify({
        historyLength: 13,
        historyAfterReveal: false,
        popupInfo: false,
        popupWarning: true,
        popupError: true,
      }),
    ],
    ['repeaty.plugins.v1', JSON.stringify({ leetcode: true, 'answer-history': false })],
    ['repeaty.leetcode.site', 'leetcode.cn'],
    ['repeaty.server.token', 'SECRET-TOKEN'],
    ['repeaty.server.endpoint', 'https://private.example'],
    ['unrelated', 'SECRET-OTHER'],
  ])
  const getItem = vi.fn((key: string) => preferences.get(key) ?? null)
  const input: LegacyInventoryInput = {
    indexedDB: factory,
    databaseName: name,
    preferences: { getItem },
    writersPaused: true,
  }
  return { factory, name, scope, library, attempt, draft, codeDraft, preferences, getItem, input }
}

describe('explicit read-only legacy inventory', () => {
  it('captures original IDs, exact text/floats, full attempts, checkpoints and both draft stores without source writes', async () => {
    const fixture = await setup()
    const opened = vi.spyOn(fixture.factory, 'open')
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction')
    let result
    try {
      result = await captureLegacyInventory(fixture.input)
      expect(opened.mock.calls.every((args) => args.length === 1)).toBe(true)
      expect(transactions.mock.calls.every((args) => args[1] === 'readonly')).toBe(true)
    } finally {
      opened.mockRestore()
      transactions.mockRestore()
    }
    expect(result.status).toBe('ready')
    expect(result.report).toMatchObject({
      layout: 'entity-stores',
      databaseVersion: 16,
      issues: [],
      counts: { notes: 1, cards: 1, attempts: 1, sources: 1, cardDrafts: 1, leetcodeDrafts: 1 },
    })
    const snapshot = result.snapshot!
    for (const name of recordStores)
      expect(
        snapshot.main.stores[name]!.map(({ value }) => (value as { value: unknown }).value),
      ).toEqual(fixture.library[name])
    expect(snapshot.main.stores.attempts![0]!.value).toMatchObject({
      value: {
        code: fixture.attempt.code,
        result: { detail: fixture.attempt.result.detail },
        elapsedMs: 1278.125,
      },
    })
    expect(snapshot.main.stores.history).toHaveLength(1)
    expect(snapshot.main.stores.checkpoints).toHaveLength(1)
    const draft = snapshot.main.stores.cardDrafts![0]!.value as typeof fixture.draft
    expect(draft).toEqual(fixture.draft)
    expect(await draft.uploads[0]!.blob.text()).toBe('draft bytes')
    expect(await (snapshot.main.stores.assets![0]!.value as Blob).text()).toBe('media bytes')
    expect(snapshot.leetcode!.stores.drafts![0]!.value).toEqual(fixture.codeDraft)
    expect(snapshot.preferences['repeaty.preferences.v1']).toMatchObject({
      historyLength: 13,
      popupInfo: false,
    })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(JSON.stringify(result)).not.toContain('OTHER ACCOUNT CODE')
    expect(JSON.stringify(result.report)).not.toContain(fixture.attempt.code)
    expect(fixture.getItem.mock.calls.flat()).not.toContain('repeaty.server.token')
    expect((await captureLegacyInventory(fixture.input)).snapshot).toEqual(snapshot)
    expect(
      (await fixture.factory.databases()).find((entry) => entry.name === fixture.name)!.version,
    ).toBe(16)
  })
  it('does not create a missing main or auxiliary DB or require live globals', async () => {
    const factory = new IDBFactory(),
      opened = vi.spyOn(factory, 'open')
    expect(
      await captureLegacyInventory({
        indexedDB: factory,
        databaseName: 'missing',
        preferences: { getItem: () => null },
        writersPaused: true,
      }),
    ).toEqual({ status: 'missing' })
    expect(opened).not.toHaveBeenCalled()
    expect(await factory.databases()).toEqual([])
    opened.mockRestore()
    const db = await create(factory, 'old', 2, ['workspace', 'assets', 'backups'])
    db.close()
    await put(factory, 'old', 'workspace', 'main', { revision: 8, library: legacyFixture() })
    const result = await captureLegacyInventory({
      indexedDB: factory,
      databaseName: 'old',
      preferences: { getItem: () => null },
      writersPaused: true,
    })
    expect(result).toMatchObject({
      status: 'incomplete',
      report: {
        layout: 'monolithic',
        databaseVersion: 2,
        issues: ['legacy-normalization-required'],
      },
    })
    expect(result.snapshot!.main.stores.workspace![0]!.value).toEqual({
      revision: 8,
      library: legacyFixture(),
    })
    expect(await factory.databases()).toEqual([{ name: 'old', version: 2 }])
  })
  it('aborts accidental creation when databases() races with deletion', async () => {
    const factory = new IDBFactory()
    vi.spyOn(factory, 'databases').mockResolvedValueOnce([{ name: 'vanished', version: 16 }])
    await expect(
      captureLegacyInventory({
        indexedDB: factory,
        databaseName: 'vanished',
        preferences: { getItem: () => null },
        writersPaused: true,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await factory.databases()).toEqual([])
  })
  it('refuses capture while writers have not been paused', async () => {
    const fixture = await setup()
    await expect(
      captureLegacyInventory({ ...fixture.input, writersPaused: false }),
    ).rejects.toThrow('legacy-writers-must-be-paused')
  })
  it.each(['code', 'detail', 'draft', 'draft-asset', 'leetcode-draft', 'preference'] as const)(
    'detects %s changes even without a main revision bump',
    async (change) => {
      const fixture = await setup()
      const result = await captureLegacyInventory({
        ...fixture.input,
        afterFirstRead: async () => {
          if (change === 'code' || change === 'detail') {
            const attempt = {
              ...fixture.attempt,
              code: change === 'code' ? 'changed code' : fixture.attempt.code,
              result: {
                ...fixture.attempt.result,
                detail:
                  change === 'detail' ? 'changed judge detail' : fixture.attempt.result.detail,
              },
            }
            await put(fixture.factory, fixture.name, 'attempts', attempt.id, {
              id: attempt.id,
              position: 0,
              value: attempt,
            })
          } else if (change === 'draft' || change === 'draft-asset') {
            const draft = structuredClone(fixture.draft)
            if (change === 'draft') draft.input.back = 'edited incomplete answer'
            else draft.uploads[0]!.blob = new Blob(['other bytes'], { type: 'image/png' })
            await put(fixture.factory, fixture.name, 'cardDrafts', draft.id, draft)
          } else if (change === 'leetcode-draft') {
            await put(
              fixture.factory,
              auxiliaryName,
              'drafts',
              JSON.stringify([fixture.scope, fixture.library.cards[0]!.id]),
              { ...fixture.codeDraft, code: { rust: 'changed unsaved code' } },
            )
          } else fixture.preferences.set('repeaty.locale', 'en')
        },
      })
      expect(result.status).toBe('source-changed')
      expect(result).not.toHaveProperty('snapshot')
      expect(result.report!.issues).toContain('source-changed-during-capture')
    },
  )
  it('reports missing full bodies and broken media instead of treating summaries as complete records', async () => {
    const fixture = await setup()
    await put(fixture.factory, fixture.name, 'attempts', fixture.attempt.id, {
      id: fixture.attempt.id,
      position: 0,
      value: summarizeAttempt(fixture.attempt),
    })
    await put(
      fixture.factory,
      fixture.name,
      'assets',
      'audio',
      new Blob(['wrong'], { type: 'audio/mpeg' }),
    )
    const result = await captureLegacyInventory(fixture.input)
    expect(result.status).toBe('incomplete')
    expect(result.report!.issues).toEqual(
      expect.arrayContaining(['missing-full-attempt-body', 'missing-or-corrupt-media']),
    )
  })
  it('keeps legacy bare LeetCode drafts only in the default local scope', async () => {
    const defaultFixture = await setup('repeaty')
    await put(
      defaultFixture.factory,
      auxiliaryName,
      'drafts',
      'old-bare-card-id',
      defaultFixture.codeDraft,
    )
    expect((await captureLegacyInventory(defaultFixture.input)).report!.counts.leetcodeDrafts).toBe(
      2,
    )
    const other = await setup('other-local')
    await put(other.factory, auxiliaryName, 'drafts', 'old-bare-card-id', {
      code: { rust: 'NOT THIS LIBRARY' },
    })
    expect((await captureLegacyInventory(other.input)).report!.counts.leetcodeDrafts).toBe(1)
  })
  it('does not silently carry unknown preference fields into a workspace', async () => {
    const fixture = await setup()
    fixture.preferences.set(
      'repeaty.preferences.v1',
      JSON.stringify({ historyLength: 13, token: 'SECRET-IN-PREFERENCE' }),
    )
    const result = await captureLegacyInventory(fixture.input)
    expect(result.status).toBe('incomplete')
    expect(result.snapshot!.preferences['repeaty.preferences.v1']).toEqual({ historyLength: 13 })
    expect(JSON.stringify(result)).not.toContain('SECRET-IN-PREFERENCE')
  })

  it('does not mix auxiliary changes from another account into this local snapshot', async () => {
    const fixture = await setup()
    const result = await captureLegacyInventory({
      ...fixture.input,
      afterFirstRead: async () => {
        await put(
          fixture.factory,
          auxiliaryName,
          'drafts',
          JSON.stringify(['server:other-account', 'private']),
          { code: { rust: 'CHANGED OTHER ACCOUNT CODE' } },
        )
      },
    })
    expect(result.status).toBe('ready')
    expect(JSON.stringify(result)).not.toContain('CHANGED OTHER ACCOUNT CODE')
  })

  it('reports orphan summaries when the actual attempt store has lost a body', async () => {
    const fixture = await setup()
    await put(fixture.factory, fixture.name, 'attemptSummaries', 'orphan', {
      id: 'orphan',
      position: 1,
      value: { id: 'orphan' },
    })
    const result = await captureLegacyInventory(fixture.input)
    expect(result.status).toBe('incomplete')
    expect(result.report!.issues).toContain('orphan-attempt-summary')
  })
  it('fingerprints order-independent objects, exact float precision and raw Blob bytes', async () => {
    expect(await legacyFingerprint({ a: 1, b: 2 })).toBe(await legacyFingerprint({ b: 2, a: 1 }))
    expect(await legacyFingerprint(-0)).not.toBe(await legacyFingerprint(0))
    expect(await legacyFingerprint(8.12345678901234)).not.toBe(
      await legacyFingerprint(8.12345678901235),
    )
    expect(await legacyFingerprint(new Blob(['abc']))).not.toBe(
      await legacyFingerprint(new Blob(['abd'])),
    )
    expect(await legacyFingerprint({ type: 'blob', hash: 'abc' })).not.toBe(
      await legacyFingerprint(new Blob(['abc'])),
    )
  })

  it('captures 128 MiB of bounded media with distinct original media identities', async () => {
    const fixture = await setup()
    const block = new Blob([new Uint8Array(8 * 1024 * 1024).fill(37)], { type: 'image/png' })
    const db = await request(fixture.factory.open(fixture.name))
    const tx = db.transaction(['assets', 'media', 'meta'], 'readwrite'),
      complete = done(tx)
    for (let index = 0; index < 16; index++) {
      const media = {
        id: `bulk-original-${index}`,
        name: `sample-${index}.png`,
        type: 'image/png' as const,
        size: block.size,
        createdAt: now.toISOString(),
      }
      const position = fixture.library.media.length
      fixture.library.media.push(media)
      tx.objectStore('assets').put(block, media.id)
      tx.objectStore('media').put({ id: media.id, value: media, position }, media.id)
    }
    tx.objectStore('meta').put(
      {
        revision: 17,
        counts: Object.fromEntries(
          recordStores.map((name) => [name, fixture.library[name].length]),
        ),
      },
      'main',
    )
    await complete
    db.close()
    const result = await captureLegacyInventory(fixture.input)
    expect(result.status).toBe('ready')
    expect(result.report!.assetBytes).toBe(
      128 * 1024 * 1024 +
        fixture.library.media.slice(0, 2).reduce((size, media) => size + media.size, 0),
    )
    expect(result.snapshot!.main.stores.media).toHaveLength(18)
    expect(result.snapshot!.main.stores.assets).toHaveLength(18)
    expect(result.snapshot!.main.stores.assets!.some(({ key }) => key === 'bulk-original-15')).toBe(
      true,
    )
  }, 20_000)

  it('refuses an oversized individual blob before materializing its bytes', async () => {
    const blob = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])
    const read = vi.spyOn(blob, 'arrayBuffer')
    await expect(legacyFingerprint(blob)).rejects.toThrow('legacy-blob-too-large')
    expect(read).not.toHaveBeenCalled()
  })
})
