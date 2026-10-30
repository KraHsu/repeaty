// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, onUnmounted } from 'vue'
import { createPinia, disposePinia } from 'pinia'
import {
  createPluginManager,
  usePluginManager,
  providePluginManager,
  type PackageEntry,
  type PluginManager,
  type PluginStorage,
} from './manager'
import { createPluginRegistry, usePlugins } from '.'
import { packageHash, type PluginBundle } from './package'
import { useApplicationLifecycle } from '../app/useApplicationLifecycle'
import type { useLibrary } from '../composables/useLibrary'
import type { createPluginApi } from './sdk'
import AppPage from '../components/AppPage.vue'
import type { MaterialHostApi, MaterialSearchPage } from '@repeaty/plugin-api'

const managers: PluginManager[] = []

it('runs command orchestration separately from parsers, rejects stale revisions and clears facades on disable', async () => {
  let api!: ReturnType<typeof createPluginApi>
  const executions: string[] = []
  const env = environment([{ id: 'sample', bundle: bundle(), trusted: true }], (value) => {
    api = value
    value.registerCommand({
      id: 'import-now',
      title: 'Import',
      async run(ctx) {
        const plan = await value.materials.prepareImport(
          { importerId: 'study', files: [] },
          ctx.signal,
        )
        executions.push(plan.id)
      },
    })
  })
  env.manager.setMaterialHost(
    (plugin) =>
      ({
        capabilities: () => ({ available: true }),
        snapshot: () => ({ workspaceScope: plugin.scope, revision: 1, sources: [], decks: [] }),
        prepareImport: async () =>
          plugin.runTask({ id: 'child-import', title: 'Parse' }, async (ctx) => {
            await ctx.yield()
            return { id: 'plan', revision: 1, candidates: [] }
          }),
      }) as unknown as MaterialHostApi,
  )
  await env.manager.initializePlugins()
  await expect(
    env.manager.executeMaterialCommand('sample', 'import-now', {
      expectedRevision: 0,
      operationId: 'stale',
    }),
  ).rejects.toThrow('学习库已更新')
  await Promise.all([
    env.manager.executeMaterialCommand('sample', 'import-now', {
      expectedRevision: 1,
      operationId: 'first',
    }),
    env.manager.executeMaterialCommand('sample', 'import-now', {
      expectedRevision: 1,
      operationId: 'second',
    }),
  ])
  expect(executions).toEqual(['plan', 'plan'])
  expect(env.manager.materialApiFor('sample')).toBe(api.materials)
  await env.manager.enablePlugin('sample', false)
  expect(env.manager.materialApiFor('sample')).toBeUndefined()
  await expect(
    env.manager.executeMaterialCommand('sample', 'import-now', {
      expectedRevision: 1,
      operationId: 'late',
    }),
  ).rejects.toThrow('插件已卸载')
})

it('validates paged provider results against library identity and invalidates callbacks after a library switch', async () => {
  let result: MaterialSearchPage = {
    hits: [{ sourceId: 'source', versionId: 'version', title: 'Source', snippet: 'Found' }],
  }
  const callbacks: ((query: { text: string; limit: number }) => Promise<MaterialSearchPage>)[] = []
  const env = environment([{ id: 'sample', bundle: bundle(), trusted: true }], (api) => {
    api.registerSearchProvider({
      id: 'lookup',
      title: 'Lookup',
      async search() {
        return result
      },
    })
  })
  env.manager.setMaterialHost(
    (plugin) =>
      ({
        capabilities: () => ({ available: true }),
        snapshot: () => ({
          workspaceScope: plugin.scope,
          revision: 1,
          sources: [{ id: 'source', versionId: 'version' }],
          decks: [],
        }),
      }) as unknown as MaterialHostApi,
  )
  await env.manager.initializePlugins()
  const old = env.manager.pluginRuntime.installations[0]!.searchProviders![0]!
  callbacks.push((query) =>
    old.search(query, {
      signal: new AbortController().signal,
      progress: () => {},
      onCleanup: () => {},
      yield: async () => {},
    }),
  )
  expect(
    (await env.manager.searchMaterialProvider('sample', 'lookup', { text: 'word', limit: 1 })).hits,
  ).toHaveLength(1)
  result = {
    hits: [{ sourceId: 'other-library', versionId: 'version', title: 'Wrong', snippet: 'Wrong' }],
  }
  await expect(
    env.manager.searchMaterialProvider('sample', 'lookup', { text: 'word', limit: 1 }),
  ).rejects.toThrow('搜索结果无效')
  result = {
    hits: [{ sourceId: 'source', versionId: 'invented-version', title: 'Wrong', snippet: '' }],
  }
  await expect(
    env.manager.searchMaterialProvider('sample', 'lookup', { text: 'word', limit: 1 }),
  ).rejects.toThrow('搜索结果无效')
  result = {
    hits: [
      {
        sourceId: 'source',
        versionId: 'version',
        title: 'Wrong',
        snippet: '',
        locator: {
          schemaVersion: 1,
          sourceId: 'source',
          versionId: 'version',
          kind: 'image',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
      },
    ],
  }
  await expect(
    env.manager.searchMaterialProvider('sample', 'lookup', { text: 'word', limit: 1 }),
  ).rejects.toThrow('搜索结果无效')
  env.switchScope('local:second')
  await env.manager.initializePlugins('local:second')
  await expect(callbacks[0]!({ text: 'word', limit: 1 })).rejects.toThrow('插件已卸载')
})
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
})
it('denies material access during a candidate factory and preserves the published host after a failed update', async () => {
  let installed = bundle('published')
  const apis: ReturnType<typeof createPluginApi>[] = []
  const createNote = vi.fn(async () => ({ noteId: 'unexpected', revision: 1 }))
  const host = vi.fn(
    () =>
      ({
        capabilities: () => ({ available: true }),
        snapshot: () => ({ workspaceScope: 'local:staging', revision: 1, sources: [], decks: [] }),
        createNote,
      }) as unknown as MaterialHostApi,
  )
  const manager = createPluginManager({
    storage: {
      scope: async () => 'local:staging',
      list: async () => [{ id: 'sample', bundle: installed, trusted: true }],
      save: async (value) => {
        installed = value
      },
      remove: async () => {},
    },
    seedOfficial: false,
    readSetting: () => null,
    writeSetting: () => {},
    materialHost: host,
    evaluate: async (code, api) => {
      apis.push(api)
      expect(api.materials.capabilities().available).toBe(false)
      expect(() => api.materials.snapshot()).toThrow('尚未提供材料服务')
      api.registerImporter({
        id: 'sample',
        title: 'Sample',
        extensions: ['.sample'],
        parse: async () => [],
      })
      return {
        default: async () => {
          expect(api.materials.capabilities().available).toBe(false)
          if (code === 'broken-candidate') {
            await expect(api.materials.createNote({} as never)).rejects.toThrow('尚未提供材料服务')
            await expect(
              api.materials.prepareImport({ importerId: 'sample', files: [] }),
            ).rejects.toThrow('尚未提供材料服务')
            throw new Error('candidate-factory-failed')
          }
          return { id: 'sample', kind: 'frontend', type: 'extension', label: 'Sample', version: 1 }
        },
      }
    },
  })
  managers.push(manager)
  await manager.initializePlugins()
  const old = manager.pluginRuntime.installations[0]
  expect(apis[0]!.materials.capabilities().available).toBe(true)
  host.mockClear()
  await expect(manager.installPlugin(bundle('broken-candidate'))).rejects.toThrow(
    'candidate-factory-failed',
  )
  expect(createNote).not.toHaveBeenCalled()
  expect(host).not.toHaveBeenCalled()
  expect(manager.pluginRuntime.installations[0]).toBe(old)
  expect(manager.materialApiFor('sample')).toBe(apis[0]!.materials)
  expect(apis[0]!.materials.snapshot().revision).toBe(1)
  expect(installed.main).toBe('published')
  await expect(apis[1]!.materials.list()).rejects.toThrow('插件已卸载')
})
function bundle(main = 'first'): PluginBundle {
  return {
    manifest: {
      id: 'sample',
      name: 'Sample',
      version: '1.0.0',
      apiVersion: 1,
      dataVersion: 1,
      kind: 'frontend',
    },
    main,
    styles: '.sample {}',
  }
}
function environment(
  initial: PackageEntry[] = [],
  register?: (api: ReturnType<typeof createPluginApi>) => void,
) {
  const records = new Map(
    initial.filter((entry) => entry.bundle).map((entry) => [entry.id, entry.bundle!]),
  )
  const trusted = new Set(
    initial.filter((entry) => entry.trusted).map((entry) => entry.bundle?.main),
  )
  const settings = new Map<string, string>()
  const calls: { main: string; trust: boolean }[] = []
  let workspace = 'local:test'
  const storage: PluginStorage = {
    async scope() {
      return workspace
    },
    async list() {
      return [...records.values()].map((value) => ({
        id: value.manifest.id,
        bundle: value,
        trusted: trusted.has(value.main),
      }))
    },
    async save(value, trust = true) {
      calls.push({ main: value.main, trust })
      records.set(value.manifest.id, value)
      if (trust) trusted.add(value.main)
    },
    async remove(id) {
      records.delete(id)
    },
    async trust(id, hash) {
      const value = records.get(id)!
      expect(await packageHash(value)).toBe(hash)
      trusted.add(value.main)
    },
  }
  const manager = createPluginManager({
    storage,
    readSetting: (key) => settings.get(key) ?? null,
    writeSetting: (key, value) => {
      settings.set(key, value)
    },
    evaluate: async (code, api) => {
      if (code === 'broken') throw new Error('Broken module')
      register?.(api)
      return {
        default: {
          id: 'sample',
          kind: 'frontend',
          label: code,
          version: 1,
          showQuestion: { render: () => h('div', code) },
          showAnswer: { render: () => h('div', code) },
        },
      }
    },
  })
  managers.push(manager)
  return {
    manager,
    records,
    trusted,
    calls,
    storage,
    settings,
    switchScope: (scope: string) => {
      workspace = scope
    },
  }
}

it('isolates registered settings per manager and revokes the old API on disable or library switch', async () => {
  const apis: ReturnType<typeof createPluginApi>[] = []
  const contribution = () => ({
    id: 'preferences',
    title: 'Sample preferences',
    component: { render: () => h('div', 'Sample') },
  })
  const register = (api: ReturnType<typeof createPluginApi>) => {
    apis.push(api)
    api.registerSettings(contribution())
  }
  const entries = [{ id: 'sample', bundle: bundle(), trusted: true }]
  const a = environment(entries, register),
    b = environment(entries, register)
  await a.manager.initializePlugins()
  const firstApi = apis[0]!
  const oldA = a.manager.pluginRuntime.installations[0]!
  await b.manager.initializePlugins()
  const other = b.manager.pluginRuntime.installations[0]!
  expect(oldA.settings).toHaveLength(1)
  expect(other.settings).toHaveLength(1)
  expect(oldA.settings).not.toBe(other.settings)
  await a.manager.enablePlugin('sample', false)
  expect(oldA.settings).toHaveLength(0)
  expect(other.settings).toHaveLength(1)
  expect(() => firstApi.registerSettings(contribution())).toThrow('已卸载')
  await a.manager.enablePlugin('sample', true)
  const previousScopeApi = apis.at(-1)!
  const previousScope = a.manager.pluginRuntime.installations[0]!
  a.switchScope('local:next-library')
  await a.manager.initializePlugins('local:next-library')
  expect(previousScope.settings).toHaveLength(0)
  expect(a.manager.pluginRuntime.installations[0]!.settings).toHaveLength(1)
  expect(() => previousScopeApi.registerSettings(contribution())).toThrow('已卸载')
  expect(other.settings).toHaveLength(1)
})
it('isolates SDK pages and widgets per app and clears them on disable, scope changes and removal', async () => {
  const apis: ReturnType<typeof createPluginApi>[] = []
  const page = () => ({ id: 'page', title: 'Independent page', component: { render: () => null } })
  const register = (api: ReturnType<typeof createPluginApi>) => {
    apis.push(api)
    expect(api.AppPage).toBe(AppPage)
    api.registerPage(page())
    api.registerWidget({ ...page(), placement: 'overview.bottom' })
  }
  const entries = [{ id: 'sample', bundle: bundle(), trusted: true }]
  const a = environment(entries, register),
    b = environment(entries, register)
  await a.manager.initializePlugins()
  const firstApi = apis[0]!
  const oldA = a.manager.pluginRuntime.installations[0]!
  await b.manager.initializePlugins()
  const other = b.manager.pluginRuntime.installations[0]!
  expect(oldA.pages).toHaveLength(1)
  expect(other.pages).toHaveLength(1)
  expect(oldA.widgets).toHaveLength(1)
  expect(other.widgets).toHaveLength(1)
  expect(oldA.pages).not.toBe(other.pages)
  expect(oldA.widgets).not.toBe(other.widgets)
  await a.manager.enablePlugin('sample', false)
  expect(oldA.pages).toHaveLength(0)
  expect(oldA.widgets).toHaveLength(0)
  expect(() => firstApi.registerPage(page())).toThrow('已卸载')
  expect(() => firstApi.registerWidget({ ...page(), placement: 'overview.bottom' })).toThrow(
    '已卸载',
  )
  await a.manager.enablePlugin('sample', true)
  const previousApi = apis.at(-1)!
  const previousScope = a.manager.pluginRuntime.installations[0]!
  a.switchScope('local:next-library')
  await a.manager.initializePlugins('local:next-library')
  expect(previousScope.pages).toHaveLength(0)
  expect(previousScope.widgets).toHaveLength(0)
  expect(() => previousApi.registerPage(page())).toThrow('已卸载')
  expect(() => previousApi.registerWidget({ ...page(), placement: 'overview.bottom' })).toThrow(
    '已卸载',
  )
  expect(a.manager.pluginRuntime.installations[0]!.pages).toHaveLength(1)
  expect(a.manager.pluginRuntime.installations[0]!.widgets).toHaveLength(1)
  expect(other.pages).toHaveLength(1)
  const removed = a.manager.pluginRuntime.installations[0]!
  const removedApi = apis.at(-1)!
  await a.manager.removePlugin('sample')
  expect(removed.pages).toHaveLength(0)
  expect(removed.widgets).toHaveLength(0)
  expect(() => removedApi.registerPage(page())).toThrow('已卸载')
  expect(() => removedApi.registerWidget({ ...page(), placement: 'overview.bottom' })).toThrow(
    '已卸载',
  )
  expect(other.pages).toHaveLength(1)
  expect(other.widgets).toHaveLength(1)
})
it('keeps app-owned registries, module instances, preferences and disposal independent', async () => {
  const a = environment([{ id: 'sample', bundle: bundle(), trusted: true }]),
    b = environment([{ id: 'sample', bundle: bundle(), trusted: true }])
  await Promise.all([a.manager.initializePlugins(), b.manager.initializePlugins()])
  const first = createPluginRegistry(a.manager),
    second = createPluginRegistry(b.manager)
  expect(first.installedPlugins).not.toBe(second.installedPlugins)
  expect(first.installedPlugins[0]!.plugin).not.toBe(second.installedPlugins[0]!.plugin)
  const apps = [a.manager, b.manager].map((manager) => {
    const app = createApp({
      setup() {
        providePluginManager(manager)
        onUnmounted(() => {
          void manager.dispose()
        })
        return () =>
          h({
            setup() {
              const registry = usePlugins()
              return () =>
                h(
                  'span',
                  registry.questionPlugin({
                    type: 'plugin',
                    plugin: { id: 'sample', version: 1, data: {} },
                  }).label,
                )
            },
          })
      },
    })
    const root = document.createElement('div')
    document.body.append(root)
    app.use(createPinia())
    app.mount(root)
    return { app, root }
  })
  expect(apps[0]!.root.textContent).toBe('first')
  expect(apps[1]!.root.textContent).toBe('first')
  await first.setPluginEnabled('sample', false)
  expect(first.pluginEnabled('sample')).toBe(false)
  expect(second.pluginEnabled('sample')).toBe(true)
  apps[0]!.app.unmount()
  await Promise.resolve()
  expect(second.pluginEnabled('sample')).toBe(true)
  expect(b.manager.pluginPackages).toHaveLength(1)
  apps[1]!.app.unmount()
  for (const { root } of apps) root.remove()
})
it('creates a distinct manager per Pinia while inheriting the configured host adapter', async () => {
  const first = createPinia(),
    second = createPinia()
  const a = usePluginManager(first),
    b = usePluginManager(second)
  managers.push(a, b)
  expect(a).toBe(usePluginManager(first))
  expect(a).not.toBe(b)
  await Promise.all([a.initializePlugins(), b.initializePlugins()])
  expect(a.pluginRuntime.installations).not.toBe(b.pluginRuntime.installations)
  if (a.pluginRuntime.installations.length)
    expect(a.pluginRuntime.installations[0]!.plugin).not.toBe(
      b.pluginRuntime.installations[0]!.plugin,
    )
  disposePinia(first)
  await Promise.resolve()
  expect(a.pluginRuntime.installations).toHaveLength(0)
  expect(b.pluginRuntime.installations.length).toBeGreaterThan(0)
  disposePinia(second)
})
it('rolls back a failed replacement without trusting the previously unapproved package', async () => {
  const { manager, records, trusted, calls } = environment([
    { id: 'sample', bundle: bundle('manual'), trusted: false },
  ])
  await manager.initializePlugins()
  await expect(manager.installPlugin(bundle('broken'))).rejects.toThrow('Broken module')
  expect(records.get('sample')!.main).toBe('manual')
  expect(trusted.has('manual')).toBe(false)
  expect(calls).toEqual([
    { main: 'broken', trust: true },
    { main: 'manual', trust: false },
  ])
  await manager.reloadPlugins()
  expect(manager.pluginPackages[0]!.trusted).toBe(false)
  expect(manager.pluginRuntime.installations).toHaveLength(0)
})
it('restores plain persisted bytes after a failed browser package update and keeps the old activation', async () => {
  const settings = new Map<string, string>()
  const manager = createPluginManager({
    // Bypass setup-external-plugins' shared in-memory adapter; exercise structured-clone IDB.
    storage: undefined,
    seedOfficial: false,
    readSetting: (key) => settings.get(key) ?? null,
    writeSetting: (key, value) => {
      settings.set(key, value)
    },
    evaluate: async (main) => {
      if (main === 'broken') throw new Error('broken-update')
      return {
        default: {
          id: 'sample',
          kind: 'frontend',
          label: main,
          version: 1,
          reviewPanel: { render: () => null },
        },
      }
    },
  })
  managers.push(manager)
  await manager.initializePlugins(`local:rollback-${crypto.randomUUID()}`)
  await manager.installPlugin(bundle('before-update'))
  const old = manager.pluginRuntime.installations[0]
  await expect(manager.installPlugin(bundle('broken'))).rejects.toThrow('broken-update')
  expect(manager.pluginRuntime.installations[0]).toBe(old)
  await manager.reloadPlugins()
  expect(manager.pluginPackages[0]!.bundle!.main).toBe('before-update')
  expect(manager.pluginRuntime.installations[0]!.plugin.label).toBe('before-update')
  await manager.removePlugin('sample')
})
it('removes failed first installations instead of hiding a trusted package until restart', async () => {
  const { manager, records } = environment()
  await manager.initializePlugins()
  await expect(manager.installPlugin(bundle('broken'))).rejects.toThrow('Broken module')
  expect(records.size).toBe(0)
  expect(manager.pluginPackages).toHaveLength(0)
  await manager.reloadPlugins()
  expect(manager.pluginRuntime.installations).toHaveLength(0)
})
it('does not replace a mounted review when a view opens during persistence', async () => {
  const { manager, storage, records } = environment([
    { id: 'sample', bundle: bundle(), trusted: true },
  ])
  await manager.initializePlugins()
  const save = storage.save
  let started = false,
    resume!: () => void
  storage.save = async (value, trust) => {
    if (value.main === 'second') {
      started = true
      await new Promise<void>((resolve) => {
        resume = resolve
      })
    }
    await save(value, trust)
  }
  const replacing = manager.installPlugin(bundle('second'))
  await vi.waitFor(() => expect(started).toBe(true))
  const release = manager.holdPluginRuntime()
  resume()
  await expect(replacing).rejects.toThrow('请先结束复习')
  expect(records.get('sample')!.main).toBe('first')
  expect(manager.pluginRuntime.installations[0]!.plugin.label).toBe('first')
  release()
})
it('does not reseed after a manually supplied first package is removed', async () => {
  const seeded = new Map<string, string>()
  const official = vi.fn(async () => [bundle('official')])
  let installed = true
  const manager = createPluginManager({
    seedOfficial: true,
    officialBundles: official,
    storage: {
      async scope() {
        return 'local:seed'
      },
      async list() {
        return installed ? [{ id: 'sample', bundle: bundle('manual'), trusted: false }] : []
      },
      async save() {
        installed = true
      },
      async remove() {
        installed = false
      },
    },
    readSetting: (key) => seeded.get(key) ?? null,
    writeSetting: (key, value) => {
      seeded.set(key, value)
    },
  })
  managers.push(manager)
  await manager.initializePlugins()
  expect(official).not.toHaveBeenCalled()
  await manager.removePlugin('sample')
  await manager.reloadPlugins()
  expect(official).not.toHaveBeenCalled()
  expect(manager.pluginPackages).toHaveLength(0)
})
it('requests only default packages for a fresh library and preserves an empty uninstalled library', async () => {
  const records = new Map<string, PluginBundle>()
  const settings = new Map<string, string>()
  const optional = { ...bundle(), manifest: { ...bundle().manifest, id: 'review-heatmap' } }
  const official = vi.fn(async (options?: { defaultsOnly?: boolean }) =>
    options?.defaultsOnly ? [bundle()] : [bundle(), optional],
  )
  const manager = createPluginManager({
    seedOfficial: true,
    officialBundles: official,
    storage: {
      async scope() {
        return 'local:optional-plugins'
      },
      async list() {
        return [...records.values()].map((value) => ({
          id: value.manifest.id,
          bundle: value,
          trusted: true,
        }))
      },
      async save(value) {
        records.set(value.manifest.id, value)
      },
      async remove(id) {
        records.delete(id)
      },
    },
    readSetting: (key) => settings.get(key) ?? null,
    writeSetting: (key, value) => {
      settings.set(key, value)
    },
    evaluate: async () => ({
      default: {
        id: 'sample',
        kind: 'frontend',
        label: 'Default',
        version: 1,
        reviewPanel: { render: () => null },
      },
    }),
  })
  managers.push(manager)
  await manager.initializePlugins()
  expect(official).toHaveBeenCalledExactlyOnceWith({ defaultsOnly: true })
  expect([...records.keys()]).toEqual(['sample'])
  await manager.removePlugin('sample')
  await manager.reloadPlugins()
  expect(official).toHaveBeenCalledTimes(1)
  expect(records.size).toBe(0)
  expect(manager.pluginPackages).toHaveLength(0)
})
it('unmount cancels a late package scan and never initializes the closed learning library', async () => {
  let resolve!: (entries: PackageEntry[]) => void,
    started = false
  const manager = createPluginManager({
    storage: {
      async scope() {
        return 'local:late'
      },
      list() {
        started = true
        return new Promise((done) => {
          resolve = done
        })
      },
      async save() {},
      async remove() {},
    },
  })
  managers.push(manager)
  const workspace = {
    init: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    backupNow: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useLibrary>
  const app = createApp({
    setup() {
      useApplicationLifecycle(
        { workspace, plugins: manager, globalKeydown: () => {}, tick: () => {} },
        {
          connectLearningReader: async () => () => {},
          connectWorkspaceMonitor: async () => () => {},
          listenPluginPreferences: () => () => {},
          listenPreferences: () => () => {},
        },
      )
      return () => h('div')
    },
  })
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  await vi.waitFor(() => expect(started).toBe(true))
  app.unmount()
  resolve([])
  await vi.waitFor(() => expect(workspace.close).toHaveBeenCalledTimes(1))
  expect(workspace.init).not.toHaveBeenCalled()
  expect(manager.pluginPackages).toHaveLength(0)
  root.remove()
})
