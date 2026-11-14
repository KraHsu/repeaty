import { beforeAll, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { fixture, input, now } from '../core/test-fixtures'
import { reviewCard, undoReview } from '../core/scheduler'
import { saveNote, removeNotes, type MediaUpload } from '../core/model'
import { prepareSource, addSource, removeSource } from '../core/sources'
import { practiceHistoryFixture } from '../../tests/fixtures/practice-history'
import { BrowserWorkspaceReader } from './workspace-reader'
import { createBrowserRepository } from './repository'
import { workspaceFixture } from './test-fixtures'
import { noteLifecycle, type RetiredNote } from '../desktop/retirement'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})
async function start(library = fixture(), assets: MediaUpload[] = []) {
  const env = await workspaceFixture(SQL, library, assets)
  const reader = await BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
  const source = {
    snapshot: reader.snapshot,
    media: vi.fn((id: string) => reader.media(id)),
    attempts: vi.fn(async (ids: string[]) => reader.attempts(ids)),
    retiredNotes: vi.fn(async (ids?: string[]) => reader.retiredNotes(ids)),
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
it('marks in-memory body drafts as unsaved trial changes while leaving the original directory untouched', async () => {
  const prepared = prepareSource(
    { title: 'Material', content: 'Original', url: '', format: 'markdown' },
    now,
  )
  const context = await start(addSource(fixture(), prepared.source, prepared.asset), [
    prepared.asset,
  ])
  const before = await context.repo.load()
  const draft = {
    id: crypto.randomUUID(),
    sourceId: prepared.source.id,
    mediaId: prepared.source.mediaId,
    scope: context.repo.scope(),
    content: 'Only in this page',
    properties: '',
    title: 'Material',
    url: '',
    updatedAt: now.toISOString(),
  }
  await context.repo.writeSourceDraft(draft)
  expect(context.changed).toHaveBeenCalledOnce()
  expect(await context.repo.readSourceDraft(prepared.source.id)).toEqual(draft)
  expect(await context.repo.load()).toEqual(before)
  expect(context.source.snapshot.sourceDrafts ?? []).toEqual([])
  await context.repo.discardSourceDraft(prepared.source.id, 'wrong-draft')
  expect(context.changed).toHaveBeenCalledOnce()
  await context.repo.discardSourceDraft(prepared.source.id, draft.id)
  expect(context.changed).toHaveBeenCalledTimes(2)
  expect(await context.repo.readSourceDraft(prepared.source.id)).toBeUndefined()
  expect(await context.repo.load()).toEqual(before)
  await context.close()
})
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
  expect(context.source.retiredNotes).not.toHaveBeenCalled()
  expect(context.changed).toHaveBeenCalledTimes(3)
  await context.close()
})

it('retires and restores plugin variants with exact history only inside the read-only trial copy', async () => {
  let library = fixture({
    type: 'plugin',
    plugin: { id: 'visual-occlusion', version: 1, data: {}, variants: ['a', 'b'] },
  })
  library.decks[0]!.burySiblings = false
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  const note = library.notes[0]!,
    card = library.cards[0]!
  library.practices = [
    {
      id: 'trial-practice',
      cardId: card.id,
      contentRevision: 'original',
      question: { front: note.front, back: note.back, format: note.format, plugin: note.plugin! },
      startedAt: now.toISOString(),
    },
  ]
  library.attempts = [
    {
      id: 'trial-attempt',
      practiceId: 'trial-practice',
      language: 'text',
      code: 'complete original answer\n'.repeat(100),
      status: 'failed',
      elapsedMs: 1,
      submittedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ]
  const context = await start(library),
    before = await context.repo.load()
  const reduced = noteLifecycle(
    before.library,
    { ...note, plugin: { ...note.plugin!, variants: ['b'] } },
    note.id,
    await context.repo.retiredNote(note.id),
    true,
  ).library
  const saved = await context.repo.save(reduced, before.revision, { reason: 'retire region' })
  const retired = await context.repo.retiredNote(note.id)
  expect(retired.cards).toEqual([card])
  expect(retired.attempts).toEqual(library.attempts)
  expect(retired.reviews).toEqual(library.reviews)
  expect(context.source.attempts).toHaveBeenCalledWith(['trial-attempt'])
  await context.repo.backupNow(true)
  const checkpoint = (await context.repo.listBackups()).find(
    (item) => item.revision === saved.revision,
  )!
  const restored = noteLifecycle(saved.library, note, note.id, retired).library
  const result = await context.repo.save(restored, saved.revision)
  expect((await context.repo.completeLibrary()).attempts).toEqual(library.attempts)
  expect(result.library.cards.find((item) => item.id === card.id)).toEqual(card)
  expect(await context.repo.retiredNotes()).toEqual([])
  expect((await context.repo.retiredNotes(checkpoint.id))[0]!.attempts).toEqual(library.attempts)
  const old = await context.repo.getBackup(checkpoint.id),
    history = await context.repo.retiredNotes(checkpoint.id)
  await context.repo.save(old, result.revision, { retired: history })
  expect((await context.repo.retiredNote(note.id)).cards).toEqual([card])
  const snapshot = await context.repo.load(),
    bad: RetiredNote[] = structuredClone(history)
  delete bad[0]!.attempts[0]!.code
  await expect(
    context.repo.save(snapshot.library, snapshot.revision, { retired: bad }),
  ).rejects.toThrow()
  expect((await context.repo.load()).revision).toBe(snapshot.revision)
  expect(context.source.snapshot.library.cards).toEqual(library.cards)
  const original = await BrowserWorkspaceReader.open(SQL, {
    kind: 'files',
    files: context.env.files,
  })
  expect(original.snapshot.library.cards).toEqual(library.cards)
  original.close()
  await context.close()
})

it('rejects a retired-record read that completes after the trial is closed', async () => {
  const context = await start()
  let finish!: (records: RetiredNote[]) => void
  context.source.retiredNotes.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = context.repo.retiredNote('late'),
    rejected = expect(pending).rejects.toThrow()
  await context.close()
  finish([])
  await rejected
})

it('protects retired card source references while ordinary grading still avoids retired reads', async () => {
  const prepared = prepareSource(
    { title: 'Origin', url: '', format: 'plain', content: 'Original text' },
    now,
  )
  let library = fixture({
    type: 'plugin',
    plugin: { id: 'visual-occlusion', version: 1, data: {}, variants: ['a', 'b'] },
  })
  library.decks[0]!.burySiblings = false
  library = addSource(library, prepared.source, prepared.asset)
  const note = library.notes[0]!
  note.excerpt = {
    sourceId: prepared.source.id,
    mediaId: prepared.source.mediaId,
    start: 0,
    end: 8,
    quote: 'Original',
  }
  const context = await start(library, [prepared.asset]),
    first = await context.repo.load()
  const reduced = noteLifecycle(
    first.library,
    { ...note, excerpt: undefined, plugin: { ...note.plugin!, variants: ['b'] } },
    note.id,
    await context.repo.retiredNote(note.id),
    true,
  ).library
  const saved = await context.repo.save(reduced, first.revision)
  await expect(
    context.repo.save(removeSource(saved.library, prepared.source.id), saved.revision),
  ).rejects.toThrow('退役卡片引用')
  expect((await context.repo.load()).revision).toBe(saved.revision)
  context.source.retiredNotes.mockClear()
  context.source.attempts.mockClear()
  context.source.media.mockClear()
  await context.repo.save(
    reviewCard(saved.library, saved.library.cards[0]!.id, 3, now),
    saved.revision,
  )
  expect(context.source.retiredNotes).not.toHaveBeenCalled()
  expect(context.source.attempts).not.toHaveBeenCalled()
  expect(context.source.media).not.toHaveBeenCalled()
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
