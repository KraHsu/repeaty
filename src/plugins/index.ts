import { computed, defineAsyncComponent } from 'vue'
import { defaultPluginManager, usePluginManager, type PluginManager } from './manager'
import type { Pinia } from 'pinia'
export {
  PLUGIN_PREFERENCES_KEY,
  pluginPreferenceError,
  restorePluginPreferences,
  listenPluginPreferences,
} from './preferences'
import { desktopEdition } from '../edition'
import type { CardView } from '../core/model'
import {
  isQuestionPlugin,
  type PluginInstallation,
  type QuestionPlugin,
  type ReviewPanelPlugin,
} from './types'

const flashcard: QuestionPlugin = {
  id: 'flashcard',
  kind: 'frontend',
  label: '卡片',
  version: 1,
  showQuestion: defineAsyncComponent(() => import('../components/flashcard/Question.vue')),
  showAnswer: defineAsyncComponent(() => import('../components/flashcard/Answer.vue')),
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
export function createPluginRegistry(manager: PluginManager) {
  const installedPlugins = manager.pluginRuntime.installations
  const pluginPreferences = manager.pluginPreferences
  function pluginAvailable(id: string) {
    return installedPlugins.some(
      ({ plugin }) => plugin.id === id && (plugin.kind === 'frontend' || desktopEdition),
    )
  }
  function pluginEnabled(id: string): boolean {
    if (id === 'flashcard') return true
    const installed = installedPlugins.find(({ plugin }) => plugin.id === id)
    return Boolean(
      installed &&
      pluginAvailable(id) &&
      ((Object.hasOwn(pluginPreferences.value, id)
        ? pluginPreferences.value[id]
        : installed.enabledByDefault) ??
        true),
    )
  }
  function setPluginEnabled(id: string, enabled: boolean) {
    if (id === 'flashcard') return Promise.resolve()
    return manager.enablePlugin(id, enabled)
  }
  const enabledEditorPlugins = computed(() =>
    installedPlugins
      .map(({ plugin }) => plugin)
      .filter(
        (plugin): plugin is QuestionPlugin =>
          isQuestionPlugin(plugin) && pluginEnabled(plugin.id) && !!plugin.editor,
      ),
  )
  const enabledReviewPanels = computed(() =>
    installedPlugins
      .map(({ plugin }) => plugin)
      .filter(
        (plugin): plugin is ReviewPanelPlugin =>
          'reviewPanel' in plugin && pluginEnabled(plugin.id),
      ),
  )
  const unavailable: QuestionPlugin = {
    id: 'unavailable',
    kind: 'frontend',
    label: '插件题目',
    version: 1,
    showQuestion: defineAsyncComponent(() => import('../components/UnavailableQuestion.vue')),
    showAnswer: defineAsyncComponent(() => import('../components/UnavailableQuestion.vue')),
  }
  function questionPlugin(card: Pick<CardView, 'type' | 'plugin'>): QuestionPlugin {
    if (card.type !== 'plugin') return flashcard
    return (
      installedPlugins
        .map(({ plugin }) => plugin)
        .filter(isQuestionPlugin)
        .find(
          (plugin) =>
            plugin.id === card.plugin?.id &&
            plugin.version === card.plugin.version &&
            pluginEnabled(plugin.id),
        ) ?? unavailable
    )
  }
  function canReviewCard(card: Pick<CardView, 'type' | 'plugin'>) {
    return questionPlugin(card).id !== 'unavailable'
  }
  return {
    installedPlugins,
    pluginAvailable,
    pluginEnabled,
    setPluginEnabled,
    enabledEditorPlugins,
    enabledReviewPanels,
    questionPlugin,
    canReviewCard,
    pluginPreferenceError: manager.pluginPreferenceError,
    restorePluginPreferences: manager.restorePluginPreferences,
    listenPluginPreferences: manager.listenPluginPreferences,
  }
}
const registries = new WeakMap<PluginManager, ReturnType<typeof createPluginRegistry>>()
export function usePlugins(pinia?: Pinia) {
  const manager = usePluginManager(pinia)
  let registry = registries.get(manager)
  if (!registry) {
    registry = createPluginRegistry(manager)
    registries.set(manager, registry)
  }
  return registry
}
export const {
  installedPlugins,
  pluginAvailable,
  pluginEnabled,
  setPluginEnabled,
  enabledEditorPlugins,
  enabledReviewPanels,
  questionPlugin,
  canReviewCard,
} = createPluginRegistry(defaultPluginManager)
