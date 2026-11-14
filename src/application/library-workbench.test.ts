import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createLibraryState } from '../composables/library-state'
import { createRepository } from '../core/storage'
import { fixture } from '../core/test-fixtures'
import { addSource, prepareSource } from '../core/sources'
import { createLibraryService } from './library'
import type { SourceDraft } from '../core/source-workbench'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.restoreAllMocks()
})
async function setup() {
  const name = `workbench-service-${crypto.randomUUID()}`
  const repo = createRepository(name),
    state = createLibraryState()
  const { source, asset } = prepareSource({
    title: '学习',
    url: '',
    format: 'markdown',
    content: '原文🙂\n可定位的批注',
  })
  await repo.save(addSource(fixture(), source, asset), 0, { assets: [asset] })
  const service = createLibraryService(state, {
    createWorkspaceRepository: async () => repo,
    remoteWorkspace: { value: false },
    desktopEdition: false,
    canReviewCard: () => true,
  })
  await service.commands.init()
  cleanups.push(service.commands.close)
  return { repo, state, source, service }
}
it('initializes custom-property history before editing and preserves the draft on a failed atomic save', async () => {
  const { repo, state, source, service } = await setup()
  Object.assign(repo, {
    readSourceProperties: async () => 'unknown:\n  flag: true\nauthor: 原作者\n',
  })
  const editor = await service.commands.prepareSourceEditor(
    source.id,
    source.mediaId,
    state.scope.value,
  )
  expect(editor.properties).toContain('unknown:')
  const before = state.library.value
  const draft: SourceDraft = {
    id: crypto.randomUUID(),
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: state.scope.value,
    content: '新的版本',
    title: source.title,
    url: '',
    properties: 'unknown:\n  flag: true\nauthor: 新作者\n',
    updatedAt: new Date().toISOString(),
  }
  await service.commands.writeSourceDraft(draft)
  const save = vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('disk failure'))
  await expect(service.commands.editSourceContent({ ...draft, draftId: draft.id })).rejects.toThrow(
    'disk failure',
  )
  expect(state.library.value).toEqual(before)
  expect(await repo.readSourceDraft(source.id)).toEqual(draft)
  save.mockRestore()
  await service.commands.editSourceContent({ ...draft, draftId: draft.id })
  expect(await repo.readSourceDraft(source.id)).toBeUndefined()
  await service.commands.undoLastOperation()
  expect(state.library.value.sources).toEqual(before.sources)
  expect(state.library.value.cards).toEqual(before.cards)
  await service.commands.redoLastOperation()
  expect(await service.commands.getSource(source.id)).toBe('新的版本')
})
it('edits annotations on an old version without replacing the live document and supports undo', async () => {
  const { state, source, service } = await setup()
  const scope = state.scope.value
  await service.commands.editSourceContent({
    sourceId: source.id,
    mediaId: source.mediaId,
    scope,
    content: '新正文',
  })
  await service.commands.upsertSourceAnnotation({
    sourceId: source.id,
    mediaId: source.mediaId,
    scope,
    start: 0,
    end: 4,
    quote: '原文🙂',
    body: '保留旧出处',
  })
  const annotation = state.library.value.sources[0]!.annotations![0]!
  expect(await service.commands.getSource(source.id)).toBe('新正文')
  await service.commands.removeSourceAnnotation(source.id, annotation.id, scope)
  expect(state.library.value.sources[0]!.annotations).toEqual([])
  await service.commands.undoLastOperation()
  expect(state.library.value.sources[0]!.annotations![0]).toEqual(annotation)
})
it('rejects a delayed property read after the active library scope changed', async () => {
  const { repo, state, source, service } = await setup()
  let finish!: (value: string) => void
  Object.assign(repo, {
    readSourceProperties: () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  })
  const task = service.commands.prepareSourceEditor(source.id, source.mediaId, state.scope.value)
  await Promise.resolve()
  state.scope.value = 'local:another'
  finish('author: old')
  await expect(task).rejects.toThrow('材料已变化')
  expect(state.library.value.sources[0]!.properties).toBeUndefined()
})
