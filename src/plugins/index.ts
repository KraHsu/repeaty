import { computed, defineAsyncComponent, ref } from 'vue'
import installations from '@repeaty-plugins'
import { serverEdition } from '../edition'
import type { CardView } from '../core/model'
import type { PluginInstallation, QuestionPlugin } from './types'

const flashcard: QuestionPlugin = {
  id: 'flashcard',
  kind: 'frontend',
  label: '卡片',
  version: 1,
  showQuestion: defineAsyncComponent(() => import('./flashcard/Question.vue')),
  showAnswer: defineAsyncComponent(() => import('./flashcard/Answer.vue')),
}
// Installation is a deployment decision. Backups contain data, never plugin code.
export function validateInstallations(entries: readonly PluginInstallation[]) {
  const ids = new Set(['flashcard', 'unavailable'])
  for (const { plugin } of entries) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(plugin.id) || ids.has(plugin.id))
      throw new Error(`Invalid or duplicate plugin id: ${plugin.id}`)
    if (!Number.isSafeInteger(plugin.version) || plugin.version < 1)
      throw new Error(`Invalid plugin version: ${plugin.id}`)
    ids.add(plugin.id)
  }
  return entries
}
export const installedPlugins = validateInstallations(installations).filter(
  ({ plugin }) => plugin.kind === 'frontend' || serverEdition,
)
export const PLUGIN_PREFERENCES_KEY = 'repeaty.plugins.v1'
const preferences = ref<Record<string, boolean>>({})
const backendPlugins = ref<string[]>()
export function setAvailableBackendPlugins(ids: string[]) {
  backendPlugins.value = ids
}
export function pluginAvailable(id: string) {
  const plugin = installedPlugins.find((entry) => entry.plugin.id === id)?.plugin
  return Boolean(
    plugin &&
    (plugin.kind === 'frontend' ||
      (serverEdition && (!backendPlugins.value || backendPlugins.value.includes(id)))),
  )
}
export const pluginPreferenceError = ref('')
export function restorePluginPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PLUGIN_PREFERENCES_KEY) ?? '{}')
    preferences.value = Object.fromEntries(
      installedPlugins.flatMap(({ plugin }) =>
        value &&
        typeof value === 'object' &&
        Object.hasOwn(value, plugin.id) &&
        typeof value[plugin.id] === 'boolean'
          ? [[plugin.id, value[plugin.id]]]
          : [],
      ),
    )
  } catch {
    preferences.value = {}
  }
}
export function pluginEnabled(id: string): boolean {
  if (id === 'flashcard') return true
  const installed = installedPlugins.find(({ plugin }) => plugin.id === id)
  return Boolean(
    installed &&
    pluginAvailable(id) &&
    ((Object.hasOwn(preferences.value, id) ? preferences.value[id] : installed.enabledByDefault) ??
      true),
  )
}
export function setPluginEnabled(id: string, enabled: boolean) {
  if (!installedPlugins.some(({ plugin }) => plugin.id === id)) return
  preferences.value = { ...preferences.value, [id]: enabled }
  pluginPreferenceError.value = ''
  try {
    localStorage.setItem(PLUGIN_PREFERENCES_KEY, JSON.stringify(preferences.value))
  } catch {
    pluginPreferenceError.value = '插件开关已生效，但未能保存；下次打开时可能恢复默认设置。'
  }
}
export function listenPluginPreferences() {
  restorePluginPreferences()
  const receive = (event: StorageEvent) => {
    if (event.key === null || event.key === PLUGIN_PREFERENCES_KEY) restorePluginPreferences()
  }
  window.addEventListener('storage', receive)
  return () => window.removeEventListener('storage', receive)
}
export const enabledEditorPlugins = computed(() =>
  installedPlugins
    .map(({ plugin }) => plugin)
    .filter((plugin) => pluginEnabled(plugin.id) && plugin.editor),
)
const unavailable: QuestionPlugin = {
  id: 'unavailable',
  kind: 'frontend',
  label: '插件题目',
  version: 1,
  showQuestion: defineAsyncComponent(() => import('./Unavailable.vue')),
  showAnswer: defineAsyncComponent(() => import('./Unavailable.vue')),
}
export function questionPlugin(card: Pick<CardView, 'type' | 'plugin'>): QuestionPlugin {
  if (card.type !== 'plugin') return flashcard
  return (
    installedPlugins.find(
      ({ plugin }) =>
        plugin.id === card.plugin?.id &&
        plugin.version === card.plugin.version &&
        pluginEnabled(plugin.id),
    )?.plugin ?? unavailable
  )
}
export function canReviewCard(card: Pick<CardView, 'type' | 'plugin'>) {
  return questionPlugin(card).id !== 'unavailable'
}
