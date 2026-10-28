import * as vue from 'vue'
import { t, locale } from '../i18n'
import { readSetting, writeSetting } from '../settings-store'
import { practiceContentRevision } from '../core/practice'
import { hasAttemptBody } from '../core/practice-data'
import { callPluginHost, readPluginData, writePluginData } from '@repeaty-plugin-host'
import type { PluginManifest } from './package'
import type { PluginModule } from './runtime'
import type { PluginSettingsContribution, RegisterPluginSettings } from './settings'
import {
  SettingGroup,
  SettingSection,
  SettingField,
  UiButton,
  UiIconButton,
  UiNotice,
  UiStatus,
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
) {
  let alive = true
  disposers.push(() => {
    alive = false
  })
  function guard() {
    if (!alive || !isCurrent()) throw new Error('插件已卸载或学习库已切换。')
  }
  const settingsKey = (key: string) => `plugin:${manifest.id}:${key}`
  const native = async (operation: string, payload: unknown) => {
    guard()
    return nativePluginCall(manifest.id, operation, payload, scope)
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
  return {
    t,
    locale,
    MediaList,
    CardContent,
    PracticeHistory,
    AttemptBody,
    SettingGroup,
    SettingSection,
    SettingField,
    UiButton,
    UiIconButton,
    UiNotice,
    UiStatus,
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
    pluginData,
    readSetting(key: string) {
      guard()
      return readSetting(settingsKey(key))
    },
    writeSetting(key: string, value: string, onError?: () => void) {
      guard()
      writeSetting(settingsKey(key), value, onError)
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
