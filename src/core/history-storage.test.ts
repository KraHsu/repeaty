import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, it } from 'vitest'
import { createRepository, recordStores } from './storage'
import { librarySchema, removeNotes } from './model'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup } from './backups'
import { practiceHistoryFixture } from '../../tests/fixtures/practice-history'

it('keeps code out of a compact workspace, reads bodies on demand, and backs up every byte', async () => {
  const name = `repeaty-compact-${crypto.randomUUID()}`
  const library = practiceHistoryFixture(257)
  library.attempts[0]!.code = '题目与代码\n'.repeat(5000)
  library.attempts[0]!.result!.detail = '裁判输出\n'.repeat(1000)
  const repo = createRepository(name, undefined, { compactHistory: true })
  const saved = await repo.save(library, 0)
  expect(saved.library.attempts).toHaveLength(257)
  expect(saved.library.attempts.every((entry) => entry.code === undefined)).toBe(true)
  expect(saved.library.attempts[0]!.result?.detail).toBeUndefined()
  expect(librarySchema.safeParse(saved.library).success).toBe(false)
  expect(await repo.getAttempt(library.attempts[0]!.id, saved.revision)).toEqual(
    library.attempts[0],
  )
  const archive = (await exportArchive(saved.library, async () => undefined, {
    readAttempts: (offset) => repo.readAttemptBatch(offset, saved.revision),
  }))!
  expect((await parseArchive(archive)).library).toEqual(library)
  const full = await repo.completeLibrary()
  expect(parseBackup(await exportBackup(full, async () => undefined)).library).toEqual(library)
  // A caller must not accidentally serialize metadata as a complete submission.
  await expect(exportArchive(saved.library, async () => undefined)).rejects.toThrow('不完整')
  await expect(
    exportArchive(saved.library, async () => undefined, {
      readAttempts: async () => [],
    }),
  ).rejects.toThrow('不完整')
  await repo.close()
  const reopened = createRepository(name, undefined, { compactHistory: true })
  expect((await reopened.load()).library).toEqual(saved.library)
  expect(await reopened.getAttempt(library.attempts[0]!.id)).toEqual(library.attempts[0])
  await reopened.close()
})

it('rejects incomplete edits and stale reads, and restores deleted bodies from checkpoints', async () => {
  const name = `repeaty-compact-delete-${crypto.randomUUID()}`
  const library = practiceHistoryFixture(3)
  const repo = createRepository(name, undefined, { compactHistory: true })
  const saved = await repo.save(library, 0)
  await expect(
    repo.save(
      {
        ...saved.library,
        attempts: saved.library.attempts.map((entry, index) =>
          index === 0 ? { ...entry, status: 'failed' } : entry,
        ),
      },
      1,
    ),
  ).rejects.toThrow()
  expect(await repo.getAttempt(library.attempts[0]!.id, 1)).toEqual(library.attempts[0])
  await repo.backupNow(true)
  const checkpoint = (await repo.listBackups())[0]!
  const removed = await repo.save(
    removeNotes(saved.library, new Set(library.notes.map((note) => note.id))),
    1,
  )
  expect(removed.library.attempts).toEqual([])
  await expect(repo.readAttemptBatch(0, 1)).rejects.toThrow('另一个标签页')
  await expect(repo.getAttempt(library.attempts[0]!.id, 2)).rejects.toThrow('已不存在')
  const db = await openDB(name, 18)
  expect(await db.count('attemptSummaries')).toBe(0)
  db.close()
  const restored = await repo.save(await repo.getBackup(checkpoint.id), 2)
  expect(restored.library.attempts).toHaveLength(3)
  expect(await repo.completeLibrary()).toEqual(library)
  const controller = new AbortController()
  controller.abort()
  await expect(
    repo.getAttempt(library.attempts[0]!.id, 3, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  await repo.close()
})

it('upgrades v6 in place with full bodies and checkpoints intact and rejects the old writer', async () => {
  const name = `repeaty-history-v6-${crypto.randomUUID()}`
  const library = practiceHistoryFixture(3)
  const old = await openDB(name, 6, {
    upgrade(db) {
      for (const store of [
        'workspace',
        'assets',
        'backups',
        'meta',
        'checkpoints',
        'history',
        ...recordStores,
      ])
        db.createObjectStore(store)
    },
  })
  const tx = old.transaction([...recordStores, 'meta', 'checkpoints'], 'readwrite')
  for (const store of recordStores)
    for (const [position, value] of library[store].entries())
      await tx.objectStore(store).put({ id: value.id, position, value }, value.id)
  await tx.objectStore('meta').put(
    {
      revision: 9,
      counts: Object.fromEntries(recordStores.map((store) => [store, library[store].length])),
    },
    'main',
  )
  await tx.objectStore('checkpoints').put(
    {
      id: 'before-upgrade',
      revision: 9,
      createdAt: '2026-10-18T00:00:00.000Z',
      reason: '手动快照',
      notes: library.notes.length,
      cards: library.cards.length,
    },
    'before-upgrade',
  )
  await tx.done
  old.close()
  const repo = createRepository(name, undefined, { compactHistory: true })
  const loaded = await repo.load()
  expect(loaded.revision).toBe(9)
  expect(loaded.library.attempts.map((entry) => entry.id)).toEqual(
    library.attempts.map((entry) => entry.id),
  )
  expect(loaded.library.attempts.every((entry) => entry.code === undefined)).toBe(true)
  expect(await repo.getBackup('before-upgrade')).toEqual(library)
  expect(await repo.completeLibrary()).toEqual(library)
  await expect(openDB(name, 6)).rejects.toMatchObject({ name: 'VersionError' })
  await repo.close()
})

it('aborts the schema upgrade on a malformed old row without advancing the database version', async () => {
  const name = `repeaty-history-invalid-v6-${crypto.randomUUID()}`
  const old = await openDB(name, 6, {
    upgrade(db) {
      db.createObjectStore('attempts')
    },
  })
  const row = { id: 'broken', value: null, position: 0 }
  await old.put('attempts', row, row.id)
  old.close()
  const repo = createRepository(name, undefined, { compactHistory: true })
  await expect(repo.load()).rejects.toMatchObject({ name: 'AbortError' })
  const intact = await openDB(name, 6)
  expect(await intact.get('attempts', row.id)).toEqual(row)
  expect(intact.objectStoreNames.contains('attemptSummaries')).toBe(false)
  intact.close()
})
