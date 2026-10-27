import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkspaceRepository } from '@repeaty-platform'
import { createRepository } from '../core/storage'
import { fixture, input, now } from '../core/test-fixtures'
import { addSource, prepareSource } from '../core/sources'
import { useLibrary } from './useLibrary'
import { recordAttempt } from '../core/practice'
import { openDB } from 'idb'
import { createBrowserRepository } from '../browser/repository'
import { emptyLibrary } from '../core/model'

vi.mock('@repeaty-platform', () => ({ createWorkspaceRepository: vi.fn() }))
const workspaces: ReturnType<typeof useLibrary>[] = []
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close()
  vi.restoreAllMocks()
})
async function setup(library = fixture(), assets: import('../core/model').MediaUpload[] = []) {
  const name = 'undo-test-' + crypto.randomUUID()
  const repository = createRepository(name, undefined, {
    compactHistory: true,
  })
  await repository.save(library, 0, { assets })
  let opened = false
  vi.mocked(createWorkspaceRepository).mockImplementation(async () => {
    if (!opened) {
      opened = true
      return repository
    }
    return createRepository(name, undefined, { compactHistory: true })
  })
  const workspace = useLibrary()
  workspaces.push(workspace)
  await workspace.init()
  expect(workspace.ready.value).toBe(true)
  return { workspace, repository }
}

it('keeps the current repository intact if a candidate cannot load', async () => {
  const { workspace, repository } = await setup()
  const original = workspace.library.value,
    scope = workspace.scope.value
  const oldClose = vi.spyOn(repository, 'close')
  const candidate = createRepository('failed-candidate-' + crypto.randomUUID())
  vi.spyOn(candidate, 'load').mockRejectedValue(new Error('Synthetic snapshot failure'))
  const failedClose = vi.spyOn(candidate, 'close')
  await expect(workspace.replaceRepository(candidate)).rejects.toThrow('Synthetic snapshot failure')
  expect(workspace.library.value).toBe(original)
  expect(workspace.scope.value).toBe(scope)
  expect(workspace.ready.value).toBe(true)
  expect(workspace.busy.value).toBe(false)
  expect(oldClose).not.toHaveBeenCalled()
  expect(failedClose).toHaveBeenCalledTimes(1)
  await workspace.review(original.cards[0]!.id, 3)
  expect(workspace.library.value.reviews).toHaveLength(1)
})

it('opens an empty trial without seeding it and returns to the untouched browser library', async () => {
  const { workspace, repository } = await setup()
  const original = workspace.library.value,
    originalScope = workspace.scope.value
  const source = {
    snapshot: { id: crypto.randomUUID(), name: '空目录', revision: 0, library: emptyLibrary() },
    media: vi.fn(async () => undefined),
    attempts: vi.fn(async () => []),
    close: vi.fn(),
  }
  const trial = createBrowserRepository(source)
  await workspace.replaceRepository(trial)
  expect(workspace.scope.value).toBe(trial.scope())
  expect(workspace.library.value).toEqual(emptyLibrary())
  await workspace.saveDeck({ ...original.decks[0]!, name: '只在副本中' })
  const reopened = createRepository(repository.scope().slice('local:'.length))
  await workspace.replaceRepository(reopened)
  expect(workspace.library.value).toEqual(original)
  expect(workspace.scope.value).toBe(originalScope)
  expect(source.close).toHaveBeenCalledTimes(1)
  expect(workspace.lastOperation.value).toBeUndefined()
})

it('rejects a source read from the previous library after a successful switch', async () => {
  const prepared = prepareSource({
    title: '旧材料',
    url: '',
    format: 'plain',
    content: 'old content',
  })
  const { workspace, repository } = await setup(
    addSource(fixture(), prepared.source, prepared.asset),
    [prepared.asset],
  )
  let release!: (blob: Blob) => void
  const pending = vi.spyOn(repository, 'getMedia').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const reading = workspace.getSource(prepared.source.id)
  const rejected = expect(reading).rejects.toThrow('已不存在')
  await vi.waitFor(() => expect(pending).toHaveBeenCalled())
  const candidate = createRepository('next-scope-' + crypto.randomUUID())
  await workspace.replaceRepository(candidate)
  release(prepared.asset.blob)
  await rejected
  expect(workspace.library.value.sources).toHaveLength(0)
})

it('keeps failed writes out of history and retains a failed undo for one safe retry', async () => {
  const { workspace, repository } = await setup()
  const original = workspace.library.value
  const save = vi.spyOn(repository, 'save')
  save.mockRejectedValueOnce(new DOMException('Synthetic full storage', 'QuotaExceededError'))
  await expect(workspace.saveNote({ ...input, front: 'Failed' })).rejects.toThrow('存储空间不足')
  expect(workspace.library.value).toBe(original)
  expect(workspace.canUndoOperation.value).toBe(false)
  await workspace.saveNote({ ...input, front: 'Saved' })
  const id = workspace.lastOperation.value!.id
  expect(workspace.library.value.notes).toHaveLength(2)
  for (const change of workspace.lastOperation.value!.changes)
    if (change.after)
      expect(workspace.library.value[change.store].find((row) => row.id === change.id)).toEqual(
        change.after,
      )
  save.mockRejectedValueOnce(new DOMException('Synthetic full storage', 'QuotaExceededError'))
  await expect(workspace.undoLastOperation()).rejects.toThrow('存储空间不足')
  expect(workspace.lastOperation.value!.id).toBe(id)
  expect(workspace.library.value.notes).toHaveLength(2)
  await workspace.undoLastOperation()
  expect(workspace.library.value).toEqual(original)
  expect(workspace.canUndoOperation.value).toBe(false)
})

it('orders rating and content undo together without losing persisted rating undo after reopening', async () => {
  const { workspace } = await setup()
  const original = workspace.library.value
  const card = original.cards[0]!
  await workspace.review(card.id, 3)
  await workspace.saveNote({ ...input, front: 'Edited' }, original.notes[0]!.id)
  expect(workspace.lastOperation.value!.kind).toBe('change')
  await workspace.undoLastOperation()
  expect(workspace.library.value.notes).toEqual(original.notes)
  expect(workspace.library.value.reviews).toHaveLength(1)
  expect(workspace.lastOperation.value!.kind).toBe('review')
  await workspace.undoLastOperation()
  expect(workspace.library.value.cards).toEqual(original.cards)
  expect(workspace.library.value.reviews).toEqual([])
  await workspace.review(card.id, 4)
  await workspace.init()
  expect(workspace.lastOperation.value).toBeUndefined()
  expect(workspace.canUndoOperation.value).toBe(true)
  await workspace.undoLastOperation()
  expect(workspace.library.value.cards).toEqual(original.cards)
})

it('restores deleted source bytes and keeps later reading positions out of the undo stack', async () => {
  const prepared = prepareSource(
    { title: 'Source', url: '', format: 'plain', content: 'Reading\n'.repeat(100) },
    now,
  )
  const { workspace } = await setup(addSource(fixture(), prepared.source, prepared.asset), [
    prepared.asset,
  ])
  const scope = workspace.scope.value,
    source = prepared.source
  await workspace.arrangeSource({
    sourceId: source.id,
    mediaId: source.mediaId,
    scope,
    action: { type: 'archive' },
  })
  const id = workspace.lastOperation.value!.id
  await workspace.saveSourceReading(
    {
      sourceId: source.id,
      mediaId: source.mediaId,
      scope,
      position: { offset: 40, fraction: 0, view: 'source' },
    },
    now,
  )
  expect(workspace.lastOperation.value!.id).toBe(id)
  await workspace.undoLastOperation()
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(40)
  expect(workspace.library.value.sources[0]!.queue).toBeUndefined()
  await workspace.deleteSource(source.id, scope)
  expect(workspace.library.value.sources).toEqual([])
  await workspace.undoLastOperation()
  expect(workspace.library.value.sources[0]!.id).toBe(source.id)
  expect(await (await workspace.getMedia(source.mediaId))!.text()).toBe('Reading\n'.repeat(100))
})

it('limits history to twenty changes and clears it when the library is reopened', async () => {
  const { workspace } = await setup()
  for (let index = 0; index < 22; index++)
    await workspace.saveNote({ ...input, front: 'Added ' + index })
  for (let index = 0; index < 20; index++) await workspace.undoLastOperation()
  expect(workspace.library.value.notes).toHaveLength(3)
  expect(workspace.canUndoOperation.value).toBe(false)
  await expect(workspace.undoLastOperation()).rejects.toThrow('没有可撤销')
  await workspace.saveNote({ ...input, front: 'New' })
  await workspace.init()
  expect(workspace.canUndoOperation.value).toBe(false)
})

it('restores the preceding reading undo after reversing consecutive arrangements', async () => {
  const prepared = ['First', 'Second'].map((title) =>
    prepareSource({ title, url: '', format: 'plain', content: title }, now),
  )
  const library = prepared.reduce(
    (library, { source, asset }) => addSource(library, source, asset),
    fixture(),
  )
  const { workspace } = await setup(
    library,
    prepared.map((entry) => entry.asset),
  )
  const ids: string[] = []
  for (const { source } of prepared) {
    await workspace.arrangeSource({
      sourceId: source.id,
      mediaId: source.mediaId,
      scope: workspace.scope.value,
      action: { type: 'archive' },
    })
    ids.push(workspace.readingUndo.value!.id)
  }
  await workspace.undoReadingArrangement(workspace.scope.value)
  expect(workspace.readingUndo.value!.id).toBe(ids[0])
  expect(workspace.canUndoReading.value).toBe(true)
  expect(workspace.lastOperation.value!.id).toBe(ids[0])
  await workspace.undoReadingArrangement(workspace.scope.value)
  expect(workspace.library.value.sources.every((source) => !source.queue)).toBe(true)
  expect(workspace.canUndoReading.value).toBe(false)
  expect(workspace.canUndoOperation.value).toBe(false)
})

it('restores compact judge bodies after deleting their note without resubmitting to the judge', async () => {
  const plugin = { id: 'leetcode', version: 1, data: { slug: 'test-problem' } }
  const library = fixture({ type: 'plugin', plugin })
  const practice = {
    id: 'practice',
    cardId: library.cards[0]!.id,
    contentRevision: 'sha256',
    question: { front: 'Problem', back: '', format: 'plain' as const, plugin },
    startedAt: now.toISOString(),
  }
  const attempt = {
    id: 'attempt',
    practiceId: practice.id,
    submittedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    language: 'python3',
    code: 'return 42',
    elapsedMs: 1000,
    status: 'completed' as const,
    submissionId: '123',
    result: {
      outcome: 'accepted' as const,
      status: 'Accepted',
      runtime: '1 ms',
      memory: '1 MB',
      detail: 'Original judge detail',
    },
  }
  const starting = recordAttempt(library, practice, {
    ...attempt,
    status: 'submitting',
    submissionId: undefined,
    result: undefined,
  })
  const pending = recordAttempt(starting, practice, {
    ...attempt,
    status: 'pending',
    result: undefined,
  })
  const seeded = recordAttempt(pending, practice, attempt)
  const { workspace } = await setup(seeded)
  expect(workspace.library.value.attempts[0]!.code).toBeUndefined()
  await workspace.deleteNotes(new Set([library.notes[0]!.id]))
  expect(workspace.library.value.attempts).toEqual([])
  await workspace.undoLastOperation()
  expect(workspace.library.value.practices).toEqual(seeded.practices)
  expect(await workspace.getAttempt(attempt.id)).toEqual(attempt)
})

it('retains bytes independently of snapshot garbage collection while an undo step is available', async () => {
  const prepared = prepareSource(
    { title: 'Temporary source', url: '', format: 'plain', content: 'Keep these bytes' },
    now,
  )
  const { workspace, repository } = await setup(
    addSource(fixture(), prepared.source, prepared.asset),
    [prepared.asset],
  )
  await workspace.deleteSource(prepared.source.id, workspace.scope.value)
  // Simulate collection of a blob no longer referenced by current data or snapshots.
  const database = await openDB(repository.scope().slice('local:'.length))
  await database.delete('assets', prepared.source.mediaId)
  database.close()
  await workspace.undoLastOperation()
  expect(await (await workspace.getMedia(prepared.source.mediaId))!.text()).toBe('Keep these bytes')
})

it('keeps remote submissions out of undo and starts a new history after submitting', async () => {
  const plugin = { id: 'leetcode', version: 1, data: { slug: 'test-problem' } }
  const library = fixture({ type: 'plugin', plugin })
  const { workspace } = await setup(library)
  await workspace.saveNote({ ...input, front: 'Before submission' })
  const practice = {
    id: 'new-practice',
    cardId: library.cards[0]!.id,
    contentRevision: 'sha256',
    question: { front: 'Problem', back: '', format: 'plain' as const, plugin },
    startedAt: now.toISOString(),
  }
  const attempt = {
    id: 'new-attempt',
    practiceId: practice.id,
    submittedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    language: 'python3',
    code: 'return 42',
    elapsedMs: 1000,
    status: 'submitting' as const,
  }
  expect(workspace.canUndoOperation.value).toBe(true)
  await workspace.recordAttempt(practice, attempt, workspace.scope.value)
  expect(workspace.canUndoOperation.value).toBe(false)
  await expect(workspace.undoLastOperation()).rejects.toThrow('没有可撤销')
  await workspace.saveNote({ ...input, front: 'After submission' })
  await workspace.undoLastOperation()
  expect(workspace.library.value.notes.some((note) => note.front === 'Before submission')).toBe(
    true,
  )
  expect(await workspace.getAttempt(attempt.id)).toEqual(attempt)
})

it('drops the old undo stack when switching workspace scope', async () => {
  const { workspace } = await setup()
  await workspace.saveNote({ ...input, front: 'Private old note' })
  const other = createRepository('other-undo-' + crypto.randomUUID(), undefined, {
    compactHistory: true,
  })
  await other.save(fixture({ front: 'Other account' }), 0)
  vi.mocked(createWorkspaceRepository).mockResolvedValue(other)
  await workspace.init()
  expect(workspace.library.value.notes[0]!.front).toBe('Other account')
  expect(workspace.canUndoOperation.value).toBe(false)
  await expect(workspace.undoLastOperation()).rejects.toThrow('没有可撤销')
  expect(workspace.library.value.notes[0]!.front).toBe('Other account')
})
