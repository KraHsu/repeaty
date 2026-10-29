import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { fixture } from './test-fixtures'
import { addSource, prepareSource, sourceExcerpt } from './sources'
import { sourceAtVersion } from './source-data'
import {
  editSourceContent,
  upsertSourceAnnotation,
  removeSourceAnnotation,
  type SourceDraft,
} from './source-workbench'
import { createRepository } from './storage'
import { parseSourceProperties } from './source-properties'
import { operationFor, revertOperation } from './operations'
import { operationHistory } from './operation-history'
import { rekeyBackup } from './backups'
import {
  createWorkspaceMarkdown,
  readWorkspaceMarkdown,
  rewriteWorkspaceDocument,
  workspaceSourceProperties,
} from '../workspace/markdown'

const input = {
  title: '阅读材料',
  url: '',
  format: 'markdown' as const,
  content: '第一段。\n重复内容🙂\n重复内容🙂',
}
function setup() {
  const { source, asset } = prepareSource(input)
  source.properties = 'author: 原作者\ncustom:\n  enabled: true\n'
  return { source, asset, library: addSource(fixture(), source, asset) }
}
it('keeps annotations on their exact snapshot while text editing retains identity and scheduling', () => {
  const { source, library } = setup()
  const start = input.content.lastIndexOf('重复'),
    end = input.content.length
  const annotation = {
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: 'local:test',
    start,
    end,
    quote: input.content.slice(start),
    body: '第二个匹配',
  }
  const marked = upsertSourceAnnotation(library, annotation, input.content)
  const update = {
    ...annotation,
    content: '改写后的正文',
    properties: 'author: 新作者\ncustom:\n  enabled: true\n',
  }
  const edited = editSourceContent(marked, update)
  expect(edited.source.id).toBe(source.id)
  expect(edited.source.annotations![0]).toMatchObject({
    mediaId: annotation.mediaId,
    start,
    end,
    quote: annotation.quote,
    body: annotation.body,
  })
  expect(edited.source.mediaId).not.toBe(source.mediaId)
  expect(sourceAtVersion(edited.source, source.mediaId)!.properties).toBe(source.properties)
  expect(edited.library.cards).toBe(library.cards)
  expect(edited.library.reviews).toBe(library.reviews)
  const rekeyed = rekeyBackup({ library: edited.library, assets: [] })
  const restored = rekeyed.library.sources[0]!
  expect(restored.annotations![0]!.mediaId).toBe(restored.versions![0]!.mediaId)
  expect(restored.annotations![0]!.mediaId).not.toBe(annotation.mediaId)
  expect(() =>
    upsertSourceAnnotation(edited.library, { ...annotation, quote: '错误内容' }, input.content),
  ).toThrow()
  const removed = removeSourceAnnotation(
    edited.library,
    source.id,
    edited.source.annotations![0]!.id,
  )
  const operation = operationFor(edited.library, removed, 'local:test', '删除批注')!
  expect(revertOperation(removed, operation)).toEqual(edited.library)
})
it('preserves unrelated frontmatter and supports deleting custom fields without changing managed identity', () => {
  const raw = createWorkspaceMarkdown(
    {
      repeaty: { version: 1, kind: 'source', id: 'source', format: 'markdown' },
      title: 'Title',
      url: '',
      author: 'Original',
      unknown: { keep: true },
      obsolete: 1,
    },
    { kind: 'source', body: 'Content' },
  )
  const parsed = readWorkspaceMarkdown(raw)
  if (parsed.status !== 'managed') throw new Error('Fixture')
  expect(parseSourceProperties(workspaceSourceProperties(parsed.document))).toEqual({
    author: 'Original',
    unknown: { keep: true },
    obsolete: 1,
  })
  const changed = rewriteWorkspaceDocument(
    parsed.document,
    {},
    { kind: 'source', body: 'New content' },
    'author: Changed\nunknown:\n  keep: true\n',
  )
  const result = readWorkspaceMarkdown(changed)
  if (result.status !== 'managed') throw new Error('Fixture')
  expect(result.document.identity).toEqual(parsed.document.identity)
  expect(result.document.properties).toMatchObject({
    title: 'Title',
    author: 'Changed',
    unknown: { keep: true },
  })
  expect(result.document.properties.obsolete).toBeUndefined()
  for (const value of [
    'repeaty: {}',
    'title: override',
    'url: override',
    'a: &a 1\nb: *a',
    '__proto__: x',
    'a: 1\na: 2',
  ])
    expect(() => parseSourceProperties(value)).toThrow()
})
it('persists drafts across restart and consumes them only with a successful body and history transaction', async () => {
  const { source, asset, library } = setup()
  const name = `workbench-${crypto.randomUUID()}`
  let repo = createRepository(name)
  const saved = await repo.save(library, 0, { assets: [asset] })
  const draft: SourceDraft = {
    id: crypto.randomUUID(),
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: repo.scope(),
    content: '修改后的正文',
    properties: source.properties!,
    title: source.title,
    url: '',
    updatedAt: new Date().toISOString(),
  }
  await repo.writeSourceDraft(draft)
  expect((await repo.load()).revision).toBe(saved.revision)
  await repo.close()
  repo = createRepository(name)
  expect(await repo.readSourceDraft(source.id)).toEqual(draft)
  const changed = editSourceContent(library, draft)
  await expect(
    repo.save(changed.library, 0, { assets: [changed.asset], consumeSourceDraft: draft.id }),
  ).rejects.toThrow()
  expect(await repo.readSourceDraft(source.id)).toEqual(draft)
  const history = operationHistory([
    operationFor(library, changed.library, repo.scope(), '编辑材料正文')!,
  ])
  await repo.save(changed.library, saved.revision, {
    assets: [changed.asset],
    consumeSourceDraft: draft.id,
    operationHistory: history,
  })
  expect(await repo.readSourceDraft(source.id)).toBeUndefined()
  await repo.close()
  repo = createRepository(name)
  const reopened = await repo.load()
  expect(reopened.operationHistory).toEqual(history)
  expect((await repo.getMedia(source.mediaId))?.size).toBe(asset.blob.size)
  expect(sourceExcerpt(source, input.content, 0, 4).quote).toBe('第一段。')
  await repo.close()
})
