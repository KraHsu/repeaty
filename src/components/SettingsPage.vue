<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId, watch, type Component } from 'vue'
import { t } from '../i18n'
import { usePlugins } from '../plugins'
import { usePluginManager } from '../plugins/manager'
import { createApplicationSettings } from '../settings/application'
import { buildSettingsCategories, collectSettingsCategoryEntries } from '../settings/categories'
import type { SettingsCategoryNode, SettingsContribution, SettingsEntry } from '../settings/types'
import SettingsContent from './SettingsContent.vue'

const props = defineProps<{ initialTab?: 'general' | 'plugins'; platformSettings?: Component }>()
const { installedPlugins, pluginEnabled } = usePlugins()
const { pluginScope } = usePluginManager()
const selected = ref(props.initialTab === 'plugins' ? 'plugins' : 'general')
const focusOwner = ref<string>()
const detailsPlugin = ref<string>()
const categoryNav = ref<HTMLElement>()
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
  detailsPlugin.value = id
  focusOwner.value = undefined
  selected.value = 'plugins'
}
function applicationEntries() {
  return createApplicationSettings({
    scope: () => pluginScope.value,
    platformSettings: props.platformSettings,
    onConfigurePlugin: configurePlugin,
    detailsPlugin: () => detailsPlugin.value,
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
    plugins: t('插件'),
  })
  const order: Record<string, number> = {
    general: 0,
    study: 10,
    connections: 20,
    workspace: 30,
    tools: 40,
    plugins: 1000,
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
  detailsPlugin.value = undefined
}
async function moveCategory(event: KeyboardEvent) {
  const items = navigation.value
  if (
    !items.length ||
    !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  )
    return
  event.preventDefault()
  const index = items.findIndex(({ node }) => node.key === selected.value)
  const current = items[index]
  let next = index
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length
  else if (event.key === 'ArrowDown') next = (index + 1) % items.length
  else if (event.key === 'ArrowRight' && current?.node.children.length) next = index + 1
  else if (event.key === 'ArrowLeft' && current?.depth) {
    const parent = current.node.key.split('.').slice(0, -1).join('.')
    next = items.findIndex(({ node }) => node.key === parent)
  }
  selectCategory(items[next]?.node.key ?? items[0]!.node.key)
  await nextTick()
  categoryNav.value
    ?.querySelector<HTMLButtonElement>(`[data-category-key="${selected.value}"]`)
    ?.focus()
}
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
      <nav
        ref="categoryNav"
        class="settings-categories"
        role="tablist"
        aria-orientation="vertical"
        :aria-label="t('设置分类')"
        @keydown="moveCategory"
      >
        <button
          v-for="{ node, depth } in navigation"
          :id="`${domId}-category-${node.key}`"
          :key="node.key"
          type="button"
          role="tab"
          :data-category-key="node.key"
          :title="node.title"
          :aria-selected="selected === node.key"
          :tabindex="selected === node.key ? 0 : -1"
          :aria-controls="selected === node.key ? `${domId}-content` : undefined"
          :style="{ '--category-depth': depth }"
          @click="selectCategory(node.key)"
        >
          <span v-if="node.children.length" class="settings-category-branch" aria-hidden="true"
            >⌄</span
          ><span>{{ node.title }}</span>
        </button>
      </nav>
      <section
        :id="`${domId}-content`"
        class="settings-panel"
        role="tabpanel"
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
.settings-categories button {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0.625rem 0.625rem 0.625rem calc(0.625rem + var(--category-depth) * 0.875rem);
  border: 1px solid transparent;
  border-radius: var(--ui-control-radius);
  background: transparent;
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-control);
  line-height: var(--line-height-ui);
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.settings-categories button:hover {
  background: var(--ui-surface-subtle);
  color: var(--text);
}
.settings-categories button[aria-selected='true'] {
  background: var(--sage);
  border-color: #bdcbb6;
  color: var(--green);
  font-weight: var(--font-weight-semibold);
}
.settings-categories button:focus-visible {
  outline: 2px solid var(--ui-control-focus);
  outline-offset: -2px;
}
.settings-category-branch {
  flex: 0 0 auto;
  font-size: var(--font-size-meta);
}
.settings-categories button > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  .settings-categories button {
    padding-right: 0.375rem;
    padding-left: calc(0.375rem + var(--category-depth) * 0.5rem);
  }
}
</style>
