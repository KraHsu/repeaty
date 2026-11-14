import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { fixture, now } from './test-fixtures'
import { createRepository } from './storage'
import { automationReceiptSchema } from './automation-data'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { exportArchive, parseArchive } from './archive'
import { operationFor, revertOperation, replayOperation } from './operations'
import { operationHistory } from './operation-history'
import { saveNote } from './model'
import { BrowserWorkspaceReader } from '../browser/workspace-reader'
import { selectedFile, workspaceFixture } from '../browser/test-fixtures'

const receipt = () =>
  automationReceiptSchema.parse({
    id: 'receipt',
    actorId: 'plugin:assistant',
    requestId: 'request-1',
    operationId: 'undo-1',
    fingerprint: 'a'.repeat(64),
    createdAt: now.toISOString(),
    result: {
      revision: 2,
      resultIds: { sources: [], folders: [], notes: ['historical-note'], decks: [], cards: [] },
    },
  })

it('round-trips receipts in JSON/archive and clears origin-scoped retry keys on portable rekey', async () => {
  const library = { ...fixture(), automationReceipts: [receipt()] }
  const json = await exportBackup(library, async () => undefined)
  expect(JSON.parse(json).version).toBe(19)
  const archive = (await exportArchive(library, async () => undefined))!
  for (const data of [parseBackup(json), await parseArchive(archive)]) {
    expect(data.library.automationReceipts).toEqual(library.automationReceipts)
    expect(rekeyBackup(data).library.automationReceipts).toEqual([])
  }
})

it('commits receipts atomically, preserves them across undo/replay/restart and rejects rewrites', async () => {
  const name = `p7-receipts-${crypto.randomUUID()}`
  const repo = createRepository(name)
  const before = fixture()
  try {
    await repo.save(before, 0)
    const next = {
      ...saveNote(
        before,
        { ...before.notes[0]!, front: 'Edited' },
        before.notes[0]!.id,
        false,
        now,
      ),
      automationReceipts: [receipt()],
    }
    const operation = operationFor(before, next, 'local:test', '修改')!
    expect(operation.changes.every((value) => value.store !== 'automationReceipts')).toBe(true)
    const saved = await repo.save(next, 1, {
      reason: 'Before automation',
      operationHistory: operationHistory([operation]),
    })
    const undone = revertOperation(saved.library, operation)
    expect(undone.automationReceipts).toEqual(next.automationReceipts)
    expect(replayOperation(undone, operation).automationReceipts).toEqual(next.automationReceipts)
    await repo.save(undone, 2, { operationHistory: operationHistory([], [operation]) })
    const forged = {
      ...undone,
      automationReceipts: [{ ...receipt(), fingerprint: 'b'.repeat(64) }],
    }
    await expect(repo.save(forged, 3)).rejects.toThrow('immutable')
    const duplicate = {
      ...undone,
      automationReceipts: [receipt(), { ...receipt(), id: 'different-id' }],
    }
    await expect(repo.save(duplicate, 3)).rejects.toThrow('Duplicate')
    expect((await repo.load()).revision).toBe(3)
  } finally {
    await repo.close()
  }
  const reopened = createRepository(name)
  try {
    const loaded = await reopened.load()
    expect(loaded.library.notes[0]!.front).toBe(before.notes[0]!.front)
    expect(loaded.library.automationReceipts).toEqual([receipt()])
    expect(loaded.operationHistory?.redo).toHaveLength(1)
  } finally {
    await reopened.close()
  }
})

it('reads SQLite gate17 receipts without writing selected bytes and rejects a missing gated store', async () => {
  const SQL = await initSqlJs()
  const library = { ...fixture(), automationReceipts: [receipt()] }
  const env = await workspaceFixture(SQL, library)
  env.db.run(
    'PRAGMA user_version=17; CREATE TABLE operation_history(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE source_drafts(id TEXT PRIMARY KEY,data TEXT)',
  )
  const index = env.files.findIndex((file) =>
    file.webkitRelativePath.endsWith('/.repeaty/state.sqlite3'),
  )
  env.files[index] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  const bytes = new Uint8Array(await env.files[index]!.arrayBuffer())
  const reader = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
  expect(reader.snapshot.library.automationReceipts).toEqual([receipt()])
  reader.close()
  expect(new Uint8Array(await env.files[index]!.arrayBuffer())).toEqual(bytes)
  env.db.run('DROP TABLE automationReceipts')
  env.files[index] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  await expect(
    BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files }),
  ).rejects.toThrow()
  env.db.close()
})
