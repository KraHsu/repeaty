import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { openDB } from 'idb'
import { fixture, now } from './test-fixtures'
import { materialCollectionSchema } from './collection-data'
import { workspaceLibrarySchema } from './model'
import { createRepository, recordStores } from './storage'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { exportArchive, parseArchive } from './archive'
import { operationFor, revertOperation, replayOperation } from './operations'
import { BrowserWorkspaceReader } from '../browser/workspace-reader'
import { selectedFile, workspaceFixture } from '../browser/test-fixtures'

const collection = () =>
  materialCollectionSchema.parse({
    id: 'collection',
    name: 'Reading list',
    sourceIds: ['missing-source', 'another-source'],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })

it('upgrades an existing IDB23 library without losing its records or revision', async () => {
  const name = `p7-collections-upgrade-${crypto.randomUUID()}`
  const before = fixture()
  const oldStores = recordStores.filter((store) => store !== 'materialCollections')
  const old = await openDB(name, 23, {
    upgrade(db) {
      db.createObjectStore('meta')
      for (const store of oldStores) {
        const table = db.createObjectStore(store)
        table.createIndex('position', 'position')
        table.createIndex('deckId', ['deckId', 'position'])
      }
    },
  })
  const tx = old.transaction(['meta', ...oldStores], 'readwrite')
  await tx.objectStore('meta').put(
    {
      revision: 7,
      counts: Object.fromEntries(oldStores.map((store) => [store, before[store].length])),
    },
    'main',
  )
  for (const store of oldStores)
    for (const [position, value] of before[store].entries())
      await tx.objectStore(store).put({ id: value.id, value, position }, value.id)
  await tx.done
  expect(old.objectStoreNames.contains('materialCollections')).toBe(false)
  old.close()
  const repo = createRepository(name)
  try {
    const loaded = await repo.load()
    expect(loaded).toMatchObject({ revision: 7, library: before })
    const saved = await repo.save({ ...loaded.library, materialCollections: [collection()] }, 7)
    expect(saved.library.notes).toEqual(before.notes)
    expect(saved.library.cards).toEqual(before.cards)
    expect(saved.library.materialCollections).toEqual([collection()])
  } finally {
    await repo.close()
  }
  const upgraded = await openDB(name)
  expect(upgraded.version).toBe(24)
  expect(upgraded.objectStoreNames.contains('materialCollections')).toBe(true)
  upgraded.close()
})

it('preserves ordered soft references and archived collections in portable backups', async () => {
  const library = { ...fixture(), materialCollections: [{ ...collection(), archived: true }] }
  const json = await exportBackup(library, async () => undefined)
  const archive = (await exportArchive(library, async () => undefined))!
  for (const data of [parseBackup(json), await parseArchive(archive)]) {
    expect(data.library.materialCollections).toEqual(library.materialCollections)
    expect(rekeyBackup(data).library.materialCollections).toEqual(library.materialCollections)
  }
  expect(
    workspaceLibrarySchema.safeParse({
      ...library,
      materialCollections: [collection(), collection()],
    }).success,
  ).toBe(false)
  expect(
    materialCollectionSchema.safeParse({ ...collection(), sourceIds: ['same', 'same'] }).success,
  ).toBe(false)
})

it('includes collection changes in atomic save, undo, checkpoints, and restart', async () => {
  const name = `p7-collections-${crypto.randomUUID()}`
  const repo = createRepository(name)
  const original = { ...fixture(), materialCollections: [collection()] }
  try {
    await repo.save(original, 0)
    const next = {
      ...original,
      materialCollections: [
        { ...collection(), archived: true, sourceIds: ['another-source', 'missing-source'] },
      ],
    }
    const operation = operationFor(original, next, 'local:test', '修改')!
    expect(operation.changes.some((change) => change.store === 'materialCollections')).toBe(true)
    const undone = revertOperation(next, operation)
    expect(undone.materialCollections).toEqual(original.materialCollections)
    expect(replayOperation(undone, operation).materialCollections).toEqual(next.materialCollections)
    await repo.save(next, 1, { reason: 'Before archiving' })
    const backups = await repo.listBackups()
    expect(backups.length).toBeGreaterThan(0)
    expect((await repo.getBackup(backups[0]!.id)).materialCollections).toEqual(
      original.materialCollections,
    )
  } finally {
    await repo.close()
  }
  const reopened = createRepository(name)
  try {
    expect((await reopened.load()).library.materialCollections[0]).toMatchObject({
      archived: true,
      sourceIds: ['another-source', 'missing-source'],
    })
  } finally {
    await reopened.close()
  }
})

it('reads SQLite collections without modifying selected files and enforces the gate17 table', async () => {
  const SQL = await initSqlJs()
  const env = await workspaceFixture(SQL, { ...fixture(), materialCollections: [collection()] })
  env.db.run(
    'PRAGMA user_version=17; CREATE TABLE operation_history(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE source_drafts(id TEXT PRIMARY KEY,data TEXT)',
  )
  const index = env.files.findIndex((file) =>
    file.webkitRelativePath.endsWith('/.repeaty/state.sqlite3'),
  )
  env.files[index] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  const bytes = new Uint8Array(await env.files[index]!.arrayBuffer())
  const reader = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
  expect(reader.snapshot.library.materialCollections).toEqual([collection()])
  reader.close()
  expect(new Uint8Array(await env.files[index]!.arrayBuffer())).toEqual(bytes)
  env.db.run('DROP TABLE materialCollections')
  env.files[index] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  await expect(
    BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files }),
  ).rejects.toThrow()
  env.db.run('PRAGMA user_version=16')
  env.files[index] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  const old = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
  expect(old.snapshot.library.materialCollections).toEqual([])
  old.close()
  env.db.close()
})
