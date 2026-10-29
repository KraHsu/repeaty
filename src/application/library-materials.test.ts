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

const services: ReturnType<typeof createLibraryService>[] = []
const lifetimes: AbortController[] = []
afterEach(async () => {
  for (const controller of lifetimes.splice(0)) controller.abort()
  for (const service of services.splice(0)) await service.commands.close()
  vi.restoreAllMocks()
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
  it('rejects originals larger than the shared native media limit before invoking a parser', async () => {
    const test = await setup(),
      parse = vi.spyOn(test.importer, 'parse')
    await expect(
      test.prepare([
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.study.json', {
          type: 'application/json',
        }),
      ]),
    ).rejects.toThrow('单文件最多10 MB')
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
