import { computed, watch, type Ref } from 'vue'
import type { useAppNavigation } from './useAppNavigation'
import { createPluginRegistry } from '../plugins'
import type { PluginManager } from '../plugins/manager'
import type { PluginPageContribution } from '../plugins/pages'
import type { PluginWidgetContribution } from '../plugins/widgets'

export interface PluginViewEntry<T> {
  pluginId: string
  scope: string
  key: string
  contribution: T
}

/** Component lifetimes belong to the active registration, never only its reusable public ID. */
export function usePluginViews(
  navigation: ReturnType<typeof useAppNavigation>,
  workspaceScope: Readonly<Ref<string>>,
  manager: PluginManager,
) {
  const { installedPlugins, pluginEnabled } = createPluginRegistry(manager)
  const keys = new WeakMap<object, number>()
  let nextKey = 0
  function entry<T extends object>(pluginId: string, contribution: T): PluginViewEntry<T> {
    if (!keys.has(contribution)) keys.set(contribution, ++nextKey)
    return {
      pluginId,
      contribution,
      scope: manager.pluginScope.value,
      key: `${manager.pluginScope.value}:${pluginId}:${keys.get(contribution)}`,
    }
  }
  const currentInstallations = computed(() =>
    manager.pluginScope.value === workspaceScope.value
      ? installedPlugins.filter(({ plugin }) => pluginEnabled(plugin.id))
      : [],
  )
  const pluginPages = computed(() =>
    currentInstallations.value.flatMap(({ plugin, pages }) =>
      (pages ?? []).map((page) => entry<PluginPageContribution>(plugin.id, page)),
    ),
  )
  const pluginWidgets = computed(() =>
    currentInstallations.value.flatMap(({ plugin, widgets }) =>
      (widgets ?? []).map((widget) => entry<PluginWidgetContribution>(plugin.id, widget)),
    ),
  )
  const activePluginPage = computed(() => {
    const target = navigation.pluginPage.value
    return target && navigation.tab.value === 'plugin-page'
      ? pluginPages.value.find(
          (page) => page.pluginId === target.pluginId && page.contribution.id === target.pageId,
        )
      : undefined
  })
  function openPluginPage(pluginId: string, pageId: string) {
    if (
      pluginPages.value.some(
        (page) => page.pluginId === pluginId && page.contribution.id === pageId,
      )
    )
      navigation.openPluginPage(pluginId, pageId)
  }
  watch(
    [activePluginPage, navigation.tab],
    ([active, tab]) => {
      if (tab === 'plugin-page' && !active) navigation.navigate('overview')
    },
    { immediate: true },
  )
  return { pluginPages, pluginWidgets, activePluginPage, openPluginPage }
}
