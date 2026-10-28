<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch, type Component } from 'vue'
import { t } from '../i18n'
import { usePlugins } from '../plugins'
import { usePluginManager } from '../plugins/manager'
import { createApplicationSettings } from '../settings/application'
import { buildSettingsCategories, collectSettingsCategoryEntries } from '../settings/categories'
import type { SettingsCategoryNode, SettingsContribution, SettingsEntry } from '../settings/types'
import SettingsContent from './SettingsContent.vue'
import BranchedMenu from './ui/BranchedMenu.vue'

const props = defineProps<{ focusPlugin?: string; platformSettings?: Component }>()
const emit = defineEmits<{ pluginDetails: [id: string] }>()
const { installedPlugins, pluginEnabled } = usePlugins()
const { pluginScope } = usePluginManager()
const selected = ref('general')
const focusOwner = ref<string>()
const domId = `settings-${useId()}`
const cached = new WeakMap<SettingsContribution, SettingsEntry>()
function configurePlugin(id: string) {
  const entry = entries.value.find((entry) => entry.pluginId === id)
  if (!entry) return
  selected.value = (entry.contribution.category ?? [{ id: 'general' }])
    .map(({ id }) => id)
    .join('.')
  focusOwner.value = id
}
function showPluginDetails(id: string) {
  emit('pluginDetails', id)
}
function applicationEntries() {
  return createApplicationSettings({
    scope: () => pluginScope.value,
    platformSettings: props.platformSettings,
  })
}
const builtins = shallowRef(applicationEntries())
watch(
  () => pluginScope.value,
  () => {
    builtins.value = applicationEntries()
  },
)
const entries = computed(() => [
  ...builtins.value,
  ...installedPlugins
    .filter(({ plugin }) => pluginEnabled(plugin.id))
    .flatMap((installation) =>
      (installation.settings ?? []).map((contribution) => {
        const previous = cached.get(contribution)
        if (previous?.scope === pluginScope.value) return previous
        const scope = pluginScope.value
        const entry: SettingsEntry = {
          ownerId: `plugin:${installation.plugin.id}`,
          pluginId: installation.plugin.id,
          contribution,
          scope,
          isCurrent: () =>
            scope === pluginScope.value &&
            installedPlugins.includes(installation) &&
            pluginEnabled(installation.plugin.id) &&
            !!installation.settings?.includes(contribution),
        }
        cached.set(contribution, entry)
        return entry
      }),
    ),
])
const categories = computed(() => {
  const roots = buildSettingsCategories(entries.value, [{ id: 'general', title: t('通用') }], {
    general: t('通用'),
    'general.appearance': t('界面'),
    'general.notifications': t('通知'),
    study: t('学习'),
    'study.review': t('复习'),
    connections: t('连接'),
    'connections.mcp': t('MCP 连接'),
    workspace: t('工作目录'),
    tools: t('工具'),
    'tools.ai': t('AI 制卡'),
  })
  const order: Record<string, number> = {
    general: 0,
    study: 10,
    connections: 20,
    workspace: 30,
    tools: 40,
  }
  const rank = (key: string) => (Object.hasOwn(order, key) ? order[key]! : 50)
  return roots.sort((first, second) => rank(first.key) - rank(second.key))
})
function flatten(
  nodes: readonly SettingsCategoryNode[],
  depth = 0,
): { node: SettingsCategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])
}
const navigation = computed(() => flatten(categories.value))
const active = computed(
  () => navigation.value.find(({ node }) => node.key === selected.value)?.node,
)
const visible = computed(() => (active.value ? collectSettingsCategoryEntries(active.value) : []))
watch(navigation, (items) => {
  if (!items.some(({ node }) => node.key === selected.value)) {
    selected.value = items[0]?.node.key ?? ''
    focusOwner.value = undefined
  }
})
function selectCategory(key: string) {
  selected.value = key
  focusOwner.value = undefined
}
let handledTarget: string | undefined
watch(
  [() => props.focusPlugin, entries],
  ([id]) => {
    if (!id) {
      handledTarget = undefined
      return
    }
    if (id !== handledTarget && entries.value.some((entry) => entry.pluginId === id)) {
      configurePlugin(id)
      handledTarget = id
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="page settings-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('设置') }}</h1>
        <p>{{ t('按分类调整软件与插件提供的选项。') }}</p>
      </div>
    </header>
    <div class="settings-layout">
      <BranchedMenu
        class="settings-categories"
        :items="categories"
        :model-value="selected"
        :label="t('设置分类')"
        :id-prefix="domId"
        :controls="`${domId}-content`"
        @update:model-value="selectCategory"
      />
      <section
        :id="`${domId}-content`"
        class="settings-panel"
        role="group"
        :aria-labelledby="`${domId}-category-${selected}`"
      >
        <SettingsContent
          :key="selected"
          :entries="visible"
          :scope="pluginScope"
          :focus-owner="focusOwner"
          @details="showPluginDetails"
        />
      </section>
    </div>
  </div>
</template>
<style scoped>
.settings-page {
  max-width: 1280px;
  container-type: inline-size;
}
.settings-layout {
  display: grid;
  grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr);
  align-items: start;
  gap: 2rem;
}
.settings-categories {
  position: sticky;
  top: calc(var(--desktop-titlebar-height, 0px) + 1rem);
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  max-height: calc(100dvh - var(--desktop-titlebar-height, 0px) - 2rem);
  overflow: auto;
  padding: 0.125rem;
  min-width: 0;
}
.settings-panel {
  min-width: 0;
}
@container (max-width: 50rem) {
  .settings-layout {
    grid-template-columns: 8rem minmax(0, 1fr);
    gap: 1rem;
  }
}
@container (max-width: 30rem) {
  .settings-layout {
    grid-template-columns: 6rem minmax(0, 1fr);
    gap: 0.75rem;
  }
}
</style>
