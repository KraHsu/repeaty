import { openDB } from 'idb'
import { defineStore, getActivePinia, type Pinia } from 'pinia'
import {
  hasInjectionContext,
  inject,
  markRaw,
  onScopeDispose,
  provide,
  reactive,
  ref,
  type InjectionKey,
} from 'vue'
import { desktopEdition } from '../edition'
import { readSetting, writeSetting } from '../settings-store'
import { bundleSchema, packageHash, pluginIssueMessage, type PluginBundle } from './package'
import { PluginRuntime, type PluginModule } from './runtime'
import { createPluginApi, evaluatePlugin, nativePluginCall } from './sdk'
import { currentPluginWorkspace } from '@repeaty-plugin-host'
import { createPluginPreferences, defaultPluginPreferences } from './preferences'
import type { PluginMaterialHostFactory } from './materials'
import { PluginTaskScheduler } from './tasks'
import type {
  MaterialCommandRequest,
  MaterialSearchQuery,
  MaterialTaskOptions,
} from '@repeaty/plugin-api'
import type { PluginInstallation } from './types'
import { materialLocatorSchema } from '../core/material-data'

export interface PackageEntry {
  id: string
  bundle?: PluginBundle
  trusted: boolean
  error?: string
}
export interface PluginStorage {
  scope(): Promise<string>
  list(): Promise<PackageEntry[]>
  /** A rollback restores bytes without granting trust to an earlier unapproved package. */
  save(bundle: PluginBundle, trust?: boolean): Promise<void>
  remove(id: string): Promise<void>
  trust?(id: string, hash: string): Promise<void>
}
export interface PluginManagerEnvironment {
  storage?: PluginStorage
  preferences?: ReturnType<typeof createPluginPreferences>
  readSetting?: typeof readSetting
  writeSetting?: typeof writeSetting
  officialBundles?: typeof officialPluginBundles
  evaluate?: (code: string, api: ReturnType<typeof createPluginApi>) => Promise<PluginModule>
  seedOfficial?: boolean
  materialHost?: PluginMaterialHostFactory
}
let environmentFactory: (() => PluginManagerEnvironment) | undefined
/** Embedded hosts supply a new adapter environment per app; mutable runtimes are never shared. */
export function setPluginEnvironmentFactory(factory?: () => PluginManagerEnvironment) {
  environmentFactory = factory
}
async function database() {
  return openDB('repeaty-external-plugins', 1, {
    upgrade(db) {
      db.createObjectStore('packages')
      db.createObjectStore('metadata')
    },
  })
}
export async function officialPluginBundles(options: { defaultsOnly?: boolean } = {}) {
  const base = import.meta.env.BASE_URL
  const response = await fetch(base + 'plugins/catalog.json')
  if (!response.ok) throw new Error('无法读取官方插件包。')
  const entries = (await response.json()) as { path: string; installByDefault?: boolean }[]
  return Promise.all(
    entries
      .filter((entry) => !options.defaultsOnly || entry.installByDefault !== false)
      .map(async ({ path }) => {
        if (!/^plugins\/[a-z][a-z0-9-]{0,63}\.repeaty-plugin$/.test(path))
          throw new Error('插件目录清单无效。')
        const response = await fetch(base + path)
        if (!response.ok) throw new Error('无法读取官方插件包。')
        return bundleSchema.parse(await response.json())
      }),
  )
}
export function createPluginManager(options: PluginManagerEnvironment = {}) {
  const environment = { ...environmentFactory?.(), ...options }
  const read = environment.readSetting ?? readSetting,
    write = environment.writeSetting ?? writeSetting
  const preferences = environment.preferences ?? createPluginPreferences({ read, write })
  let storage = environment.storage
  const pluginRuntime = new PluginRuntime()
  const materialApis = new Map<
    string,
    { api: ReturnType<typeof createPluginApi>; installation: PluginInstallation }
  >()
  const taskScheduler = new PluginTaskScheduler()
  const commandScheduler = new PluginTaskScheduler(1)
  let materialHost = environment.materialHost
  function setMaterialHost(factory: PluginMaterialHostFactory) {
    materialHost = factory
    return () => {
      if (materialHost === factory) materialHost = undefined
    }
  }
  function materialApiFor(pluginId: string) {
    const installed = materialApis.get(pluginId)
    if (!installed || !pluginRuntime.installations.includes(installed.installation))
      return undefined
    return installed.api.materials
  }
  function materialContribution(pluginId: string) {
    const value = materialApis.get(pluginId)
    if (!value || !pluginRuntime.installations.includes(value.installation))
      throw new Error('插件已卸载或学习库已切换。')
    // Capabilities checks the instance lifetime even while a replacement is being published.
    value.api.materials.capabilities()
    return value
  }
  async function parseMaterialFile(
    pluginId: string,
    importerId: string,
    file: File,
    options: Pick<MaterialTaskOptions, 'signal' | 'onProgress'> = {},
  ) {
    const { api, installation } = materialContribution(pluginId)
    const importer = installation.importers?.find((entry) => entry.id === importerId)
    if (!importer) throw new Error('材料导入器不可用。')
    return api.tasks.run(
      { id: `parse-${crypto.randomUUID()}`, title: importer.title, ...options },
      (context) => importer.parse(file, context),
    )
  }
  async function executeMaterialCommand(
    pluginId: string,
    commandId: string,
    request: MaterialCommandRequest,
    options: Pick<MaterialTaskOptions, 'signal' | 'onProgress'> = {},
  ) {
    const { api, installation } = materialContribution(pluginId)
    const command = installation.commands?.find((entry) => entry.id === commandId)
    if (!command) throw new Error('插件命令不可用。')
    if (
      !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision < 0 ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(request.operationId)
    )
      throw new Error('插件命令请求无效。')
    const snapshot = api.materials.snapshot()
    if (snapshot.revision !== request.expectedRevision)
      throw new Error('学习库已更新，请重新打开命令。')
    return api.runMaterialCommand(
      { id: `command-${crypto.randomUUID()}`, title: command.title, ...options },
      (context) => {
        if (api.materials.snapshot().revision !== request.expectedRevision)
          throw new Error('学习库已更新，请重新打开命令。')
        return command.run({ ...context, ...request, workspaceScope: snapshot.workspaceScope })
      },
    )
  }
  async function searchMaterialProvider(
    pluginId: string,
    providerId: string,
    query: MaterialSearchQuery,
    options: Pick<MaterialTaskOptions, 'signal' | 'onProgress'> = {},
  ) {
    const { api, installation } = materialContribution(pluginId)
    const provider = installation.searchProviders?.find((entry) => entry.id === providerId)
    if (!provider) throw new Error('材料搜索扩展不可用。')
    if (
      typeof query.text !== 'string' ||
      query.text.length > 1000 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      (query.cursor !== undefined &&
        (typeof query.cursor !== 'string' || query.cursor.length > 2048))
    )
      throw new Error('材料搜索请求无效。')
    const result = await api.tasks.run(
      { id: `search-${crypto.randomUUID()}`, title: provider.title, ...options },
      (context) => provider.search(query, context),
    )
    if (
      !result ||
      !Array.isArray(result.hits) ||
      result.hits.length > query.limit ||
      (result.nextCursor !== undefined &&
        (typeof result.nextCursor !== 'string' || result.nextCursor.length > 2048))
    )
      throw new Error('材料搜索结果无效。')
    const sources = new Map(api.materials.snapshot().sources.map((source) => [source.id, source]))
    for (const hit of result.hits) {
      const source = hit && sources.get(hit.sourceId)
      if (
        !hit ||
        typeof hit.sourceId !== 'string' ||
        !source ||
        typeof hit.versionId !== 'string' ||
        !hit.versionId ||
        hit.versionId.length > 100 ||
        hit.versionId !== source.versionId ||
        typeof hit.title !== 'string' ||
        hit.title.length > 500 ||
        typeof hit.snippet !== 'string' ||
        hit.snippet.length > 1000 ||
        (hit.locator !== undefined &&
          (!materialLocatorSchema.safeParse(hit.locator).success ||
            hit.locator.sourceId !== hit.sourceId ||
            hit.locator.versionId !== hit.versionId ||
            (hit.locator.kind !== 'text' && hit.locator.kind !== source.document?.format)))
      )
        throw new Error('材料搜索结果无效。')
    }
    return result
  }
  const pluginPackages = reactive<PackageEntry[]>([])
  const pluginManagerBusy = ref(false),
    pluginManagerError = ref(''),
    activePluginViews = ref(0)
  const pluginScope = ref('local:repeaty')
  let queue: Promise<unknown> = Promise.resolve(),
    boot: Promise<void> | undefined
  let bootScope = '',
    epoch = 0,
    alive = true
  const current = (generation: number) => alive && generation === epoch
  function check(generation: number) {
    if (!current(generation)) throw new Error('插件已卸载或学习库已切换。')
  }
  function mutable() {
    if (activePluginViews.value) throw new Error('请先结束复习或关闭编辑器，再修改插件。')
  }
  function serialize<T>(action: () => Promise<T>) {
    const result = queue.then(async () => {
      if (!alive) throw new Error('插件已卸载或学习库已切换。')
      pluginManagerBusy.value = true
      pluginManagerError.value = ''
      try {
        return await action()
      } catch (issue) {
        if (alive) pluginManagerError.value = pluginIssueMessage(issue)
        throw issue
      } finally {
        pluginManagerBusy.value = false
      }
    })
    queue = result.catch(() => {})
    return result
  }
  function holdPluginRuntime() {
    activePluginViews.value++
    let held = true
    return () => {
      if (held) {
        held = false
        activePluginViews.value--
      }
    }
  }
  async function nativeScope() {
    if (storage) return storage.scope()
    const active = await currentPluginWorkspace()
    return `local:workspace:${active.id}`
  }
  async function assertScope(scope: string, generation: number) {
    check(generation)
    if (storage || desktopEdition) {
      if ((await nativeScope()) !== scope) throw new Error('stale-workspace-session')
      check(generation)
    }
  }
  async function listPackages(scope: string): Promise<PackageEntry[]> {
    if (storage)
      return (await storage.list()).map((entry) => ({
        ...entry,
        bundle: entry.bundle ? bundleSchema.parse(entry.bundle) : undefined,
      }))
    if (desktopEdition) {
      const raw = (await nativePluginCall('', 'list', {}, scope)) as unknown[]
      const trust = (await nativePluginCall('', 'trust-state', {}, scope)) as { hashes: string[] }
      return Promise.all(
        raw.map(async (value) => {
          const result = bundleSchema.safeParse(value)
          if (!result.success) {
            const entry = value as { id?: string; error?: string }
            return {
              id: entry.id ?? 'unknown',
              trusted: false,
              error: entry.error ? pluginIssueMessage(entry.error) : '插件包无效。',
            }
          }
          return {
            id: result.data.manifest.id,
            bundle: result.data,
            trusted: trust.hashes.includes(await packageHash(result.data)),
          }
        }),
      )
    }
    const db = await database()
    try {
      const value = (await db.get('packages', scope)) as unknown[] | undefined
      return (value ?? []).map((raw) => {
        const result = bundleSchema.safeParse(raw)
        return result.success
          ? { id: result.data.manifest.id, bundle: result.data, trusted: true }
          : { id: 'unknown', trusted: false, error: '插件包无效。' }
      })
    } finally {
      db.close()
    }
  }
  async function persist(bundle: PluginBundle, scope: string, generation: number, trust = true) {
    // Rollback entries come from reactive UI state. Parse a detached plain package before any
    // structured-clone storage/IPC boundary, including nested manifest and permission arrays.
    bundle = bundleSchema.parse(bundle)
    await assertScope(scope, generation)
    if (storage) {
      await storage.save(bundle, trust)
      if (trust && storage.trust) {
        await assertScope(scope, generation)
        await storage.trust(bundle.manifest.id, await packageHash(bundle))
      }
    } else if (desktopEdition) {
      await nativePluginCall(bundle.manifest.id, 'install', bundle, scope)
      if (trust) {
        await assertScope(scope, generation)
        await nativePluginCall(
          bundle.manifest.id,
          'trust',
          { hash: await packageHash(bundle) },
          scope,
        )
      }
    } else {
      const db = await database()
      try {
        check(generation)
        const entries = ((await db.get('packages', scope)) ?? []) as PluginBundle[]
        check(generation)
        await db.put(
          'packages',
          [...entries.filter((entry) => entry.manifest.id !== bundle.manifest.id), bundle],
          scope,
        )
      } finally {
        db.close()
      }
    }
    check(generation)
  }
  async function removePersisted(id: string, scope: string, generation: number) {
    await assertScope(scope, generation)
    if (storage) await storage.remove(id)
    else if (desktopEdition) await nativePluginCall(id, 'remove', {}, scope)
    else {
      const db = await database()
      try {
        const entries = ((await db.get('packages', scope)) ?? []) as PluginBundle[]
        check(generation)
        await db.put(
          'packages',
          entries.filter((entry) => entry.manifest.id !== id),
          scope,
        )
      } finally {
        db.close()
      }
    }
    check(generation)
  }
  async function activate(entry: PackageEntry, generation: number, requireMutable = false) {
    check(generation)
    if (
      !entry.bundle ||
      !entry.trusted ||
      (entry.bundle.manifest.kind === 'local' && !desktopEdition)
    )
      return
    if (requireMutable) mutable()
    const bundle = entry.bundle,
      scope = pluginScope.value
    let materialApi: ReturnType<typeof createPluginApi> | undefined
    const installation = await pluginRuntime.load(
      bundle,
      async (code, disposers, registerSettings, registerPage, registerWidget, registrations) => {
        check(generation)
        const api = createPluginApi(
          bundle.manifest,
          scope,
          disposers,
          () => current(generation),
          registerSettings,
          registerPage,
          registerWidget,
          { registrations, host: () => materialHost, scheduler: taskScheduler, commandScheduler },
        )
        materialApi = api
        const module = await (environment.evaluate ?? evaluatePlugin)(code, api)
        check(generation)
        if (requireMutable) mutable()
        // A plugin factory may itself await; check view/scope ownership before Runtime publishes it.
        if (typeof module.default === 'function') {
          const factory = module.default as () => unknown
          return {
            default: async () => {
              check(generation)
              const definition = await factory()
              check(generation)
              if (requireMutable) mutable()
              return definition
            },
          }
        }
        return module
      },
    )
    check(generation)
    if (materialApi) materialApis.set(bundle.manifest.id, { api: materialApi, installation })
    entry.error = undefined
  }
  function initializePlugins(scope?: string, requireMutable = false) {
    const requested = scope ?? (desktopEdition ? '' : 'local:repeaty')
    if (boot && (!requested || requested === bootScope)) return boot
    bootScope = requested
    const generation = ++epoch
    boot = serialize(async () => {
      check(generation)
      if (requireMutable) mutable()
      await pluginRuntime.close()
      materialApis.clear()
      check(generation)
      pluginPackages.splice(0)
      let resolved = requested
      if (desktopEdition || storage) {
        try {
          resolved = await nativeScope()
        } catch {
          if (current(generation)) boot = undefined
          return
        }
      }
      check(generation)
      pluginScope.value = resolved
      bootScope = resolved
      preferences.restorePluginPreferences()
      let entries = await listPackages(resolved)
      check(generation)
      const seedAllowed = environment.seedOfficial ?? !storage
      const seededKey = 'repeaty.plugins.seeded.v1'
      let seeded = !seedAllowed || read(seededKey) === '1'
      if (!desktopEdition && !storage) {
        const db = await database()
        try {
          seeded = !seedAllowed || Boolean(await db.get('metadata', ['seeded', resolved]))
        } finally {
          db.close()
        }
        check(generation)
      }
      if (!seeded) {
        if (entries.length === 0) {
          const bundles = await (environment.officialBundles ?? officialPluginBundles)({
            defaultsOnly: true,
          })
          check(generation)
          for (const bundle of bundles) {
            if (requireMutable) mutable()
            await persist(bundle, resolved, generation)
          }
          entries = await listPackages(resolved)
          check(generation)
        }
        // Even a manually supplied first package establishes this workspace's initial choice.
        if (desktopEdition || storage) write(seededKey, '1')
        else {
          const db = await database()
          try {
            check(generation)
            await db.put('metadata', true, ['seeded', resolved])
          } finally {
            db.close()
          }
        }
        check(generation)
      }
      if (requireMutable) mutable()
      pluginPackages.push(...entries)
      for (const entry of pluginPackages) {
        check(generation)
        if (preferences.pluginPreferences.value[entry.id] === false) continue
        try {
          await activate(entry, generation, requireMutable)
        } catch (error) {
          if (current(generation)) entry.error = pluginIssueMessage(error)
        }
      }
    })
    return boot
  }
  function installPlugin(raw: PluginBundle) {
    const generation = epoch
    return serialize(async () => {
      check(generation)
      mutable()
      const scope = pluginScope.value,
        bundle = bundleSchema.parse(raw)
      if (bundle.manifest.kind === 'local' && !desktopEdition)
        throw new Error('此插件仅在桌面版可用。')
      const previous = pluginPackages.find((entry) => entry.id === bundle.manifest.id)
      const entry: PackageEntry = { id: bundle.manifest.id, bundle, trusted: true }
      try {
        await persist(bundle, scope, generation)
        mutable()
        await activate(entry, generation, true)
      } catch (error) {
        if (current(generation)) {
          if (previous?.bundle) await persist(previous.bundle, scope, generation, false)
          else await removePersisted(bundle.manifest.id, scope, generation)
        }
        throw error
      }
      check(generation)
      const position = pluginPackages.findIndex((installed) => installed.id === entry.id)
      if (position === -1) pluginPackages.push(entry)
      else pluginPackages.splice(position, 1, entry)
      preferences.savePluginPreference(entry.id, true)
    })
  }
  function enablePlugin(id: string, enabled: boolean) {
    const generation = epoch
    return serialize(async () => {
      check(generation)
      mutable()
      const entry = pluginPackages.find((entry) => entry.id === id)
      if (!entry?.bundle) throw new Error('插件包不存在。')
      if (enabled) {
        if (!entry.trusted) {
          const hash = await packageHash(entry.bundle)
          await assertScope(pluginScope.value, generation)
          mutable()
          if (storage?.trust) await storage.trust(id, hash)
          else if (desktopEdition) await nativePluginCall(id, 'trust', { hash }, pluginScope.value)
          else throw new Error('插件包无效。')
          check(generation)
          mutable()
          entry.trusted = true
        }
        await activate(entry, generation, true)
      } else {
        mutable()
        await pluginRuntime.unload(id)
        materialApis.delete(id)
      }
      check(generation)
      preferences.savePluginPreference(id, enabled)
    })
  }
  function removePlugin(id: string) {
    const generation = epoch
    return serialize(async () => {
      check(generation)
      mutable()
      const previous = pluginPackages.find((entry) => entry.id === id),
        scope = pluginScope.value
      await removePersisted(id, scope, generation)
      try {
        mutable()
      } catch (error) {
        if (previous?.bundle) await persist(previous.bundle, scope, generation, false)
        throw error
      }
      await pluginRuntime.unload(id)
      materialApis.delete(id)
      check(generation)
      const index = pluginPackages.findIndex((entry) => entry.id === id)
      if (index !== -1) pluginPackages.splice(index, 1)
      preferences.savePluginPreference(id, false)
    })
  }
  function reloadPlugins() {
    mutable()
    boot = undefined
    return initializePlugins(pluginScope.value, true)
  }
  async function dispose() {
    if (!alive) return
    alive = false
    epoch++
    boot = undefined
    pluginManagerBusy.value = false
    await pluginRuntime.close()
    materialApis.clear()
    materialHost = undefined
    pluginPackages.splice(0)
  }
  function useStorage(value: PluginStorage) {
    storage = value
    epoch++
    boot = undefined
    void pluginRuntime.close()
    materialApis.clear()
    pluginPackages.splice(0)
  }
  return {
    pluginRuntime,
    setMaterialHost,
    materialApiFor,
    parseMaterialFile,
    executeMaterialCommand,
    searchMaterialProvider,
    pluginPackages,
    pluginManagerBusy,
    pluginManagerError,
    activePluginViews,
    pluginScope,
    ...preferences,
    holdPluginRuntime,
    initializePlugins,
    installPlugin,
    enablePlugin,
    removePlugin,
    reloadPlugins,
    dispose,
    useStorage,
  }
}
export type PluginManager = ReturnType<typeof createPluginManager>
export const defaultPluginManager = createPluginManager({ preferences: defaultPluginPreferences })
export const {
  pluginRuntime,
  pluginPackages,
  pluginManagerBusy,
  pluginManagerError,
  activePluginViews,
  pluginScope,
  holdPluginRuntime,
  initializePlugins,
  installPlugin,
  enablePlugin,
  removePlugin,
  reloadPlugins,
} = defaultPluginManager
export function usePluginStorage(storage: PluginStorage) {
  setPluginEnvironmentFactory(() => ({ storage }))
  defaultPluginManager.useStorage(storage)
}
// The raw service is not Pinia state; the store only supplies per-app ownership and disposal.
const usePluginOwnerStore = defineStore('plugin-runtime-owner', () => {
  const manager = markRaw(createPluginManager())
  onScopeDispose(() => {
    void manager.dispose()
  })
  return { manager }
})
const managerKey: InjectionKey<PluginManager> = Symbol('repeaty-plugin-manager')
export function providePluginManager(manager: PluginManager) {
  provide(managerKey, manager)
}
export function usePluginManager(pinia?: Pinia): PluginManager {
  const injected = hasInjectionContext() ? inject(managerKey, undefined) : undefined
  if (injected && !pinia) return injected
  const owner = pinia ?? getActivePinia()
  if (!owner) return defaultPluginManager
  return usePluginOwnerStore(owner).manager
}
