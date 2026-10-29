import { beforeAll, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { fixture, input, now } from '../core/test-fixtures'
import { reviewCard, undoReview } from '../core/scheduler'
import { saveNote, removeNotes } from '../core/model'
import { practiceHistoryFixture } from '../../tests/fixtures/practice-history'
import { BrowserWorkspaceReader } from './workspace-reader'
import { createBrowserRepository } from './repository'
import { workspaceFixture } from './test-fixtures'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})
async function start(library = fixture()) {
  const env = await workspaceFixture(SQL, library)
  const reader = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
  const source = {
    snapshot: reader.snapshot,
    media: vi.fn((id: string) => reader.media(id)),
    attempts: vi.fn(async (ids: string[]) => reader.attempts(ids)),
    close: vi.fn(() => reader.close()),
  }
  const changed = vi.fn(),
    repo = createBrowserRepository(source, changed)
  return {
    env,
    repo,
    source,
    changed,
    async close() {
      await repo.close()
      env.db.close()
    },
  }
}
it('grades, undoes and edits a separate copy without re-reading directory bytes or code', async () => {
  const context = await start()
  const before = await context.repo.load()
  const graded = await context.repo.save(
    reviewCard(before.library, before.library.cards[0]!.id, 1, now),
    before.revision,
  )
  expect(graded.library.reviews).toHaveLength(1)
  const undone = await context.repo.save(undoReview(graded.library), graded.revision)
  expect(undone.library).toEqual(before.library)
  const edited = await context.repo.save(
    saveNote(undone.library, { ...input, front: '副本编辑' }, undone.library.notes[0]!.id),
    undone.revision,
  )
  expect(edited.library.notes[0]!.front).toBe('副本编辑')
  expect(context.source.snapshot.library.notes[0]!.front).toBe('Question')
  expect(context.source.media).not.toHaveBeenCalled()
  expect(context.source.attempts).not.toHaveBeenCalled()
  expect(context.changed).toHaveBeenCalledTimes(3)
  await context.close()
})
it('keeps full code on demand and preserves older code versions in snapshots', async () => {
  const original = practiceHistoryFixture(3),
    context = await start(original)
  const before = await context.repo.load()
  expect(before.library.attempts.every((row) => row.code === undefined)).toBe(true)
  const initial = await context.repo.getAttempt(original.attempts[0]!.id)
  expect(initial).toEqual(original.attempts[0])
  const modified = await context.repo.save(
    {
      ...before.library,
      attempts: before.library.attempts.map((row) =>
        row.id === initial.id ? { ...initial, code: '第二个版本' } : row,
      ),
    },
    before.revision,
    { reason: '编辑代码前' },
  )
  const oldBackup = (await context.repo.listBackups()).find(
    (entry) => entry.revision === before.revision,
  )!
  expect((await context.repo.getBackup(oldBackup.id)).attempts[0]!.code).toBe(initial.code)
  const third = await context.repo.save(
    {
      ...modified.library,
      attempts: modified.library.attempts.map((row) =>
        row.id === initial.id ? { ...initial, code: '第三个版本' } : row,
      ),
    },
    modified.revision,
    { reason: '编辑代码前' },
  )
  const secondBackup = (await context.repo.listBackups()).find(
    (entry) => entry.revision === modified.revision,
  )!
  expect((await context.repo.getBackup(secondBackup.id)).attempts[0]!.code).toBe('第二个版本')
  expect((await context.repo.completeLibrary()).attempts[0]!.code).toBe('第三个版本')
  const removed = await context.repo.save(
    removeNotes(third.library, new Set(third.library.notes.map((row) => row.id))),
    third.revision,
    { reason: '删除前' },
  )
  await expect(context.repo.getAttempt(initial.id, removed.revision)).rejects.toThrow('已不存在')
  expect((await context.repo.getBackup(secondBackup.id)).attempts[0]!.code).toBe('第二个版本')
  await context.close()
})
it('rejects stale saves, invalid summary edits, cancellation and use after closing', async () => {
  const context = await start(practiceHistoryFixture(1)),
    before = await context.repo.load()
  await expect(
    context.repo.save(
      {
        ...before.library,
        attempts: before.library.attempts.map((row) => ({ ...row, status: 'failed' })),
      },
      before.revision,
    ),
  ).rejects.toThrow()
  expect(await context.repo.load()).toEqual(before)
  await expect(context.repo.save(before.library, before.revision - 1)).rejects.toThrow('已变化')
  const controller = new AbortController()
  controller.abort()
  await expect(
    context.repo.getAttempt(before.library.attempts[0]!.id, before.revision, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  await context.repo.close()
  await expect(context.repo.load()).rejects.toMatchObject({ code: 'closed' })
  expect(context.source.close).toHaveBeenCalledTimes(1)
  await context.close()
})
