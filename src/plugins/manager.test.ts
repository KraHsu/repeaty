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
import { createPluginPreferences, PLUGIN_PREFERENCES_KEY } from './preferences'

const managers: PluginManager[] = []

it.each(['static-publish', 'wordpress-publish', 'discourse-publish'])(
  'retains the installed %s package for explicit removal without running or rewriting it',
  async (id) => {
    const previous = { ...bundle('retired'), manifest: { ...bundle().manifest, id } }
    const register = vi.fn()
    const env = environment([{ id, bundle: previous, trusted: true }], register)
    await env.manager.initializePlugins()
    expect(register).not.toHaveBeenCalled()
    expect(env.manager.pluginRuntime.installations).toHaveLength(0)
    expect(env.manager.pluginPackages[0]?.error).toContain('网站发布功能已移除')
    expect(env.records.get(id)).toEqual(previous)
    expect(env.calls).toEqual([])

    await expect(env.manager.enablePlugin(id, true)).rejects.toThrow('网站发布功能已移除')
    await env.manager.enablePlugin(id, false)
    await env.manager.reloadPlugins()
    expect(env.records.get(id)).toEqual(previous)
    expect(register).not.toHaveBeenCalled()
    await env.manager.removePlugin(id)
    expect(env.records.has(id)).toBe(false)
    expect(env.manager.pluginPackages).toHaveLength(0)
  },
)

it('rejects a removed publisher before granting trust or replacing persisted package bytes', async () => {
  const id = 'static-publish'
  const previous = { ...bundle('untrusted'), manifest: { ...bundle().manifest, id } }
  const env = environment([{ id, bundle: previous, trusted: false }])
  await env.manager.initializePlugins()
  await expect(env.manager.enablePlugin(id, true)).rejects.toThrow('网站发布功能已移除')
  expect(env.trusted.has('untrusted')).toBe(false)
  await expect(env.manager.installPlugin({ ...previous, main: 'replacement' })).rejects.toThrow(
    '网站发布功能已移除',
  )
  expect(env.calls).toEqual([])
  expect(env.records.get(id)).toEqual(previous)
})

it('opens wildcard material tools for current formats and disposes their context on disable', async () => {
  const env = environment([{ id: 'sample', bundle: bundle(), trusted: true }], (api) => {
    api.registerCommand({
      id: 'lookup',
      title: 'Lookup',
      formats: ['*'],
      component: { render: () => h('p', 'Lookup') },
    })
    api.registerCommand({
      id: 'only-pdf',
      title: 'PDF',
      formats: ['pdf'],
      component: { render: () => h('p', 'PDF') },
    })
  })
  env.manager.setMaterialHost(
    (plugin) =>
      ({
        capabilities: () => ({ available: true }),
        snapshot: () => ({
          workspaceScope: plugin.scope,
          revision: 1,
          sources: [{ id: 'source', format: 'markdown' }],
          decks: [],
        }),
      }) as unknown as MaterialHostApi,
  )
  await env.manager.initializePlugins()
  const request = { expectedRevision: 1, operationId: 'open-lookup', sourceId: 'source' }
  const opened = env.manager.openMaterialTool('sample', 'lookup', request)
  expect(opened.context.sourceId).toBe('source')
  expect(() => env.manager.openMaterialTool('sample', 'only-pdf', request)).toThrow('不支持')
  await env.manager.enablePlugin('sample', false)
  expect(opened.context.signal.aborted).toBe(true)
  expect(() => env.manager.openMaterialTool('sample', 'lookup', request)).toThrow('插件已卸载')
})

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
      author: 'test-author',
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
  const persistPreferences = vi.fn(async (key: string, value: string) => {
    settings.set(key, value)
  })
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
    persistSetting: persistPreferences,
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
    persistPreferences,
    switchScope: (scope: string) => {
      workspace = scope
    },
  }
}

it('installs code disabled, preserves that state after reload, and only runs after explicit enable', async () => {
  const register = vi.fn()
  const { manager, records, settings } = environment([], register)
  await manager.initializePlugins()
  await manager.installPlugin(bundle())
  expect(records.get('sample')!.main).toBe('first')
  expect(manager.pluginPackages).toHaveLength(1)
  expect(manager.pluginRuntime.installations).toHaveLength(0)
  expect(register).not.toHaveBeenCalled()
  expect(JSON.parse(settings.get(PLUGIN_PREFERENCES_KEY)!)).toEqual({ sample: false })
  await manager.reloadPlugins()
  expect(register).not.toHaveBeenCalled()
  expect(manager.pluginRuntime.installations).toHaveLength(0)
  await manager.enablePlugin('sample', true)
  expect(register).toHaveBeenCalledTimes(1)
  expect(manager.pluginRuntime.installations[0]!.plugin.label).toBe('first')
})

it('rejects a new package without author metadata before writing its preferences or bytes', async () => {
  const { manager, records, calls, persistPreferences } = environment()
  await manager.initializePlugins()
  const incoming = bundle()
  delete incoming.manifest.author
  await expect(manager.installPlugin(incoming)).rejects.toThrow()
  expect(persistPreferences).not.toHaveBeenCalled()
  expect(records.size).toBe(0)
  expect(calls).toEqual([])
  expect(manager.pluginRuntime.installations).toHaveLength(0)
})

it('keeps an older installed package without author metadata readable and runnable', async () => {
  const installed = bundle('legacy')
  delete installed.manifest.author
  const { manager, calls } = environment([{ id: 'sample', bundle: installed, trusted: true }])
  await manager.initializePlugins()
  expect(manager.pluginPackages[0]!.bundle!.manifest.author).toBeUndefined()
  expect(manager.pluginRuntime.installations[0]!.plugin.label).toBe('legacy')
  expect(calls).toEqual([])
})

it('uses the injected preferences own durable adapter before installing code', async () => {
  const { storage, records } = environment()
  const settings = new Map<string, string>()
  let finish!: () => void
  const persist = vi.fn(async (key: string, value: string) => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    settings.set(key, value)
  })
  const preferences = createPluginPreferences({
    read: (key) => settings.get(key) ?? null,
    write: (key, value) => {
      settings.set(key, value)
    },
    persist,
  })
  const unrelated = vi.fn(async () => {
    throw new Error('unrelated settings adapter')
  })
  const manager = createPluginManager({
    storage,
    preferences,
    seedOfficial: false,
    readSetting: () => null,
    writeSetting: unrelated,
    persistSetting: unrelated,
  })
  managers.push(manager)
  await manager.initializePlugins()
  const installing = manager.installPlugin(bundle())
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
  expect(records.size).toBe(0)
  expect(preferences.pluginPreferences.value).toEqual({})
  finish()
  await installing
  expect(unrelated).not.toHaveBeenCalled()
  expect(JSON.parse(settings.get(PLUGIN_PREFERENCES_KEY)!)).toEqual({ sample: false })
  expect(manager.pluginRuntime.installations).toHaveLength(0)
  await manager.reloadPlugins()
  expect(manager.pluginPreferences.value.sample).toBe(false)
  expect(manager.pluginRuntime.installations).toHaveLength(0)
})

it('refuses manual installation with only a best-effort custom settings writer', async () => {
  const { storage, records } = environment()
  const write = vi.fn()
  const manager = createPluginManager({
    storage,
    seedOfficial: false,
    readSetting: () => null,
    writeSetting: write,
  })
  managers.push(manager)
  await manager.initializePlugins()
  await expect(manager.installPlugin(bundle())).rejects.toThrow('无法保存插件启停状态')
  expect(write).not.toHaveBeenCalled()
  expect(records.size).toBe(0)
})

it('preserves disabled updates without executing new code, including code that would fail activation', async () => {
  const register = vi.fn()
  const { manager, records } = environment([], register)
  await manager.initializePlugins()
  await manager.installPlugin(bundle())
  await manager.installPlugin(bundle('broken'))
  expect(records.get('sample')!.main).toBe('broken')
  expect(register).not.toHaveBeenCalled()
  expect(manager.pluginPreferences.value.sample).toBe(false)
  await manager.reloadPlugins()
  expect(register).not.toHaveBeenCalled()
  await expect(manager.enablePlugin('sample', true)).rejects.toThrow('Broken module')
  expect(manager.pluginRuntime.installations).toHaveLength(0)
  expect(manager.pluginPreferences.value.sample).toBe(false)
  expect(records.get('sample')!.main).toBe('broken')
})

it.each(['preference', 'default'] as const)(
  'preserves the effective disabled %s state and cleans a remaining runtime without evaluating the update',
  async (source) => {
    const disposed = vi.fn()
    const register = vi.fn((api: ReturnType<typeof createPluginApi>) => {
      api.onDispose(disposed)
      api.registerPage({ id: 'sample', title: 'Sample', component: { render: () => null } })
    })
    const { manager, settings, records } = environment(
      [{ id: 'sample', bundle: bundle(), trusted: true }],
      register,
    )
    await manager.initializePlugins()
    const active = manager.pluginRuntime.installations[0]!
    if (source === 'preference') {
      settings.set(PLUGIN_PREFERENCES_KEY, '{"sample":false}')
      manager.restorePluginPreferences()
    } else active.enabledByDefault = false
    expect(createPluginRegistry(manager).pluginEnabled('sample')).toBe(false)
    expect(manager.pluginRuntime.installations).toHaveLength(1)
    await manager.installPlugin(bundle('broken'))
    expect(records.get('sample')!.main).toBe('broken')
    expect(register).toHaveBeenCalledOnce()
    expect(disposed).toHaveBeenCalledOnce()
    expect(active.pages).toHaveLength(0)
    expect(manager.pluginRuntime.installations).toHaveLength(0)
    expect(manager.pluginPreferences.value.sample).toBe(false)
    expect(manager.materialApiFor('sample')).toBeUndefined()
    await manager.reloadPlugins()
    expect(register).toHaveBeenCalledOnce()
    expect(manager.pluginRuntime.installations).toHaveLength(0)
  },
)

it('keeps enabled updates active and treats reinstallation after uninstall as disabled', async () => {
  const register = vi.fn()
  const { manager } = environment([], register)
  await manager.initializePlugins()
  await manager.installPlugin(bundle())
  await manager.enablePlugin('sample', true)
  const previous = manager.pluginRuntime.installations[0]
  await manager.installPlugin(bundle('updated'))
  expect(register).toHaveBeenCalledTimes(2)
  expect(manager.pluginRuntime.installations).toHaveLength(1)
  expect(manager.pluginRuntime.installations[0]).not.toBe(previous)
  expect(manager.pluginRuntime.installations[0]!.plugin.label).toBe('updated')
  expect(manager.pluginPreferences.value.sample).toBe(true)
  await manager.removePlugin('sample')
  await manager.installPlugin(bundle('reinstalled'))
  expect(register).toHaveBeenCalledTimes(2)
  expect(manager.pluginRuntime.installations).toHaveLength(0)
  expect(manager.pluginPreferences.value.sample).toBe(false)
  await manager.reloadPlugins()
  expect(register).toHaveBeenCalledTimes(2)
})

it('does not install trusted bytes if the disabled preference cannot be persisted', async () => {
  const { manager, records, trusted, calls, persistPreferences } = environment()
  await manager.initializePlugins()
  persistPreferences.mockRejectedValueOnce(new Error('settings disk failed'))
  await expect(manager.installPlugin(bundle())).rejects.toThrow('settings disk failed')
  expect(records.size).toBe(0)
  expect(calls).toEqual([])
  expect(trusted.size).toBe(0)
  expect(manager.pluginPackages).toHaveLength(0)
  await manager.reloadPlugins()
  expect(manager.pluginRuntime.installations).toHaveLength(0)
})

it('waits for a delayed durable settings failure before rejecting installation without writing code', async () => {
  const { manager, records, calls, persistPreferences } = environment()
  await manager.initializePlugins()
  let fail!: (issue: Error) => void
  persistPreferences.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject
      }),
  )
  const installing = manager.installPlugin(bundle())
  const rejected = expect(installing).rejects.toThrow('late settings failure')
  await vi.waitFor(() => expect(persistPreferences).toHaveBeenCalledOnce())
  expect(calls).toEqual([])
  expect(manager.pluginPreferences.value).toEqual({})
  fail(new Error('late settings failure'))
  await rejected
  expect(records.size).toBe(0)
  expect(calls).toEqual([])
  expect(manager.pluginRuntime.installations).toHaveLength(0)
})

it('does not write package bytes after its pending disabled preference is scoped away', async () => {
  const { manager, records, calls, persistPreferences, switchScope } = environment()
  await manager.initializePlugins()
  let finish!: () => void
  persistPreferences.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  )
  const installing = manager.installPlugin(bundle())
  await vi.waitFor(() => expect(persistPreferences).toHaveBeenCalledTimes(1))
  switchScope('local:next')
  const switching = manager.initializePlugins('local:next')
  finish()
  await expect(installing).rejects.toThrow('插件已卸载或学习库已切换')
  await switching
  expect(records.size).toBe(0)
  expect(calls).toEqual([])
  expect(manager.pluginPackages).toHaveLength(0)
})

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
  const { manager, records, trusted, calls, storage } = environment([
    { id: 'sample', bundle: bundle('manual'), trusted: false },
  ])
  await manager.initializePlugins()
  const save = storage.save
  storage.save = async (value, trust) => {
    await save(value, trust)
    if (value.main === 'broken') throw new Error('failed package write')
  }
  await expect(manager.installPlugin(bundle('broken'))).rejects.toThrow('failed package write')
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
    persistSetting: async (key, value) => {
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
  await manager.enablePlugin('sample', true)
  const old = manager.pluginRuntime.installations[0]
  await expect(manager.installPlugin(bundle('broken'))).rejects.toThrow('broken-update')
  expect(manager.pluginRuntime.installations[0]).toBe(old)
  await manager.reloadPlugins()
  expect(manager.pluginPackages[0]!.bundle!.main).toBe('before-update')
  expect(manager.pluginRuntime.installations[0]!.plugin.label).toBe('before-update')
  await manager.removePlugin('sample')
})
it('removes a failed first package write instead of hiding a trusted package until restart', async () => {
  const { manager, records, storage } = environment()
  await manager.initializePlugins()
  const save = storage.save
  storage.save = async (value, trust) => {
    await save(value, trust)
    throw new Error('failed package write')
  }
  await expect(manager.installPlugin(bundle('broken'))).rejects.toThrow('failed package write')
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
  expect(manager.pluginRuntime.installations).toHaveLength(1)
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
