import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type {
  MaterialImportCandidate,
  MaterialImporterContribution,
  MaterialSelection,
} from '@repeaty/plugin-api'
import { createLibraryState } from '../composables/library-state'
import { fixture, input } from '../core/test-fixtures'
import { createRepository } from '../core/storage'
import { PluginTaskScheduler } from '../plugins/tasks'
import type { MaterialPluginIdentity } from '../plugins/materials'
import { createLibraryService } from './library'
import { exportBackup, parseBackup, rekeyBackup } from '../core/backups'
import { exportArchive, parseArchive } from '../core/archive'
import { librarySchema } from '../core/model'

const services: ReturnType<typeof createLibraryService>[] = []
const lifetimes: AbortController[] = []
afterEach(async () => {
  for (const controller of lifetimes.splice(0)) controller.abort()
  for (const service of services.splice(0)) await service.commands.close()
  vi.restoreAllMocks()
})

describe('document resources and chapter study transactions', () => {
  const image = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' })
  const chapters = (mode: 'free' | 'sequential'): MaterialImportCandidate[] => [
    {
      ...candidates[0]!,
      key: 'book',
      title: 'Book',
      text: 'Directory',
      documentFormat: 'epub',
      container: true,
    },
    ...[0, 1].map((index) => ({
      ...candidates[0]!,
      key: `chapter-${index}`,
      title: `Chapter ${index + 1}`,
      documentFormat: 'epub',
      parentKey: 'book',
      documentPath: `OPS/${index}.xhtml`,
      resources: [{ path: 'OPS/image.png', blob: image }],
      studySequence: { groupKey: 'book', index, mode },
    })),
  ]
  async function importChapters(
    test: Awaited<ReturnType<typeof setup>>,
    mode: 'free' | 'sequential',
    operationId: string,
  ) {
    test.importer.id = `epub-${mode}`
    test.importer.extensions = ['.epub']
    test.importer.parse = async () => chapters(mode)
    const plan = await test.prepare([new File(['unchanged original EPUB'], 'book.epub')])
    const result = await test.api.commitImport({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId,
    })
    return { plan, result }
  }
  it('releases real existing chapters, rejects skipped completion, switches mode, and undoes completion', async () => {
    const test = await setup()
    const { result } = await importChapters(test, 'sequential', 'book-import')
    const [root, first, second] = result.sourceIds as [string, string, string]
    expect((await test.api.get(root)).material.document?.container).toBe(true)
    expect((await test.api.get(first)).material.locked).toBe(false)
    expect((await test.api.get(second)).material.locked).toBe(true)
    await expect(
      test.api.setSequence({
        sourceId: second,
        completed: true,
        expectedRevision: test.api.snapshot().revision,
        operationId: 'skip-first',
      }),
    ).rejects.toThrow('先完成')
    const request = {
      sourceId: first,
      completed: true,
      expectedRevision: test.api.snapshot().revision,
      operationId: 'complete-first',
    }
    await test.api.setSequence(request)
    await test.api.setSequence(request)
    expect((await test.api.get(second)).material.locked).toBe(false)
    expect(test.state.library.value.sources.map((item) => item.id)).toEqual(result.sourceIds)
    await test.service.commands.undoLastOperation()
    expect((await test.api.get(second)).material.locked).toBe(true)
    await test.api.setSequence({
      sourceId: root,
      mode: 'free',
      expectedRevision: test.api.snapshot().revision,
      operationId: 'free-mode',
    })
    expect((await test.api.list()).every((item) => !item.locked)).toBe(true)
    await test.api.setSequence({
      sourceId: root,
      mode: 'sequential',
      expectedRevision: test.api.snapshot().revision,
      operationId: 'sequential-mode',
    })
    expect((await test.api.get(second)).material.locked).toBe(true)
    expect(test.state.library.value.sources).toHaveLength(3)
  })
  it('deduplicates across mode entry points and retains existing progress and media identities', async () => {
    const test = await setup()
    const { result: first } = await importChapters(test, 'sequential', 'first-mode')
    await test.api.setSequence({
      sourceId: first.sourceIds[1]!,
      completed: true,
      expectedRevision: test.api.snapshot().revision,
      operationId: 'completed',
    })
    const media = test.state.library.value.media.map((item) => item.id)
    const { plan, result: second } = await importChapters(test, 'free', 'second-mode')
    expect(plan.candidates.every((item) => item.duplicate)).toBe(true)
    expect(second.sourceIds).toEqual(first.sourceIds)
    expect(test.state.library.value.media.map((item) => item.id)).toEqual(media)
    expect((await test.api.get(first.sourceIds[1]!)).material.studySequence).toMatchObject({
      mode: 'sequential',
      completed: true,
    })
    const stored = test.state.library.value.sources
    expect(stored[1]!.document!.resources![0]!.mediaId).toBe(
      stored[2]!.document!.resources![0]!.mediaId,
    )
  })
  it('rejects inconsistent sequence groups and duplicate resource paths before offering a preview', async () => {
    const test = await setup()
    test.importer.parse = async () => {
      const result = chapters('sequential')
      result[2]!.studySequence!.index = 0
      return result
    }
    await expect(test.prepare()).rejects.toThrow('章节分组')
    test.importer.parse = async () => [
      {
        ...candidates[0]!,
        resources: [
          { path: 'a.png', blob: image },
          { path: 'a.png', blob: image },
        ],
      },
    ]
    await expect(test.prepare()).rejects.toThrow('资源路径重复')
    expect((await test.repo.load()).library.sources).toEqual([])
  })
  it.each([
    ['book.epub', 'application/epub+zip'],
    ['paper.pdf', 'application/pdf'],
    ['page.html', 'text/html'],
    ['page.xhtml', 'text/html'],
  ])('infers MIME for an original selected as %s without a browser type', async (name, type) => {
    const test = await setup()
    test.importer.extensions = [`.${name!.split('.').at(-1)}`]
    test.importer.parse = async () => [
      {
        ...candidates[0]!,
        documentFormat: name!.endsWith('.epub') ? 'epub' : name!.endsWith('.pdf') ? 'pdf' : 'html',
      },
    ]
    const plan = await test.prepare([new File(['original bytes'], name!)])
    const saved = await test.api.commitImport({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'infer-mime',
    })
    const original = await test.api.original(saved.sourceIds[0]!)
    expect(original?.type).toBe(type)
    expect(await original!.text()).toBe('original bytes')
  })
  it('passes only selected sidecars, retains original and resource bytes across undo/redo and both backup formats', async () => {
    const test = await setup(),
      sidecar = new File([image], 'images/a.png', { type: image.type })
    test.importer.extensions = ['.html']
    test.importer.parse = async (_file, context) => {
      expect(context.files).toEqual([sidecar])
      return [
        {
          ...candidates[0]!,
          documentFormat: 'html',
          documentPath: 'index.html',
          url: 'https://example.com/article',
          resources: [{ path: sidecar.name, blob: sidecar }],
        },
      ]
    }
    const plan = await test.api.prepareImport({
      importerId: test.importer.id,
      files: [new File(['<p>original</p>'], 'index.html')],
      relatedFiles: [sidecar],
    })
    const saved = await test.api.commitImport({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'html-resources',
    })
    const id = saved.sourceIds[0]!
    expect(await (await test.api.resource(id, 'images/a.png'))!.arrayBuffer()).toEqual(
      await image.arrayBuffer(),
    )
    expect(await test.api.resource(id, 'not-selected.png')).toBeUndefined()
    await expect(test.api.resource(id, '../private')).rejects.toThrow()
    await test.service.commands.undoLastOperation()
    expect(test.state.library.value.sources).toEqual([])
    await test.service.commands.redoLastOperation()
    expect(await (await test.api.resource(id, 'images/a.png'))!.arrayBuffer()).toEqual(
      await image.arrayBuffer(),
    )
    const library = (await test.repo.load()).library
    const read = (mediaId: string) => test.repo.getMedia(mediaId)
    const copies = [
      parseBackup(await exportBackup(library, read)),
      await parseArchive((await exportArchive(library, read))!),
    ]
    for (const backup of copies) {
      expect(backup.library.sources[0]!.document).toEqual(library.sources[0]!.document)
      const restored = rekeyBackup(backup),
        descriptor = restored.library.sources[0]!.document!
      expect(librarySchema.safeParse(restored.library).success).toBe(true)
      expect(descriptor.resources![0]!.mediaId).not.toBe(
        library.sources[0]!.document!.resources![0]!.mediaId,
      )
      expect(
        await restored.assets
          .find((asset) => asset.meta.id === descriptor.resources![0]!.mediaId)!
          .blob.arrayBuffer(),
      ).toEqual(await image.arrayBuffer())
    }
  })
  it('hashes resource content and MIME while treating resource order as irrelevant', async () => {
    const test = await setup(),
      second = new Blob(['different'], { type: 'image/png' })
    let resources = [
      { path: 'a.png', blob: image },
      { path: 'b.png', blob: second },
    ]
    test.importer.parse = async () => [{ ...candidates[0]!, resources }]
    await test.importDocument('initial-resource-order')
    resources = [...resources].reverse()
    expect((await test.prepare()).candidates[0]!.duplicate).toBe(true)
    resources = [
      { path: 'a.png', blob: new Blob([image], { type: 'image/jpeg' }) },
      { path: 'b.png', blob: second },
    ]
    expect((await test.prepare()).candidates[0]!.duplicate).toBe(false)
  })
})

const repeated = '先复述。再次回忆🧩，核对答案。\n中间段落。\n再次回忆🧩，核对答案。'
const candidates = [
  {
    key: 'chapter',
    title: '章节',
    text: repeated,
    format: 'plain',
    documentFormat: 'study-json',
    readerId: 'chapter',
  },
  {
    key: 'child',
    title: '子章节',
    text: '深入阅读。',
    format: 'plain',
    documentFormat: 'study-json',
    readerId: 'chapter',
    parentKey: 'chapter',
  },
] satisfies MaterialImportCandidate[]
function documentFile(contents: unknown = candidates) {
  return new File([JSON.stringify(contents)], 'lesson.study.json', { type: 'application/json' })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup(name = `material-test-${crypto.randomUUID()}`, seed = true) {
  const repo = createRepository(name)
  if (seed) {
    const library = fixture()
    library.notes = []
    library.cards = []
    await repo.save(library, 0)
  }
  const state = createLibraryState()
  const service = createLibraryService(state, {
    createWorkspaceRepository: async () => repo,
    remoteWorkspace: { value: false },
    desktopEdition: false,
    canReviewCard: () => true,
  })
  services.push(service)
  await service.commands.init()
  expect(state.ready.value).toBe(true)
  const importer: MaterialImporterContribution = {
    id: 'study-json',
    title: '学习章节',
    extensions: ['.study.json'],
    parse: async (file) => JSON.parse(await file.text()),
  }
  const activate = () => {
    const controller = new AbortController()
    lifetimes.push(controller)
    const scheduler = new PluginTaskScheduler(),
      owner = Symbol()
    const identity: MaterialPluginIdentity = {
      pluginId: 'structured-study-example',
      scope: state.scope.value,
      signal: controller.signal,
      assertCurrent: () => controller.signal.throwIfAborted(),
      runTask: (options, run) => scheduler.run(owner, options, run, controller.signal),
    }
    return {
      controller,
      api: service.commands.materialApi(identity, (id) =>
        id === importer.id ? importer : undefined,
      ),
    }
  }
  const { controller, api } = activate()
  const prepare = (files = [documentFile()]) =>
    api.prepareImport({ importerId: importer.id, files })
  const importDocument = async (operationId = 'import-first') => {
    const plan = await prepare()
    return api.commitImport({ planId: plan.id, expectedRevision: plan.revision, operationId })
  }
  return {
    name,
    repo,
    state,
    service,
    importer,
    activate,
    controller,
    api,
    prepare,
    importDocument,
  }
}
function select(sourceId: string, versionId: string): MaterialSelection {
  const text = '再次回忆🧩，核对答案。',
    start = repeated.lastIndexOf(text)
  return {
    text,
    locator: {
      schemaVersion: 1,
      sourceId,
      versionId,
      kind: 'text',
      start,
      end: start + text.length,
      quote: text,
    },
  }
}

describe('library-owned material transactions', () => {
  it('edits one immutable body through a receipt-backed undoable transaction', async () => {
    const test = await setup()
    await test.importDocument()
    const before = test.state.library.value,
      source = before.sources[0]!
    const request = {
      sourceId: source.id,
      versionId: source.mediaId,
      content: '清理后的正文🙂',
      expectedRevision: test.api.snapshot().revision,
      operationId: 'cleanup-first',
    }
    const result = await test.api.editContent(request)
    expect(result.versionId).not.toBe(source.mediaId)
    expect((await test.api.get(source.id, source.mediaId)).text).toBe(repeated)
    expect((await test.api.get(source.id)).text).toBe(request.content)
    expect(test.state.library.value.cards).toEqual(before.cards)
    expect(await test.api.editContent(request)).toEqual(result)
    await expect(test.api.editContent({ ...request, content: 'different' })).rejects.toThrow(
      '操作标识',
    )
    await test.service.commands.undoLastOperation()
    expect((await test.api.get(source.id)).text).toBe(repeated)
    await expect(test.api.editContent(request)).rejects.toThrow('已撤销或删除')
    await test.service.commands.redoLastOperation()
    expect((await test.api.get(source.id)).text).toBe(request.content)
    expect((await test.api.editContent(request)).versionId).toBe(result.versionId)
  })
  it('preserves unmanaged properties through plugin edits and rejects stale previews and lifetimes', async () => {
    const test = await setup()
    await test.importDocument()
    const source = test.state.library.value.sources[0]!
    Object.assign(test.repo, { readSourceProperties: async () => 'unknown:\n  flag: true\n' })
    const request = {
      sourceId: source.id,
      versionId: source.mediaId,
      content: '清理结果',
      expectedRevision: test.api.snapshot().revision,
      operationId: 'cleanup-yaml',
    }
    await test.api.editContent(request)
    expect(test.state.library.value.sources[0]!.properties).toContain('flag: true')
    await test.service.commands.undoLastOperation()
    expect(test.state.library.value.sources[0]!.properties).toContain('flag: true')
    await expect(test.api.editContent({ ...request, operationId: 'stale' })).rejects.toThrow(
      '已变化',
    )
    test.controller.abort()
    await expect(
      test.api.editContent({ ...request, operationId: 'unloaded', expectedRevision: 999 }),
    ).rejects.toThrow()
  })
  it('atomically saves the first property baseline, body, receipt and undo journal and permits a failed request to retry', async () => {
    const test = await setup()
    await test.importDocument()
    const before = test.state.library.value,
      history = test.state.operations.value,
      source = before.sources[0]!,
      properties = 'unknown:\n  flag: true\nlabels: [reading, practice]\n'
    Object.assign(test.repo, { readSourceProperties: vi.fn(async () => properties) })
    const save = vi.spyOn(test.repo, 'save').mockRejectedValueOnce(new Error('disk write failed'))
    const request = {
      sourceId: source.id,
      versionId: source.mediaId,
      content: '保存并保留原始属性',
      expectedRevision: test.api.snapshot().revision,
      operationId: 'cleanup-retry',
    }
    await expect(test.api.editContent(request)).rejects.toThrow('disk write failed')
    expect(save).toHaveBeenCalledOnce()
    expect(test.api.snapshot().revision).toBe(request.expectedRevision)
    expect(test.state.library.value).toBe(before)
    expect(test.state.operations.value).toBe(history)
    const failed = await test.repo.load()
    expect(failed.library).toEqual(before)
    expect(failed.operationHistory?.undo).toEqual(history)

    const result = await test.api.editContent(request)
    expect(result.revision).toBe(request.expectedRevision + 1)
    expect(save).toHaveBeenCalledTimes(2)
    const persisted = await test.repo.load()
    expect(persisted.revision).toBe(result.revision)
    expect(persisted.library.materialReceipts).toHaveLength(before.materialReceipts.length + 1)
    expect(persisted.library.sources[0]!.properties).toBe(properties)
    expect(persisted.library.sources[0]!.versions?.[0]?.properties).toBe(properties)
    expect(persisted.operationHistory?.undo).toHaveLength(history.length + 1)
    const change = persisted.operationHistory?.undo
      .at(-1)
      ?.changes.find((entry) => entry.store === 'sources' && entry.id === source.id)
    expect(change?.before).toMatchObject({ mediaId: source.mediaId, properties })
    expect(change?.after).toMatchObject({ mediaId: result.versionId, properties })
    expect(await test.api.editContent(request)).toEqual(result)
    expect(save).toHaveBeenCalledTimes(2)

    await test.service.commands.undoLastOperation()
    expect((await test.api.get(source.id)).text).toBe(repeated)
    expect(test.state.library.value.sources[0]!.properties).toBe(properties)
    expect(test.state.library.value.materialReceipts).toEqual(persisted.library.materialReceipts)
    await test.service.commands.redoLastOperation()
    expect((await test.api.get(source.id)).text).toBe(request.content)
    expect(test.state.library.value.sources[0]!.properties).toBe(properties)
  })
  it('does not commit a property baseline when the preview changes during its read', async () => {
    const test = await setup()
    await test.importDocument()
    const source = test.state.library.value.sources[0]!,
      pending = deferred<string>(),
      read = vi.fn(() => pending.promise)
    Object.assign(test.repo, { readSourceProperties: read })
    const request = {
      sourceId: source.id,
      versionId: source.mediaId,
      content: 'Stale preview',
      expectedRevision: test.api.snapshot().revision,
      operationId: 'cleanup-stale-baseline',
    }
    const editing = test.api.editContent(request)
    const rejected = expect(editing).rejects.toThrow('已变化')
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    await test.importDocument('concurrent-import')
    const current = test.state.library.value,
      revision = test.api.snapshot().revision,
      save = vi.spyOn(test.repo, 'save')
    pending.resolve('unknown: true\n')
    await rejected
    expect(save).not.toHaveBeenCalled()
    expect(test.state.library.value).toBe(current)
    expect(test.api.snapshot().revision).toBe(revision)
    expect(test.state.library.value.sources[0]!.properties).toBeUndefined()
  })
  it('rejects originals larger than the shared native document limit before invoking a parser', async () => {
    const test = await setup(),
      parse = vi.spyOn(test.importer, 'parse')
    await expect(
      test.prepare([
        new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'large.study.json', {
          type: 'application/json',
        }),
      ]),
    ).rejects.toThrow('原件最多64 MB')
    await expect(
      test.prepare([new File([], 'empty.study.json', { type: 'application/json' })]),
    ).rejects.toThrow('非空')
    expect(parse).not.toHaveBeenCalled()
    expect((await test.repo.load()).library.sources).toEqual([])
  })
  it('previews without writes, then saves hierarchy, projection and exact original in one transaction', async () => {
    const test = await setup(),
      save = vi.spyOn(test.repo, 'save'),
      file = documentFile()
    const plan = await test.prepare([file])
    expect(save).not.toHaveBeenCalled()
    expect((await test.repo.load()).library.sources).toEqual([])
    expect(test.state.library.value.media).toEqual([])
    const result = await test.api.commitImport({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'hierarchy',
    })
    expect(save).toHaveBeenCalledTimes(1)
    const saved = (await test.repo.load()).library
    expect(saved.sources.map((source) => source.id)).toEqual(result.sourceIds)
    expect(saved.sources[1]!.parentSourceId).toBe(result.sourceIds[0])
    expect(saved.media).toHaveLength(3)
    expect(await (await test.api.original(result.sourceIds[0]!))!.text()).toBe(await file.text())
    expect((await test.api.get(result.sourceIds[0]!)).text).toBe(repeated)
    expect(saved.materialReceipts).toHaveLength(1)
  })

  it('deduplicates identical files within a batch as well as later imports', async () => {
    const test = await setup(),
      file = documentFile()
    const plan = await test.prepare([file, file])
    expect(plan.candidates.filter((candidate) => candidate.duplicate)).toHaveLength(2)
    await test.api.commitImport({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'same-batch',
    })
    expect(test.state.library.value.sources).toHaveLength(2)
    expect(test.state.library.value.media).toHaveLength(3)
    const later = await test.prepare()
    expect(later.candidates.every((candidate) => candidate.duplicate)).toBe(true)
    await test.api.commitImport({
      planId: later.id,
      expectedRevision: later.revision,
      operationId: 'later-batch',
    })
    expect((await test.repo.load()).library.sources).toHaveLength(2)
  })

  it('rejects a bad later candidate and a failed save without publishing partial sources or receipts', async () => {
    const test = await setup(),
      save = vi.spyOn(test.repo, 'save')
    await expect(
      test.prepare([documentFile([candidates[0], { ...candidates[1], parentKey: 'missing' }])]),
    ).rejects.toThrow('层级')
    expect(save).not.toHaveBeenCalled()
    const plan = await test.prepare()
    save.mockRejectedValueOnce(new Error('disk-full'))
    const request = {
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'retry-failed-save',
    }
    await expect(test.api.commitImport(request)).rejects.toThrow('disk-full')
    const persisted = (await test.repo.load()).library
    expect(persisted.sources).toEqual([])
    expect(persisted.media).toEqual([])
    expect(persisted.materialReceipts).toEqual([])
    expect(test.state.library.value.sources).toEqual([])
    await test.api.commitImport(request)
    expect(test.state.library.value.sources).toHaveLength(2)
  })

  it('requires the preview revision and rejects discarded or expired previews', async () => {
    const test = await setup(),
      plan = await test.prepare()
    await test.service.commands.saveDeck(
      { ...test.state.library.value.decks[0]!, name: 'Changed' },
      'deck',
    )
    await expect(
      test.api.commitImport({
        planId: plan.id,
        expectedRevision: plan.revision,
        operationId: 'stale',
      }),
    ).rejects.toThrow('变化')
    const fresh = await test.prepare()
    test.api.discardImport(fresh.id)
    await expect(
      test.api.commitImport({
        planId: fresh.id,
        expectedRevision: fresh.revision,
        operationId: 'discarded',
      }),
    ).rejects.toThrow('过期')
    const expiring = await test.prepare()
    const at = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(at + 16 * 60_000)
    await expect(
      test.api.commitImport({
        planId: expiring.id,
        expectedRevision: expiring.revision,
        operationId: 'expired',
      }),
    ).rejects.toThrow('过期')
    expect(test.state.library.value.sources).toEqual([])
  })

  it('bounds concurrently prepared previews and releases capacity when one is discarded', async () => {
    const test = await setup(),
      save = vi.spyOn(test.repo, 'save')
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => test.prepare()))
    const previews = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    )
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    expect(previews).toHaveLength(4)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toEqual(
      expect.objectContaining({ message: expect.stringContaining('待确认的导入过多') }),
    )
    test.api.discardImport(previews[0]!.id)
    await expect(test.prepare()).resolves.toMatchObject({ candidates: expect.any(Array) })
    await expect(test.prepare()).rejects.toThrow('待确认的导入过多')
    expect(save).not.toHaveBeenCalled()
    expect((await test.repo.load()).library.sources).toEqual([])
  })

  it('ignores late parser output after cancellation and library replacement', async () => {
    const test = await setup(),
      gate = deferred<readonly (typeof candidates)[number][]>(),
      started = deferred<void>()
    test.importer.parse = async () => {
      started.resolve()
      return gate.promise as ReturnType<MaterialImporterContribution['parse']>
    }
    const abort = new AbortController()
    const pending = test.api.prepareImport(
      { importerId: test.importer.id, files: [documentFile()] },
      abort.signal,
    )
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    abort.abort()
    await cancelled
    const next = await setup()
    await test.service.commands.replaceRepository(next.repo)
    gate.resolve(candidates)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(test.api.capabilities().available).toBe(false)
    await expect(test.api.list()).rejects.toThrow('变化')
    expect((await next.repo.load()).library.sources).toEqual([])
  })

  it('does not let parsing started in one library publish a plan in another', async () => {
    const test = await setup(),
      gate = deferred<readonly (typeof candidates)[number][]>(),
      started = deferred<void>()
    test.importer.parse = async () => {
      started.resolve()
      return gate.promise as ReturnType<MaterialImporterContribution['parse']>
    }
    const pending = test.prepare(),
      rejected = expect(pending).rejects.toThrow('变化')
    await started.promise
    const next = await setup()
    await test.service.commands.replaceRepository(next.repo)
    gate.resolve(candidates)
    await rejected
    expect((await next.repo.load()).library.materialReceipts).toEqual([])
  })

  it('persists idempotency across activations and application restarts, rejecting changed payloads', async () => {
    const test = await setup(),
      first = await test.importDocument('durable-import')
    const { api } = test.activate()
    const plan = await api.prepareImport({ importerId: test.importer.id, files: [documentFile()] })
    const replay = await api.commitImport({
      planId: plan.id,
      expectedRevision: 0,
      operationId: 'durable-import',
    })
    expect(replay.sourceIds).toEqual(first.sourceIds)
    expect(test.state.library.value.sources).toHaveLength(2)
    const changed = await api.prepareImport({
      importerId: test.importer.id,
      files: [documentFile([{ ...candidates[0], text: 'different' }])],
    })
    await expect(
      api.commitImport({
        planId: changed.id,
        expectedRevision: changed.revision,
        operationId: 'durable-import',
      }),
    ).rejects.toThrow('不同的内容')
    await test.service.commands.close()
    const reopened = await setup(test.name, false)
    const restarted = await reopened.importDocument('durable-import')
    expect(restarted.sourceIds).toEqual(first.sourceIds)
    expect(reopened.state.library.value.materialReceipts).toHaveLength(1)
    expect(reopened.state.library.value.media).toHaveLength(3)
  })

  it('snapshots import identity and commit metadata before any asynchronous work', async () => {
    const test = await setup()
    const request = { importerId: test.importer.id, files: [documentFile()] }
    const pending = test.api.prepareImport(request)
    request.importerId = 'different-importer'
    request.files.splice(0)
    const plan = await pending
    const commit = reactive({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'original-operation',
    })
    const saved = test.api.commitImport(commit)
    commit.operationId = 'changed-during-commit'
    commit.expectedRevision = 9999
    await saved
    expect(test.state.library.value.materialReceipts[0]!.operationId).toBe('original-operation')
    expect(test.state.library.value.sources).toHaveLength(2)
  })

  it('snapshots reactive note and excerpt payloads so receipts describe exactly what was saved', async () => {
    const test = await setup()
    await test.importDocument()
    const source = test.state.library.value.sources[0]!
    const original = {
      sourceId: source.id,
      selection: select(source.id, source.mediaId),
      note: { ...input, tags: ['original'] },
      expectedRevision: test.api.snapshot().revision,
      operationId: 'owned-note',
    }
    const request = reactive(structuredClone(original))
    const pending = test.api.createNote(request)
    request.note.front = 'Mutation after call'
    request.note.tags.push('mutated')
    request.selection.text = 'forged'
    request.operationId = 'wrong-operation'
    const saved = await pending
    const note = test.state.library.value.notes.find((note) => note.id === saved.noteId)!
    expect(note.front).toBe(input.front)
    expect(note.tags).toEqual(['original'])
    expect(note.excerpt?.quote).toBe(original.selection.text)
    expect((await test.api.createNote(original)).noteId).toBe(saved.noteId)
    const excerpt = reactive({
      sourceId: source.id,
      selection: select(source.id, source.mediaId),
      title: 'Original title',
      expectedRevision: saved.revision,
      operationId: 'owned-excerpt',
    })
    const savingExcerpt = test.api.createExcerpt(excerpt)
    excerpt.title = 'Changed title'
    excerpt.operationId = 'changed-excerpt'
    excerpt.selection.text = 'forged'
    const created = await savingExcerpt
    expect(
      test.state.library.value.sources.find((source) => source.id === created.sourceId)!.title,
    ).toBe('Original title')
    expect(test.state.library.value.materialReceipts.map((receipt) => receipt.operationId)).toEqual(
      ['import-first', 'owned-note', 'owned-excerpt'],
    )
  })

  it('retains an import receipt after undo so retries cannot resurrect deleted results', async () => {
    const test = await setup()
    await test.importDocument('undo-import')
    await test.service.commands.undoLastOperation()
    expect(test.state.library.value.sources).toEqual([])
    expect(test.state.library.value.materialReceipts).toHaveLength(1)
    await expect(test.importDocument('undo-import')).rejects.toThrow('已撤销或删除')
    expect((await test.repo.load()).library.sources).toEqual([])
    await test.importDocument('intentional-new-import')
    expect(test.state.library.value.sources).toHaveLength(2)
  })

  it('binds notes and child excerpts to the selected immutable version, including a repeated Unicode quote', async () => {
    const test = await setup(),
      imported = await test.importDocument()
    const source = test.state.library.value.sources[0]!,
      selection = select(source.id, source.mediaId)
    await test.service.commands.acceptExternalSource(
      source.id,
      { title: 'Revised', url: '', format: 'plain', content: 'A new source body.' },
      { kind: 'source', id: source.id, path: 'sources/revised.txt', raw: '', expectedHash: null },
      'test-scan',
    )
    expect(test.state.library.value.sources[0]!.mediaId).not.toBe(source.mediaId)
    expect((await test.api.get(source.id, source.mediaId)).text).toBe(repeated)
    expect(await (await test.api.original(source.id, source.mediaId))!.text()).toBe(
      await documentFile().text(),
    )
    const result = await test.api.createNote({
      sourceId: source.id,
      selection,
      note: input,
      expectedRevision: test.api.snapshot().revision,
      operationId: 'selected-note',
    })
    const note = test.state.library.value.notes.find((note) => note.id === result.noteId)!
    expect(note.excerpt).toMatchObject({
      sourceId: source.id,
      mediaId: source.mediaId,
      start: repeated.lastIndexOf(selection.text),
      quote: selection.text,
      locator: selection.locator,
    })
    expect(
      (
        await test.api.createNote({
          sourceId: source.id,
          selection,
          note: input,
          expectedRevision: 0,
          operationId: 'selected-note',
        })
      ).noteId,
    ).toBe(result.noteId)
    const excerpt = await test.api.createExcerpt({
      sourceId: source.id,
      selection,
      title: '精确摘录',
      expectedRevision: result.revision,
      operationId: 'selected-excerpt',
    })
    const child = test.state.library.value.sources.find((source) => source.id === excerpt.sourceId)!
    expect(child.origin).toMatchObject({
      sourceId: imported.sourceIds[0],
      mediaId: source.mediaId,
      locator: selection.locator,
    })
    expect((await test.api.get(child.id)).text).toBe(selection.text)
    const current = test.api.snapshot().revision
    await expect(
      test.api.createNote({
        sourceId: source.id,
        selection: { ...selection, text: 'forged' },
        note: input,
        expectedRevision: current,
        operationId: 'forged-text',
      }),
    ).rejects.toThrow('不一致')
    await expect(
      test.api.createNote({
        sourceId: imported.sourceIds[1]!,
        selection,
        note: input,
        expectedRevision: current,
        operationId: 'wrong-source',
      }),
    ).rejects.toThrow()
    expect(test.state.library.value.notes).toHaveLength(1)
    await test.service.commands.undoLastOperation()
    await expect(
      test.api.createExcerpt({
        sourceId: source.id,
        selection,
        title: '精确摘录',
        expectedRevision: current,
        operationId: 'selected-excerpt',
      }),
    ).rejects.toThrow('已撤销或删除')
    await test.service.commands.undoLastOperation()
    await expect(
      test.api.createNote({
        sourceId: source.id,
        selection,
        note: input,
        expectedRevision: test.api.snapshot().revision,
        operationId: 'selected-note',
      }),
    ).rejects.toThrow('已撤销或删除')
    expect(test.state.library.value.notes).toHaveLength(0)
  })

  it('requires a precise text projection for a reserved PDF location and rejects broken Unicode boundaries', async () => {
    const test = await setup()
    // The importer is a fixture: this verifies locator transactions, not PDF parsing support.
    test.importer.extensions = ['.pdf']
    test.importer.parse = async () => [{ ...candidates[0]!, documentFormat: 'pdf' }]
    const plan = await test.prepare([
      new File(['%PDF-fixture'], 'lesson.pdf', { type: 'application/pdf' }),
    ])
    await test.api.commitImport({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'pdf-projection',
    })
    const source = test.state.library.value.sources[0]!,
      selected = select(source.id, source.mediaId)
    const start = repeated.lastIndexOf(selected.text)
    const pdfSelection: MaterialSelection = {
      text: selected.text,
      projection: { start, end: start + selected.text.length },
      locator: {
        schemaVersion: 1,
        sourceId: source.id,
        versionId: source.mediaId,
        kind: 'pdf',
        regions: [{ page: 2, x: 0.1, y: 0.3, width: 0.5, height: 0.2 }],
      },
    }
    const create = (selection: MaterialSelection, operationId: string) =>
      test.api.createNote({
        sourceId: source.id,
        selection,
        note: input,
        expectedRevision: test.api.snapshot().revision,
        operationId,
      })
    await expect(
      create({ ...pdfSelection, projection: undefined }, 'missing-projection'),
    ).rejects.toThrow('投影')
    await expect(
      create(
        { ...pdfSelection, projection: { start: 0, end: selected.text.length } },
        'wrong-projection',
      ),
    ).rejects.toThrow('不一致')
    const splitStart = repeated.indexOf('🧩') + 1,
      splitText = repeated.slice(splitStart, splitStart + 1)
    await expect(
      create(
        {
          text: splitText,
          locator: {
            schemaVersion: 1,
            sourceId: source.id,
            versionId: source.mediaId,
            kind: 'text',
            start: splitStart,
            end: splitStart + 1,
            quote: splitText,
          },
        },
        'split-unicode',
      ),
    ).rejects.toThrow()
    const result = await create(pdfSelection, 'pdf-note')
    expect(
      test.state.library.value.notes.find((note) => note.id === result.noteId)!.excerpt?.locator,
    ).toEqual(pdfSelection.locator)
  })

  it('rechecks the revision after an asynchronous selection read before saving a note', async () => {
    const test = await setup()
    await test.importDocument()
    const source = test.state.library.value.sources[0]!,
      gate = deferred<Blob | undefined>(),
      started = deferred<void>()
    const blob = await test.repo.getMedia(source.mediaId)
    vi.spyOn(test.repo, 'getMedia').mockImplementationOnce(() => {
      started.resolve()
      return gate.promise
    })
    const pending = test.api.createNote({
      sourceId: source.id,
      selection: select(source.id, source.mediaId),
      note: input,
      expectedRevision: test.api.snapshot().revision,
      operationId: 'late-note',
    })
    const rejected = expect(pending).rejects.toThrow('变化')
    await started.promise
    await test.service.commands.saveDeck(
      { ...test.state.library.value.decks[0]!, name: 'Changed while reading' },
      'deck',
    )
    gate.resolve(blob)
    await rejected
    expect((await test.repo.load()).library.notes).toEqual([])
    expect(test.state.library.value.materialReceipts).toHaveLength(1)
  })

  it('rejects a source read that finishes after library replacement', async () => {
    const test = await setup(),
      imported = await test.importDocument(),
      source = test.state.library.value.sources[0]!
    const blob = await test.repo.getMedia(source.document!.originalMediaId),
      gate = deferred<Blob | undefined>()
    vi.spyOn(test.repo, 'getMedia').mockReturnValueOnce(gate.promise)
    const pending = test.api.original(imported.sourceIds[0]!),
      rejected = expect(pending).rejects.toThrow('变化')
    const next = await setup()
    await test.service.commands.replaceRepository(next.repo)
    gate.resolve(blob)
    await rejected
    expect((await next.repo.load()).library.sources).toEqual([])
  })
})
