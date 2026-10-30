import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { generatorParameters } from 'ts-fsrs'
import { fixture, now } from './test-fixtures'
import { fsrsModelSchema } from './study-data'
import { studySettingsSchema } from './study-settings'
import { createRepository } from './storage'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { exportArchive, parseArchive } from './archive'
import { BrowserWorkspaceReader } from '../browser/workspace-reader'
import { createBrowserRepository } from '../browser/repository'
import { workspaceFixture, selectedFile } from '../browser/test-fixtures'

function populated() {
  const library = fixture()
  library.studySettings = [
    studySettingsSchema.parse({
      dayStartHour: 4,
      priorityMode: 'weighted',
      activeFsrsModelId: 'global',
      statisticsSince: now.toISOString(),
    }),
  ]
  library.fsrsModels = [
    fsrsModelSchema.parse({
      id: 'global',
      createdAt: now.toISOString(),
      modelVersion: 'FSRS-6',
      weights: generatorParameters().w,
      baselineWeights: generatorParameters().w,
      historyFingerprint: 'a'.repeat(64),
      counts: { reviews: 1024, cards: 200, training: 800, validation: 224, excluded: 0 },
      metrics: { baseline: { logLoss: 0.7, rmse: 0.4 }, candidate: { logLoss: 0.6, rmse: 0.3 } },
      engine: 'test',
    }),
  ]
  library.studyEvents = [
    {
      id: 'reading',
      kind: 'reading',
      sourceId: 'deleted-source',
      occurredAt: now.toISOString(),
      studyDay: '2026-10-17',
    },
  ]
  library.studyActivity = [
    {
      id: 'activity',
      kind: 'reading',
      studyDay: '2026-10-17',
      startedAt: now.toISOString(),
      endedAt: new Date(now.getTime() + 60000).toISOString(),
      activeMs: 45000,
    },
  ]
  library.decks[0]!.studyPriority = 3
  library.notes[0]!.studyPriority = 0
  return library
}

it('round-trips every study store and exact weights through JSON and archive v16, without rewriting historical day keys', async () => {
  const library = populated()
  const text = await exportBackup(library, async () => undefined)
  expect(JSON.parse(text).version).toBe(19)
  const archive = (await exportArchive(library, async () => undefined))!
  const zip = new ZipReader(new BlobReader(archive), { useWebWorkers: false })
  try {
    const manifest = (await zip.getEntries()).find((entry) => entry.filename === 'manifest.json')!
    if (manifest.directory) throw new Error('missing manifest')
    expect(JSON.parse(await (await manifest.getData(new BlobWriter())).text())).toMatchObject({
      version: 16,
      libraryVersion: 19,
      counts: { studySettings: 1, studyEvents: 1, studyActivity: 1, fsrsModels: 1 },
    })
  } finally {
    await zip.close()
  }
  for (const saved of [parseBackup(text), await parseArchive(archive)]) {
    expect(saved.library).toEqual(library)
    expect(rekeyBackup(saved).library).toEqual(library)
  }
  const original = new ZipReader(new BlobReader(archive), { useWebWorkers: false })
  const output = new BlobWriter()
  const forged = new ZipWriter(output, { useWebWorkers: false })
  try {
    for (const entry of await original.getEntries()) {
      if (entry.directory) continue
      let blob = await entry.getData(new BlobWriter())
      if (entry.filename === 'manifest.json') {
        const manifest = JSON.parse(await blob.text())
        manifest.version = 14
        manifest.libraryVersion = 17
        blob = new Blob([JSON.stringify(manifest)])
      }
      await forged.add(entry.filename, new BlobReader(blob))
    }
    await forged.close()
    await expect(parseArchive(await output.getData())).rejects.toThrow()
  } finally {
    await original.close()
  }
})

it('persists study deltas and checkpoint history, and rejects invalid model selections atomically', async () => {
  const name = `repeaty-study-${crypto.randomUUID()}`
  const repo = createRepository(name)
  try {
    const first = await repo.save(populated(), 0, { now })
    const changed = {
      ...first.library,
      studySettings: [{ ...first.library.studySettings[0]!, dayStartHour: 6 }],
      studyEvents: [],
    }
    const second = await repo.save(changed, first.revision, { now })
    const db = await openDB(name)
    try {
      expect(await db.count('fsrsModels')).toBe(1)
      expect((await db.getAll('history')).map((row) => row.store).sort()).toEqual([
        'studyEvents',
        'studySettings',
      ])
      await expect(openDB(name, 21)).rejects.toMatchObject({ name: 'VersionError' })
    } finally {
      db.close()
    }
    expect(await repo.getBackup((await repo.listBackups())[0]!.id)).toEqual(first.library)
    const invalid = { ...changed, fsrsModels: [] }
    await expect(repo.save(invalid, second.revision)).rejects.toThrow()
    expect((await repo.load()).library).toEqual(changed)
    await repo.close()
    const reopened = createRepository(name)
    try {
      expect((await reopened.load()).library).toEqual(changed)
    } finally {
      await reopened.close()
    }
  } finally {
    await repo.close()
  }
})

it('reads gate16 study records into a browser copy and never changes selected workspace bytes', async () => {
  const SQL = await initSqlJs()
  const library = populated()
  const env = await workspaceFixture(SQL, library)
  env.db.run(
    'PRAGMA user_version=16; CREATE TABLE operation_history(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE source_drafts(id TEXT PRIMARY KEY,data TEXT)',
  )
  const fileIndex = env.files.findIndex((file) =>
    file.webkitRelativePath.endsWith('/.repeaty/state.sqlite3'),
  )
  env.files[fileIndex] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  const original = new Uint8Array(await env.files[fileIndex]!.arrayBuffer())
  const reader = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
  const repo = createBrowserRepository(
    {
      snapshot: reader.snapshot,
      media: (id) => reader.media(id),
      attempts: async (ids) => reader.attempts(ids),
      retiredNotes: async (ids) => reader.retiredNotes(ids),
      close: () => reader.close(),
    },
    () => {},
  )
  try {
    const before = await repo.load()
    expect(before.library).toEqual(library)
    const changed = {
      ...before.library,
      studySettings: [{ ...before.library.studySettings[0]!, dayStartHour: 8 }],
    }
    const saved = await repo.save(changed, before.revision)
    const badActivity = {
      ...changed,
      studyActivity: [{ ...changed.studyActivity[0]!, activeMs: 60001 }],
    }
    await expect(repo.save(badActivity, saved.revision)).rejects.toThrow()
    const duplicate = {
      ...changed,
      studyEvents: [changed.studyEvents[0]!, changed.studyEvents[0]!],
    }
    await expect(repo.save(duplicate, saved.revision)).rejects.toThrow()
    expect((await repo.load()).library.studySettings[0]!.dayStartHour).toBe(8)
    expect(reader.snapshot.library).toEqual(library)
    expect(new Uint8Array(await env.files[fileIndex]!.arrayBuffer())).toEqual(original)
  } finally {
    await repo.close()
  }
  env.db.run(
    'PRAGMA user_version=18; CREATE TABLE sync_state(id INTEGER PRIMARY KEY,group_id TEXT,clock TEXT)',
  )
  env.files[fileIndex] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  const syncOriginal = new Uint8Array(await env.files[fileIndex]!.arrayBuffer())
  const synced = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
  expect(synced.snapshot.library).toEqual(library)
  synced.close()
  expect(new Uint8Array(await env.files[fileIndex]!.arrayBuffer())).toEqual(syncOriginal)
  env.db.run('PRAGMA user_version=19')
  env.files[fileIndex] = selectedFile('.repeaty/state.sqlite3', env.db.export())
  await expect(
    BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files }),
  ).rejects.toThrow()
  env.db.close()
})
