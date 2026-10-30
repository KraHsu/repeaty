import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLibraryState } from '../composables/library-state'
import { createRepository } from '../core/storage'
import { createLibraryService } from './library'
import { queuedSources } from '../core/source-queue'
import { exportBackup, parseBackup, rekeyBackup } from '../core/backups'
import { librarySchema } from '../core/model'
import { exportArchive, parseArchive } from '../core/archive'
import type { CollectionParser } from './library-collection'

const services: ReturnType<typeof createLibraryService>[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.commands.close()
  vi.restoreAllMocks()
})
async function setup() {
  const repo = createRepository(`collection-${crypto.randomUUID()}`),
    state = createLibraryState(),
    service = createLibraryService(state, {
      createWorkspaceRepository: async () => repo,
      remoteWorkspace: { value: false },
      desktopEdition: false,
      canReviewCard: () => true,
    })
  services.push(service)
  await service.commands.init()
  const api = service.commands.collectionApi(() => []),
    connections = service.commands.sourceConnectionApi()
  return { repo, state, service, api, connections }
}
async function capture(test: Awaited<ReturnType<typeof setup>>, text = 'Collected text') {
  const plan = await test.api.prepareCollection({
    text: { text, title: 'Capture' },
    destination: 'inbox',
  })
  return test.api.commitCollection({
    planId: plan.id,
    expectedRevision: plan.revision,
    operationId: crypto.randomUUID(),
  })
}
const item = {
  key: 'note.md',
  title: 'Upstream note',
  text: 'First source text',
  format: 'markdown' as const,
  path: 'note.md',
}
async function connect(test: Awaited<ReturnType<typeof setup>>) {
  return test.connections.save({
    expectedRevision: test.connections.snapshot().revision,
    pluginId: 'obsidian',
    connectorId: 'vault',
    title: 'Vault',
    mode: 'import',
  })
}

describe('persistent unified collection', () => {
  it('requires an explicit parser for ambiguous formats and uses only that parser', async () => {
    const test = await setup()
    const first = vi.fn(async () => [
      {
        key: 'one',
        title: 'Independent',
        text: 'Chapter',
        format: 'plain' as const,
        documentFormat: 'epub',
      },
    ])
    const second = vi.fn(async () => [
      {
        key: 'one',
        title: 'Sequential',
        text: 'Chapter',
        format: 'plain' as const,
        documentFormat: 'epub',
      },
    ])
    const parsers: CollectionParser[] = [
      {
        pluginId: 'reader',
        id: 'independent',
        title: 'Independent chapters',
        extensions: ['.epub'],
        current: () => true,
        parse: first,
      },
      {
        pluginId: 'reader',
        id: 'sequential',
        title: 'Sequential chapters',
        extensions: ['.epub'],
        current: () => true,
        parse: second,
      },
    ]
    const api = test.service.commands.collectionApi(() => parsers)
    const request = { files: [new File(['book'], 'book.epub')], destination: 'library' as const }
    const before = test.state.library.value
    expect(api.importers?.().map((parser) => parser.title)).toEqual([
      'Independent chapters',
      'Sequential chapters',
    ])
    await expect(api.prepareCollection(request)).rejects.toThrow('多种导入方式')
    await expect(
      api.prepareCollection({ ...request, importers: { 'book.epub': 'missing:parser' } }),
    ).rejects.toThrow('所选导入器已不可用')
    expect(test.state.library.value).toBe(before)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    const plan = await api.prepareCollection({
      ...request,
      importers: { 'book.epub': 'reader:sequential' },
    })
    expect(plan.candidates[0]!.title).toBe('Sequential')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('always preserves the built-in Markdown/plain-text path despite competing plugin parsers', async () => {
    const test = await setup()
    const parse = vi.fn(async () => [])
    const api = test.service.commands.collectionApi(() =>
      ['one', 'two'].map((id) => ({
        pluginId: 'other',
        id,
        title: id,
        extensions: ['.MD', '.txt'],
        current: () => true,
        parse,
      })),
    )
    const text = '  Exact UTF-8 中文🙂\n\n'
    const plan = await api.prepareCollection({
      files: [new File([text], 'plain.MD')],
      importers: { 'plain.MD': 'other:one' },
      destination: 'library',
    })
    const result = await api.commitCollection({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: 'builtin-priority',
    })
    const source = test.state.library.value.sources.find(
      (source) => source.id === result.sourceIds[0],
    )!
    expect(await (await test.repo.getMedia(source.mediaId))!.text()).toBe(text)
    expect(parse).not.toHaveBeenCalled()
  })

  it('previews without writes, commits atomically, deduplicates retry and survives reopen/portable backup', async () => {
    const test = await setup(),
      before = test.state.library.value
    const plan = await test.api.prepareCollection({
      files: [new File(['Alpha'], 'a.md'), new File(['Beta'], 'b.txt')],
      destination: 'inbox',
    })
    expect(test.state.library.value).toBe(before)
    const request = { planId: plan.id, expectedRevision: plan.revision, operationId: 'first' }
    const result = await test.api.commitCollection(request)
    expect(await test.api.commitCollection(request)).toEqual(result)
    expect(test.state.library.value.sources).toHaveLength(2)
    expect(queuedSources(test.state.library.value.sources, 'ready', '2026-10-30')).toHaveLength(0)
    const again = await test.api.prepareCollection({
      files: [new File(['Alpha'], 'a.md')],
      destination: 'inbox',
    })
    expect(again.candidates[0]?.duplicate).toBe(true)
    await test.api.commitCollection({
      planId: again.id,
      expectedRevision: again.revision,
      operationId: 'duplicate',
    })
    expect(test.state.library.value.sources).toHaveLength(2)
    const json = await exportBackup(test.state.library.value, (id) => test.repo.getMedia(id))
    expect(parseBackup(json).library.sources.map((s) => s.inbox?.state)).toEqual(['new', 'new'])
    const source = test.state.library.value.sources[0]!
    await test.api.organizeInbox({
      sourceId: source.id,
      action: 'file',
      title: 'Organized',
      expectedRevision: test.api.snapshot().revision,
      operationId: 'organize',
    })
    expect(queuedSources(test.state.library.value.sources, 'ready', '2026-10-30')).toHaveLength(1)
    await test.service.commands.undoLastOperation()
    expect(test.state.library.value.sources[0]!.inbox?.state).toBe('new')
    expect((await test.repo.load()).library.sources).toEqual(test.state.library.value.sources)
  })
  it('cancels or fails mixed parsing without leaving partial source/media records and rejects unloaded plugins', async () => {
    const test = await setup(),
      controller = new AbortController(),
      before = test.state.library.value
    const parser: CollectionParser = {
      pluginId: 'reader',
      id: 'binary',
      title: 'Binary reader',
      extensions: ['.bin'],
      current: () => !controller.signal.aborted,
      parse: async () => {
        controller.abort()
        return [
          { key: 'one', title: 'Binary', text: 'Body', format: 'plain', documentFormat: 'plain' },
        ]
      },
    }
    const api = test.service.commands.collectionApi(() => [parser])
    await expect(
      api.prepareCollection({
        files: [new File(['text'], 'first.txt'), new File(['binary'], 'second.bin')],
        destination: 'inbox',
      }),
    ).rejects.toThrow('导入器')
    expect(test.state.library.value).toBe(before)
    await expect(
      test.api.prepareCollection({
        files: [new File([new Uint8Array([255])], 'bad.txt')],
        destination: 'inbox',
      }),
    ).rejects.toThrow()
    const plan = await test.api.prepareCollection({ text: { text: 'draft' }, destination: 'inbox' })
    test.api.discardCollection(plan.id)
    await expect(
      test.api.commitCollection({
        planId: plan.id,
        expectedRevision: plan.revision,
        operationId: 'cancelled',
      }),
    ).rejects.toThrow('过期')
    expect(test.state.library.value).toBe(before)
  })
  it('preserves a reviewable plan after persistence failure and rejects stale library scope', async () => {
    const test = await setup(),
      plan = await test.api.prepareCollection({ text: { text: 'Retry me' }, destination: 'inbox' })
    const request = { planId: plan.id, expectedRevision: plan.revision, operationId: 'retry' }
    const save = vi.spyOn(test.repo, 'save').mockRejectedValueOnce(new Error('disk full'))
    await expect(test.api.commitCollection(request)).rejects.toThrow('disk full')
    expect(test.state.library.value.sources).toHaveLength(0)
    save.mockRestore()
    await test.api.commitCollection(request)
    const old = test.api
    test.state.scope.value = 'other'
    await expect(
      old.prepareCollection({ text: { text: 'stale' }, destination: 'inbox' }),
    ).rejects.toThrow('学习库')
  })
})

describe('reviewable source connection snapshots', () => {
  it('offers an unchanged restored source for confirmation and preserves its identity', async () => {
    const test = await setup(),
      connection = await connect(test)
    const stage = (items: (typeof item)[]) =>
      test.connections.stage({
        connectionId: connection.id,
        generation: connection.generation,
        snapshot: { items, complete: true },
      })
    await stage([item])
    await test.connections.resolve({
      candidateId: test.connections.snapshot().candidates[0]!.id,
      action: 'accept',
      expectedRevision: test.connections.snapshot().revision,
    })
    const original = test.state.library.value.sources[0]!
    await stage([])
    await test.connections.resolve({
      candidateId: test.connections.snapshot().candidates[0]!.id,
      action: 'accept',
      expectedMediaId: original.mediaId,
      expectedRevision: test.connections.snapshot().revision,
    })
    expect(test.state.library.value.sources[0]!.binding?.missing).toBe(true)
    await stage([item])
    const restored = test.connections.snapshot().candidates[0]!
    expect(restored.kind).toBe('update')
    expect(restored.sourceId).toBe(original.id)
    expect(test.state.library.value.sources[0]!.binding?.missing).toBe(true)
    expect(test.state.library.value.sources[0]!.mediaId).toBe(original.mediaId)
    await test.connections.resolve({
      candidateId: restored.id,
      action: 'accept',
      expectedMediaId: original.mediaId,
      expectedRevision: test.connections.snapshot().revision,
    })
    const accepted = test.state.library.value.sources[0]!
    expect(accepted.id).toBe(original.id)
    expect(accepted.binding?.missing).toBeUndefined()
    expect(accepted.versions?.[0]?.mediaId).toBe(original.mediaId)
    await stage([item])
    expect(test.connections.snapshot().candidates).toHaveLength(0)
  })
  it('records index checks without reconfiguring the connection and rejects stale completions', async () => {
    const test = await setup(),
      connection = await test.connections.save({
        expectedRevision: test.connections.snapshot().revision,
        pluginId: 'repeaty-directory',
        connectorId: 'text-directory',
        title: 'Read-only index',
        mode: 'index',
      })
    await capture(test)
    const operations = test.state.operations.value,
      revision = test.connections.snapshot().revision,
      earliest = Date.now()
    await test.connections.markChecked({
      connectionId: connection.id,
      generation: connection.generation,
    })
    const checked = test.connections.snapshot().connections[0]!
    expect(checked.generation).toBe(connection.generation)
    expect(Date.parse(checked.checkedAt!)).toBeGreaterThanOrEqual(earliest)
    expect(Date.parse(checked.checkedAt!)).toBeLessThanOrEqual(Date.now())
    expect(test.connections.snapshot().revision).toBe(revision + 1)
    expect(test.state.operations.value).toEqual(operations)
    expect((await test.repo.load()).library.sourceConnections[0]!.checkedAt).toBe(checked.checkedAt)
    const reconfigured = await test.connections.save({
      ...checked,
      title: 'Changed connection',
      expectedRevision: test.connections.snapshot().revision,
    })
    const before = test.state.library.value
    await expect(
      test.connections.markChecked({
        connectionId: connection.id,
        generation: connection.generation,
      }),
    ).rejects.toThrow('配置已变化')
    expect(test.state.library.value).toBe(before)
    test.state.scope.value = 'another-library'
    await expect(
      test.connections.markChecked({
        connectionId: connection.id,
        generation: reconfigured.generation,
      }),
    ).rejects.toThrow('学习库已变化')
    expect(test.state.library.value).toBe(before)
  })
  it('is idempotent, preserves old versions and local edits until explicit acceptance, retains data on disconnect', async () => {
    const test = await setup(),
      connection = await connect(test)
    const stage = (text: string) =>
      test.connections.stage({
        connectionId: connection.id,
        generation: connection.generation,
        snapshot: { items: [{ ...item, text }], complete: true },
      })
    await stage(item.text)
    expect(test.state.library.value.sources).toHaveLength(0)
    let candidate = test.connections.snapshot().candidates[0]!
    await test.connections.resolve({
      candidateId: candidate.id,
      action: 'accept',
      expectedRevision: test.connections.snapshot().revision,
    })
    const first = test.state.library.value.sources[0]!
    await stage(item.text)
    expect(test.connections.snapshot().candidates).toHaveLength(0)
    await stage('Second version')
    candidate = test.connections.snapshot().candidates[0]!
    expect(test.state.library.value.sources[0]!.mediaId).toBe(first.mediaId)
    expect(await test.connections.readCandidate(candidate.id)).toBe('Second version')
    await expect(
      test.connections.resolve({
        candidateId: candidate.id,
        action: 'accept',
        expectedRevision: test.connections.snapshot().revision,
      }),
    ).rejects.toThrow('本地版本')
    await test.connections.resolve({
      candidateId: candidate.id,
      action: 'accept',
      expectedMediaId: first.mediaId,
      expectedRevision: test.connections.snapshot().revision,
    })
    const updated = test.state.library.value.sources[0]!
    expect(updated.id).toBe(first.id)
    expect(updated.versions?.[0]?.mediaId).toBe(first.mediaId)
    await test.connections.save({
      ...connection,
      status: 'disconnected',
      expectedRevision: test.connections.snapshot().revision,
    })
    await expect(stage('After disconnect')).rejects.toThrow('断开')
    expect(test.state.library.value.sources[0]).toEqual(updated)
    const backup = rekeyBackup(
      parseBackup(await exportBackup(test.state.library.value, (id) => test.repo.getMedia(id))),
    )
    expect(librarySchema.safeParse(backup.library).success).toBe(true)
    expect(backup.library.sources[0]!.binding?.acceptedMediaId).toBe(
      backup.library.sources[0]!.mediaId,
    )
    expect(backup.library.sourceConnections[0]!.status).toBe('disconnected')
  })
  it('does not infer deletion from partial snapshots and supports confirmed rename/relink without replacing identity', async () => {
    const test = await setup(),
      connection = await connect(test),
      stage = (items: (typeof item)[], complete: boolean) =>
        test.connections.stage({
          connectionId: connection.id,
          generation: connection.generation,
          snapshot: { items, complete },
        })
    await stage([item], true)
    await test.connections.resolve({
      candidateId: test.connections.snapshot().candidates[0]!.id,
      action: 'accept',
      expectedRevision: test.connections.snapshot().revision,
    })
    const source = test.state.library.value.sources[0]!
    await stage([], false)
    expect(test.connections.snapshot().candidates).toHaveLength(0)
    await stage([{ ...item, key: 'renamed.md', path: 'renamed.md' }], true)
    expect(
      test.connections
        .snapshot()
        .candidates.map((c) => c.kind)
        .sort(),
    ).toEqual(['add', 'missing'])
    await test.connections.resolve({
      candidateId: test.connections.snapshot().candidates.find((c) => c.kind === 'add')!.id,
      action: 'accept',
      targetSourceId: source.id,
      expectedMediaId: source.mediaId,
      expectedRevision: test.connections.snapshot().revision,
    })
    expect(test.state.library.value.sources).toHaveLength(1)
    expect(test.state.library.value.sources[0]!.binding?.key).toBe('renamed.md')
    expect(test.connections.snapshot().candidates).toHaveLength(0)
  })
  it('keeps ignored candidates restart-safe, rolls back scan failures, and exports pending resource bytes', async () => {
    const test = await setup(),
      connection = await connect(test)
    const input = {
      connectionId: connection.id,
      generation: connection.generation,
      snapshot: {
        items: [
          {
            ...item,
            resources: [{ path: 'image.png', blob: new Blob(['png'], { type: 'image/png' }) }],
          },
        ],
        complete: true,
      },
    }
    await test.connections.stage(input)
    const candidate = test.connections.snapshot().candidates[0]!
    await test.connections.resolve({
      candidateId: candidate.id,
      action: 'keep',
      expectedRevision: test.connections.snapshot().revision,
    })
    await test.connections.stage(input)
    expect(test.connections.snapshot().candidates).toHaveLength(1)
    expect(test.connections.snapshot().candidates[0]!.dismissed).toBe(true)
    const before = test.state.library.value
    const failure = vi.spyOn(test.repo, 'save').mockRejectedValueOnce(new Error('disk full'))
    await expect(
      test.connections.stage({
        ...input,
        snapshot: { items: [{ ...item, text: 'Changed' }], complete: true },
      }),
    ).rejects.toThrow('disk full')
    expect(test.state.library.value).toBe(before)
    failure.mockRestore()
    const restored = await parseArchive(
      (await exportArchive(test.state.library.value, (id) => test.repo.getMedia(id)))!,
    )
    expect(restored.library.sourceCandidates[0]?.resources?.[0]?.path).toBe('image.png')
    expect(librarySchema.safeParse(rekeyBackup(restored).library).success).toBe(true)
  })
  it('aborts a scan without writes and isolates APIs across workspace changes', async () => {
    const test = await setup(),
      connection = await connect(test),
      controller = new AbortController()
    controller.abort()
    await expect(
      test.connections.stage(
        {
          connectionId: connection.id,
          generation: connection.generation,
          snapshot: { items: [item], complete: true },
        },
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(test.state.library.value.sourceCandidates).toHaveLength(0)
    await capture(test)
    test.state.scope.value = 'new-library'
    await expect(
      test.connections.stage({
        connectionId: connection.id,
        generation: connection.generation,
        snapshot: { items: [item], complete: true },
      }),
    ).rejects.toThrow('学习库')
  })
})
