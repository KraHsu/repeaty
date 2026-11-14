// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue'
import type { SourceConnectionApi } from '../application/library-connections'
import { sourceConnectionSchema, type SourceConnection } from '../core/collection-data'
import { useSourceConnections } from './useSourceConnections'

const platform = vi.hoisted(() => ({
  native: false,
  directoryConnections: vi.fn(),
  directoryChoose: vi.fn(),
  directoryList: vi.fn(),
  directoryRead: vi.fn(),
  directoryIndex: vi.fn(),
  directoryDisconnect: vi.fn(),
  directorySearch: vi.fn(),
  downloadOriginal: vi.fn(),
}))
vi.mock('@repeaty-collection-platform', () => ({
  get nativeCollection() {
    return platform.native
  },
  ...Object.fromEntries(Object.entries(platform).filter(([name]) => name !== 'native')),
}))
vi.mock('@repeaty-platform', () => ({ createExportFile: undefined }))

const scopes: EffectScope[] = []
beforeEach(() => {
  vi.resetAllMocks()
  platform.native = false
  platform.directoryConnections.mockResolvedValue([
    { id: 'grant', name: 'Notes', path: 'device-only', available: true },
  ])
  platform.directoryIndex.mockResolvedValue({ files: 1, skipped: 0, indexedAt: Date.now() })
})
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function connection(overrides: Partial<SourceConnection> = {}): SourceConnection {
  return {
    id: 'connection',
    pluginId: 'repeaty-directory',
    connectorId: 'text-directory',
    title: 'Notes',
    mode: 'import',
    status: 'connected',
    settings: { input: 'directory', directoryId: 'grant' },
    intervalHours: 0,
    generation: 0,
    createdAt: '2026-10-30T00:00:00.000Z',
    ...overrides,
  }
}
function fixture(initial = connection()) {
  const scope = ref('library-a'),
    ready = ref(true),
    library = shallowRef({ sourceConnections: [initial], sourceCandidates: [] })
  const owners = new Map<string, ReturnType<typeof createOwner>>()
  function createOwner(ownerScope: string) {
    let revision = 1
    const snapshot = () => ({
      revision,
      workspaceScope: ownerScope,
      connections: library.value.sourceConnections,
      candidates: [],
    })
    const save = vi.fn<SourceConnectionApi['save']>(async (request) => {
      const old = library.value.sourceConnections.find((c) => c.id === request.id)
      const saved = sourceConnectionSchema.parse({
        ...initial,
        ...old,
        pluginId: request.pluginId,
        connectorId: request.connectorId,
        title: request.title,
        mode: request.mode,
        id: old?.id ?? initial.id,
        settings: request.settings ?? old?.settings ?? {},
        status: request.status ?? old?.status ?? 'connected',
        intervalHours: request.intervalHours ?? old?.intervalHours ?? 0,
        generation: (old?.generation ?? -1) + 1,
      })
      library.value = { ...library.value, sourceConnections: [saved] }
      revision++
      return saved
    })
    return {
      snapshot,
      save,
      markChecked: vi.fn<SourceConnectionApi['markChecked']>(async () => {}),
      stage: vi.fn<SourceConnectionApi['stage']>(async (request) => ({
        candidates: request.snapshot.items.length,
      })),
      readCandidate: vi.fn<SourceConnectionApi['readCandidate']>(async () => ''),
      resolve: vi.fn<SourceConnectionApi['resolve']>(async () => ({})),
    }
  }
  function owner() {
    let value = owners.get(scope.value)
    if (!value) {
      value = createOwner(scope.value)
      owners.set(scope.value, value)
    }
    return value
  }
  const workspace = { scope, ready, library, sourceConnectionApi: owner }
  const plugins = { pluginRuntime: { installations: [] }, scanSourceConnector: vi.fn() }
  function mount() {
    const lifetime = effectScope()
    scopes.push(lifetime)
    const controller = lifetime.run(() =>
      useSourceConnections(
        workspace as unknown as Parameters<typeof useSourceConnections>[0],
        plugins as unknown as Parameters<typeof useSourceConnections>[1],
      ),
    )!
    return { controller, lifetime }
  }
  return { scope, ready, library, owner, mount }
}
function file(text: string, path = 'Vault/note.md') {
  const selected = new File([text], path.split('/').at(-1)!, { type: 'text/markdown' })
  Object.defineProperty(selected, 'webkitRelativePath', { value: path })
  return selected
}
async function authorize(
  test: ReturnType<typeof fixture>,
  controller: ReturnType<ReturnType<typeof fixture>['mount']>['controller'],
  files: File[],
) {
  const current = test.library.value.sourceConnections[0]!
  return controller.save({ ...current, files })
}

it('requires browser reauthorization after reload and scans only after the user selects files', async () => {
  const test = fixture(),
    first = test.mount(),
    api = test.owner()
  expect(first.controller.needsAuthorization.value).toEqual(['connection'])
  await expect(first.controller.scan('connection')).rejects.toThrow('尚未授权')
  expect(api.stage).not.toHaveBeenCalled()
  expect(platform.directoryList).not.toHaveBeenCalled()
  const saved = await authorize(test, first.controller, [file('# Selected body')])
  expect(first.controller.needsAuthorization.value).toEqual([])
  await first.controller.scan('connection')
  expect(api.stage).toHaveBeenCalledWith(
    {
      connectionId: 'connection',
      generation: saved.generation,
      snapshot: {
        complete: true,
        items: [
          {
            key: 'note.md',
            path: 'note.md',
            title: 'note',
            text: '# Selected body',
            format: 'markdown',
          },
        ],
      },
    },
    expect.any(AbortSignal),
  )
  first.lifetime.stop()
  const reloaded = test.mount()
  expect(reloaded.controller.needsAuthorization.value).toEqual(['connection'])
  expect(test.library.value.sourceConnections[0]!.id).toBe('connection')
})

it('keeps a new library scan alive when an old directory read resolves after switching libraries', async () => {
  const test = fixture(),
    { controller } = test.mount(),
    oldApi = test.owner(),
    oldRead = deferred<ArrayBuffer>(),
    newRead = deferred<ArrayBuffer>(),
    oldFile = file('old body'),
    newFile = file('new body')
  const oldReader = vi.spyOn(oldFile, 'arrayBuffer').mockReturnValue(oldRead.promise)
  const newReader = vi.spyOn(newFile, 'arrayBuffer').mockReturnValue(newRead.promise)
  await authorize(test, controller, [oldFile])
  const oldScan = controller.scan('connection')
  const oldRejected = expect(oldScan).rejects.toThrow()
  await vi.waitFor(() => expect(oldReader).toHaveBeenCalledOnce())
  test.scope.value = 'library-b'
  test.library.value = { sourceConnections: [connection()], sourceCandidates: [] }
  const newApi = test.owner()
  expect(controller.needsAuthorization.value).toEqual(['connection'])
  await authorize(test, controller, [newFile])
  const newScan = controller.scan('connection')
  await vi.waitFor(() => expect(newReader).toHaveBeenCalledOnce())
  oldRead.resolve(new TextEncoder().encode('old body').buffer)
  await oldRejected
  expect(oldApi.stage).not.toHaveBeenCalled()
  expect(controller.running.value).toEqual(['connection'])
  expect(newApi.stage).not.toHaveBeenCalled()
  newRead.resolve(new TextEncoder().encode('new body').buffer)
  await newScan
  expect(newApi.stage).toHaveBeenCalledOnce()
  expect(newApi.stage.mock.calls[0]![0].snapshot.items[0]!.text).toBe('new body')
  expect(controller.running.value).toEqual([])
  expect(controller.error.value).toBe('')
})

it('rejects an empty existing document instead of publishing a complete snapshot that implies deletion', async () => {
  const test = fixture(),
    { controller } = test.mount(),
    api = test.owner()
  await authorize(test, controller, [file('Original body')])
  await controller.scan('connection')
  api.stage.mockClear()
  await authorize(test, controller, [file(' \n\t')])
  await expect(controller.scan('connection')).rejects.toThrow('文件暂时为空')
  expect(api.stage).not.toHaveBeenCalled()
  expect(controller.error.value).toContain('本次检查未完成')
})

it('identifies missing native grants and rejects incomplete listings before staging candidates', async () => {
  platform.native = true
  platform.directoryConnections.mockResolvedValue([])
  const test = fixture(),
    { controller } = test.mount(),
    api = test.owner()
  await vi.waitFor(() => expect(controller.needsAuthorization.value).toEqual(['connection']))
  platform.directoryChoose.mockResolvedValue({
    id: 'grant',
    name: 'Notes',
    path: 'device-only',
    available: true,
  })
  await controller.chooseDirectory('grant')
  expect(controller.needsAuthorization.value).toEqual([])
  platform.directoryList.mockResolvedValue({
    files: [],
    skipped: [{ path: 'note.md', reason: 'file-too-large' }],
    complete: true,
  })
  await expect(controller.scan('connection')).rejects.toThrow('超过读取限制')
  expect(api.stage).not.toHaveBeenCalled()
  expect(platform.directoryRead).not.toHaveBeenCalled()
})

it('records successful index checks without rewriting connection settings or staging material candidates', async () => {
  platform.native = true
  const test = fixture(connection({ mode: 'index', generation: 8 })),
    { controller } = test.mount(),
    api = test.owner()
  await controller.scan('connection')
  expect(platform.directoryIndex).toHaveBeenCalledWith(
    'library-a',
    'grant',
    expect.any(AbortSignal),
  )
  expect(api.markChecked).toHaveBeenCalledExactlyOnceWith({
    connectionId: 'connection',
    generation: 8,
  })
  expect(api.save).not.toHaveBeenCalled()
  expect(api.stage).not.toHaveBeenCalled()
  expect(controller.running.value).toEqual([])
})

it('discards an index completion delivered after a library switch', async () => {
  platform.native = true
  const indexed = deferred<{ files: number; skipped: number; indexedAt: number }>()
  platform.directoryIndex.mockReturnValue(indexed.promise)
  const test = fixture(connection({ mode: 'index' })),
    { controller } = test.mount(),
    oldApi = test.owner(),
    pending = controller.scan('connection')
  const rejected = expect(pending).rejects.toThrow('学习库已变化')
  test.scope.value = 'library-b'
  await nextTick()
  indexed.resolve({ files: 1, skipped: 0, indexedAt: Date.now() })
  await rejected
  expect(oldApi.markChecked).not.toHaveBeenCalled()
  expect(test.owner().markChecked).not.toHaveBeenCalled()
  expect(controller.running.value).toEqual([])
  expect(controller.progress.value).toBe('')
})
