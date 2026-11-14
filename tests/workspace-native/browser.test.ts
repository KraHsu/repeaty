import { beforeAll, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { browserWorkspaceFixture, directoryDigest } from '../fixtures/browser-workspace'
import { selectedFile } from '../../src/browser/test-fixtures'
import { BrowserWorkspaceReader } from '../../src/browser/workspace-reader'
import { createBrowserRepository } from '../../src/browser/repository'
import { reviewCard, undoReview } from '../../src/core/scheduler'
import { now } from '../../src/core/test-fixtures'
import { exportArchive, parseArchive } from '../../src/core/archive'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})
it('opens a real closed Rust workspace with WASM, keeps historical text and code, and never writes the directory', async () => {
  const env = await browserWorkspaceFixture()
  try {
    const before = await directoryDigest(env.path)
    const files = await Promise.all(
      Object.keys(before).map(async (path) =>
        selectedFile(path, new Uint8Array(await readFile(join(env.path, path)))),
      ),
    )
    const reader = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files })
    expect(reader.snapshot.library).toEqual(env.library)
    const source = reader.snapshot.library.sources.find((source) => source.id === env.sourceId)!
    expect(await (await reader.media(source.mediaId))!.text()).toBe(env.text)
    expect(await (await reader.media(source.versions![0]!.mediaId))!.text()).toBe(env.oldText)
    expect(source.versions![0]!.reading!.offset).toBe(60000)
    const repo = createBrowserRepository({
      snapshot: reader.snapshot,
      media: (id) => reader.media(id),
      attempts: async (ids) => reader.attempts(ids),
      close: () => reader.close(),
    })
    const loaded = await repo.load()
    const graded = await repo.save(
      reviewCard(loaded.library, env.card.id, 1, new Date(now.getTime() + 40 * 86400_000)),
      loaded.revision,
    )
    expect(graded.library.reviews).toHaveLength(2)
    const undone = await repo.save(undoReview(graded.library), graded.revision)
    expect(undone.library).toEqual(loaded.library)
    const archive = (await exportArchive(undone.library, (id) => repo.getMedia(id), {
      readAttempts: (offset) => repo.readAttemptBatch(offset, undone.revision),
    }))!
    const exported = await parseArchive(archive)
    expect(exported.library.notes).toEqual(env.library.notes)
    expect(exported.library.attempts).toHaveLength(3)
    expect(exported.library.attempts[0]!.code).toContain('attempt 0')
    expect(exported.assets).toHaveLength(env.assets.length)
    await repo.close()
    expect(await directoryDigest(env.path)).toEqual(before)
  } finally {
    await env.close()
  }
})
