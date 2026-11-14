import * as vue from 'vue'
import { t, locale, createTranslator } from '../i18n'
import { readSetting, writeSetting, persistSetting } from '../settings-store'
import { practiceContentRevision } from '../core/practice'
import { hasAttemptBody } from '../core/practice-data'
import { callPluginHost, readPluginData, writePluginData } from '@repeaty-plugin-host'
import type { PluginManifest } from './package'
import type { PluginModule } from './runtime'
import type { PluginSettingsContribution, RegisterPluginSettings } from './settings'
import type { PluginPageContribution, RegisterPluginPage } from './pages'
import type { PluginWidgetContribution, RegisterPluginWidget } from './widgets'
import type { MaterialHostApi, MaterialTaskContext, MaterialTaskOptions } from '@repeaty/plugin-api'
import type { MaterialRegistrations, PluginMaterialHostFactory } from './materials'
import { PluginTaskScheduler, supportsPluginWorkers } from './tasks'
import { createPluginResources } from './resources'
import type { PluginStudyHostFactory } from './study'
import type { PluginAutomationHostFactory } from './automation'
import type { PluginNetworkConsent } from './network'
import type { PluginHttpRequest, PluginHttpResponse } from '@repeaty/plugin-api'
import type { AutomationApi } from '@repeaty/plugin-api'
import type { StudyHostApi } from '@repeaty/plugin-api'
import type { PluginAssets } from './assets'
import AppPage from '../components/AppPage.vue'
import {
  SettingGroup,
  SettingSection,
  SettingField,
  UiButton,
  UiIconButton,
  UiNotice,
  UiStatus,
  UiInput,
  UiTextarea,
  UiSelect,
  UiCheckbox,
  UiProgress,
  UiCollapsible,
  vUiControl,
  vUiButton,
} from '../components/ui'

const MediaList = vue.defineAsyncComponent(() => import('../components/MediaList.vue'))
const CardContent = vue.defineAsyncComponent(() => import('../components/CardContent.vue'))
const PracticeHistory = vue.defineAsyncComponent(() => import('../components/PracticeHistory.vue'))
const AttemptBody = vue.defineAsyncComponent(() => import('../components/AttemptBody.vue'))

export async function nativePluginCall(
  id: string,
  operation: string,
  payload: unknown = {},
  expectedScope?: string,
) {
  return callPluginHost(id, operation, payload, expectedScope)
}
export function createPluginApi(
  manifest: PluginManifest,
  scope: string,
  disposers: (() => void)[],
  isCurrent: () => boolean = () => true,
  registerContribution?: RegisterPluginSettings,
  registerPageContribution?: RegisterPluginPage,
  registerWidgetContribution?: RegisterPluginWidget,
  materialOptions: {
    registrations?: MaterialRegistrations
    host?: () => PluginMaterialHostFactory | undefined
    studyHost?: () => PluginStudyHostFactory | undefined
    automationHost?: () => PluginAutomationHostFactory | undefined
    networkConsent?: () => PluginNetworkConsent | undefined
    scheduler?: PluginTaskScheduler
    commandScheduler?: PluginTaskScheduler
    assets?: PluginAssets
  } = {},
) {
  let alive = true
  const lifetime = new AbortController()
  const activationId = crypto.randomUUID()
  const taskOwner = Symbol(manifest.id)
  const scheduler = materialOptions.scheduler ?? new PluginTaskScheduler()
  const commandScheduler = materialOptions.commandScheduler ?? new PluginTaskScheduler(1)
  disposers.push(() => {
    void nativePluginCall(manifest.id, 'http.dispose', { activationId }, scope).catch(() => {})
    if (manifest.permissions?.models)
      void nativePluginCall(manifest.id, 'model.dispose', { activationId }, scope).catch(() => {})
    alive = false
    lifetime.abort()
  })
  function guard() {
    if (!alive || !isCurrent()) throw new Error('插件已卸载或学习库已切换。')
  }
  const settingsKey = (key: string) => `plugin:${manifest.id}:${key}`
  const native = async (operation: string, payload: unknown) => {
    guard()
    if (operation === 'network.authorize') throw new Error('permission-denied')
    if (operation === 'http') return requestHttp(payload as PluginHttpRequest)
    if (operation.startsWith('http.') || operation === 'secrets')
      payload = { ...(payload as Record<string, unknown>), activationId }
    if (operation.startsWith('model.')) {
      if (!manifest.permissions?.models) throw new Error('permission-denied')
      payload = { ...(payload as Record<string, unknown>), activationId }
    }
    const result = await nativePluginCall(manifest.id, operation, payload, scope)
    guard()
    return result
  }
  async function requestHttp(
    input: PluginHttpRequest,
    signal?: AbortSignal,
  ): Promise<PluginHttpResponse> {
    guard()
    signal?.throwIfAborted()
    const requestId = crypto.randomUUID()
    const cancel = () => {
      void nativePluginCall(manifest.id, 'http.cancel', { activationId, requestId }, scope).catch(
        () => {},
      )
    }
    signal?.addEventListener('abort', cancel, { once: true })
    lifetime.signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await nativePluginCall(
        manifest.id,
        'http',
        { ...input, activationId, requestId },
        scope,
      )
      guard()
      signal?.throwIfAborted()
      return result as PluginHttpResponse
    } finally {
      signal?.removeEventListener('abort', cancel)
      lifetime.signal.removeEventListener('abort', cancel)
    }
  }
  const authorizedOrigins = new Set<string>()
  const network = {
    async authorize(origin: string) {
      guard()
      const url = new URL(origin)
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
        throw new Error('invalid-origin')
      if (authorizedOrigins.has(origin) || manifest.permissions?.origins?.includes(origin)) return
      if (!manifest.permissions?.network) throw new Error('permission-denied')
      const consent = materialOptions.networkConsent?.()
      if (
        !consent ||
        !(await consent(
          {
            pluginId: manifest.id,
            label: manifest.name,
            scope,
            signal: lifetime.signal,
            assertCurrent: guard,
          },
          origin,
        ))
      )
        throw new Error('permission-denied')
      guard()
      await nativePluginCall(manifest.id, 'network.authorize', { activationId, origin }, scope)
      guard()
      authorizedOrigins.add(origin)
    },
    request: requestHttp,
  }
  const pluginData = {
    async get(id: string, requestedScope: string) {
      guard()
      if (requestedScope !== scope) throw new Error('stale-workspace-session')
      return readPluginData(manifest.id, id, scope)
    },
    async set(id: string, value: unknown, requestedScope: string) {
      guard()
      if (requestedScope !== scope) throw new Error('stale-workspace-session')
      if (JSON.stringify(value ?? null).length > 2 * 1024 * 1024)
        throw new Error('插件数据超过大小限制。')
      await writePluginData(manifest.id, id, value, scope)
    },
  }
  const materialHost = () => {
    guard()
    const factory = materialOptions.host?.()
    if (!factory) throw new Error('当前学习库尚未提供材料服务。')
    return factory({
      pluginId: manifest.id,
      scope,
      signal: lifetime.signal,
      worker: supportsPluginWorkers(),
      assertCurrent: guard,
      runTask,
    })
  }
  async function materialCall<T>(run: (host: MaterialHostApi) => Promise<T>) {
    const result = await run(materialHost())
    guard()
    return result
  }
  const materials: MaterialHostApi = {
    capabilities() {
      guard()
      if (!materialOptions.host?.())
        return {
          protocolVersion: 1,
          workspaceScope: scope,
          available: false,
          import: false,
          createNote: false,
          search: false,
          worker: supportsPluginWorkers(),
        }
      return materialHost().capabilities()
    },
    snapshot: () => materialHost().snapshot(),
    list: () => materialCall((host) => host.list()),
    get: (id, version) => materialCall((host) => host.get(id, version)),
    original: (id, version) => materialCall((host) => host.original(id, version)),
    resource: (id, path, version) => materialCall((host) => host.resource(id, path, version)),
    setSequence: (request) => materialCall((host) => host.setSequence(request)),
    annotate: (request) => materialCall((host) => host.annotate(request)),
    removeAnnotation: (request) => materialCall((host) => host.removeAnnotation(request)),
    prepareImport: (request, signal) => materialCall((host) => host.prepareImport(request, signal)),
    commitImport: (request) => materialCall((host) => host.commitImport(request)),
    discardImport: (id) => materialHost().discardImport(id),
    createNote: (request) => materialCall((host) => host.createNote(request)),
    createExcerpt: (request) => materialCall((host) => host.createExcerpt(request)),
    editContent: (request) => materialCall((host) => host.editContent(request)),
    search: (query, signal) => materialCall((host) => host.search(query, signal)),
  }
  let boundStudy: StudyHostApi | undefined
  let boundAutomation: AutomationApi | undefined
  function automationHost() {
    guard()
    const factory = materialOptions.automationHost?.()
    if (!factory) throw new Error('automation-service-unavailable')
    return (boundAutomation ??= factory({
      pluginId: manifest.id,
      label: manifest.name,
      scope,
      signal: lifetime.signal,
      assertCurrent: guard,
    }))
  }
  async function automationCall<T>(run: (host: AutomationApi) => Promise<T>) {
    const value = await run(automationHost())
    guard()
    return value
  }
  const automation: AutomationApi = {
    context: () => automationHost().context(),
    capabilities: () => automationHost().capabilities(),
    authorize: (input) => automationCall((host) => host.authorize(input)),
    revoke: () => automationHost().revoke(),
    query: (input, signal) => automationCall((host) => host.query(input, signal)),
    preview: (input, signal) => automationCall((host) => host.preview(input, signal)),
    apply: (input, signal) => automationCall((host) => host.apply(input, signal)),
    operationStatus: (id, signal) => automationCall((host) => host.operationStatus(id, signal)),
  }
  function studyHost() {
    guard()
    const factory = materialOptions.studyHost?.()
    if (!factory) throw new Error('study-service-unavailable')
    return (boundStudy ??= factory({
      pluginId: manifest.id,
      scope,
      signal: lifetime.signal,
      assertCurrent: guard,
    }))
  }
  async function studyCall<T>(run: (host: StudyHostApi) => Promise<T>) {
    const value = await run(studyHost())
    guard()
    return value
  }
  const study: StudyHostApi = {
    statistics: (query, signal) => studyCall((host) => host.statistics(query, signal)),
    statisticsDetails: (query, signal) =>
      studyCall((host) => host.statisticsDetails(query, signal)),
    trainingState: (query, signal) => studyCall((host) => host.trainingState(query, signal)),
    trainingSnapshot: (query, signal) => studyCall((host) => host.trainingSnapshot(query, signal)),
    submitCandidate: (request, signal) =>
      studyCall((host) => host.submitCandidate(request, signal)),
    activateModel: (request, signal) => studyCall((host) => host.activateModel(request, signal)),
    rollbackModel: (request, signal) => studyCall((host) => host.rollbackModel(request, signal)),
    discardTraining: (token) => studyHost().discardTraining(token),
    activity: () => studyHost().activity(),
    subscribe(listener) {
      let subscribed = true
      const stop = studyHost().subscribe(() => {
        if (subscribed && alive && isCurrent()) listener()
      })
      const dispose = () => {
        if (subscribed) {
          subscribed = false
          stop()
        }
      }
      disposers.push(dispose)
      return dispose
    },
  }
  const registration = <K extends keyof MaterialRegistrations>(name: K) => {
    guard()
    const value = materialOptions.registrations
    if (!value) throw new Error('当前宿主不支持材料扩展。')
    return value[name]
  }
  function runTask<T>(
    options: MaterialTaskOptions,
    run: (context: MaterialTaskContext) => Promise<T>,
  ): Promise<T> {
    return runScheduled(scheduler, options, run)
  }
  function runScheduled<T>(
    queue: PluginTaskScheduler,
    options: MaterialTaskOptions,
    run: (context: MaterialTaskContext) => Promise<T>,
  ): Promise<T> {
    guard()
    return queue.run(
      taskOwner,
      options,
      async (context) => {
        guard()
        const result = await run({
          ...context,
          createWorker: context.createWorker
            ? (source, options) => {
                guard()
                return context.createWorker!(source, options)
              }
            : undefined,
          progress(value) {
            guard()
            context.progress(value)
          },
          async yield() {
            guard()
            await context.yield()
            guard()
          },
        })
        guard()
        return result
      },
      lifetime.signal,
    )
  }
  return {
    t,
    locale,
    createTranslator,
    MediaList,
    CardContent,
    PracticeHistory,
    AttemptBody,
    AppPage,
    SettingGroup,
    SettingSection,
    SettingField,
    UiButton,
    UiIconButton,
    UiNotice,
    UiStatus,
    UiInput,
    UiTextarea,
    UiSelect,
    UiCheckbox,
    UiProgress,
    UiCollapsible,
    vUiControl,
    vUiButton,
    practiceContentRevision,
    hasAttemptBody,
    registerSettings(contribution: PluginSettingsContribution) {
      guard()
      if (!registerContribution) throw new Error('当前宿主不支持插件设置注册。')
      const remove = registerContribution(contribution)
      disposers.push(remove)
      return remove
    },
    registerPage(contribution: PluginPageContribution) {
      guard()
      if (!registerPageContribution) throw new Error('当前宿主不支持插件页面注册。')
      const remove = registerPageContribution(contribution)
      disposers.push(remove)
      return remove
    },
    registerWidget(contribution: PluginWidgetContribution) {
      guard()
      if (!registerWidgetContribution) throw new Error('当前宿主不支持插件组件注册。')
      const remove = registerWidgetContribution(contribution)
      disposers.push(remove)
      return remove
    },
    registerImporter(contribution: Parameters<MaterialRegistrations['registerImporter']>[0]) {
      const remove = registration('registerImporter')(contribution)
      disposers.push(remove)
      return remove
    },
    registerSourceConnector(
      contribution: Parameters<MaterialRegistrations['registerSourceConnector']>[0],
    ) {
      const remove = registration('registerSourceConnector')(contribution)
      disposers.push(remove)
      return remove
    },
    registerReader(contribution: Parameters<MaterialRegistrations['registerReader']>[0]) {
      const remove = registration('registerReader')(contribution)
      disposers.push(remove)
      return remove
    },
    registerCommand(contribution: Parameters<MaterialRegistrations['registerCommand']>[0]) {
      const remove = registration('registerCommand')(contribution)
      disposers.push(remove)
      return remove
    },
    registerSearchProvider(
      contribution: Parameters<MaterialRegistrations['registerSearchProvider']>[0],
    ) {
      const remove = registration('registerSearchProvider')(contribution)
      disposers.push(remove)
      return remove
    },
    materials,
    study,
    automation,
    network,
    resources: createPluginResources(materialOptions.assets, lifetime.signal, guard),
    tasks: { run: runTask },
    // Host-only command orchestration must not occupy the background parser queue it awaits.
    runMaterialCommand<T>(
      options: MaterialTaskOptions,
      run: (context: MaterialTaskContext) => Promise<T>,
    ) {
      return runScheduled(commandScheduler, options, run)
    },
    pluginData,
    readSetting(key: string) {
      guard()
      return readSetting(settingsKey(key))
    },
    writeSetting(key: string, value: string, onError?: () => void) {
      guard()
      writeSetting(settingsKey(key), value, onError)
    },
    async persistSetting(key: string, value: string) {
      guard()
      await persistSetting(settingsKey(key), value)
      guard()
    },
    nativePlugin: native,
    pluginFiles: {
      read(path: string) {
        return native('files', { action: 'read', path })
      },
      async write(path: string, body: string) {
        await native('files', { action: 'write', path, body })
      },
    },
    onDispose(stop: () => void) {
      guard()
      disposers.push(stop)
    },
  }
}

type Api = ReturnType<typeof createPluginApi>
type Host = { vue: typeof vue; current?: Api }
const host: Host = { vue }
Object.assign(globalThis, { __REPEATY_PLUGIN_HOST__: host })
let evaluation: Promise<unknown> = Promise.resolve()
let moduleImporter: ((code: string) => Promise<PluginModule>) | undefined
export function setPluginModuleImporter(importer: (code: string) => Promise<PluginModule>) {
  moduleImporter = importer
}
export function evaluatePlugin(code: string, api: Api): Promise<PluginModule> {
  const run = async () => {
    host.current = api
    if (moduleImporter) {
      try {
        return await moduleImporter(code)
      } finally {
        host.current = undefined
      }
    }
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    try {
      return (await import(/* @vite-ignore */ url)) as PluginModule
    } finally {
      URL.revokeObjectURL(url)
      host.current = undefined
    }
  }
  const result = evaluation.then(run, run)
  evaluation = result.catch(() => {})
  return result
}
