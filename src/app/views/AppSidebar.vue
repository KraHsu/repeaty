<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, type Component } from 'vue'
import { navigationPreferences, orderedNavigation } from '../../navigation-preferences'
import { UiButton } from '../../components/ui'
import PluginNavigationIcon from '../../components/PluginNavigationIcon.vue'
import { version } from '../../../package.json'
import { t } from '../../i18n'
import {
  Database,
  History,
  Files,
  BookOpen,
  FolderOpen,
  ExternalLink,
  Layers,
  Repeat2,
  Settings,
  Puzzle,
  PanelLeft,
  CircleHelp,
  Star,
  ChartColumn,
  Grid2X2,
} from '@lucide/vue'
import { desktopEdition } from '../../edition'
import { WorkspaceBrowser, workspacePendingCount, workspaceDetectionError } from '@repeaty-platform'
import { useApplication } from '../context'
defineProps<{ collapsed: boolean; canToggle: boolean }>()
defineEmits<{ toggle: [] }>()
const { library, tab, review, mixed, modal, navigate, openHistory } = useApplication()
const { pluginPages, activePluginPage, openPluginPage } = useApplication()
const iconOptions: Record<string, Component> = {
  layers: Layers,
  files: Files,
  book: BookOpen,
  folder: FolderOpen,
  history: History,
  database: Database,
  puzzle: Puzzle,
  settings: Settings,
  star: Star,
  chart: ChartColumn,
  grid: Grid2X2,
}
interface NavigationItem {
  id: string
  label: string
  icon?: Component
  action: () => unknown
  selected: boolean
  group: string
  pluginId?: string
  pageId?: string
  description?: string
}
const items = computed(() => {
  const base: NavigationItem[] = [
    {
      id: 'overview',
      label: '学习概览',
      icon: Layers,
      action: () => navigate('overview'),
      selected: active('overview'),
      group: 'learning',
    },
    {
      id: 'cards',
      label: '全部卡片',
      icon: Files,
      action: () => navigate('cards'),
      selected: active('cards'),
      group: 'learning',
    },
    {
      id: 'sources',
      label: '学习材料',
      icon: BookOpen,
      action: () => navigate('sources'),
      selected: active('sources'),
      group: 'learning',
    },
  ]
  if (desktopEdition || library.value.practices.length)
    base.push({
      id: 'history',
      label: '练习历史',
      icon: History,
      action: openHistory,
      selected: active('history'),
      group: 'learning',
    })
  if (WorkspaceBrowser)
    base.push({
      id: 'workspace',
      label: '工作目录',
      icon: FolderOpen,
      action: () => navigate('workspace'),
      selected: active('workspace'),
      group: 'management',
      description: workspacePendingCount.value
        ? t('{count} 项文件修改待检查', { count: workspacePendingCount.value })
        : workspaceDetectionError.value
          ? t('文件检测需要检查，请打开工作目录。')
          : undefined,
    })
  base.push({
    id: 'data',
    label: '数据与备份',
    icon: Database,
    action: () => navigate('data'),
    selected: active('data'),
    group: 'management',
  })
  for (const entry of pluginPages.value)
    base.push({
      id: `plugin:${entry.pluginId}/${entry.contribution.id}`,
      label: entry.contribution.title,
      icon: entry.contribution.icon,
      action: () => openPluginPage(entry.pluginId, entry.contribution.id),
      selected: active('plugin-page') && activePluginPage.value?.key === entry.key,
      group: 'management',
      pluginId: entry.pluginId,
      pageId: entry.contribution.id,
      description: entry.contribution.description,
    })
  base.push(
    {
      id: 'plugins',
      label: '插件',
      icon: Puzzle,
      action: () => navigate('plugins'),
      selected: active('plugins'),
      group: 'utility',
    },
    {
      id: 'settings',
      label: '设置',
      icon: Settings,
      action: () => navigate('settings'),
      selected: active('settings'),
      group: 'utility',
    },
    {
      id: 'help',
      label: '帮助',
      icon: CircleHelp,
      action: () => {
        modal.value = 'shortcuts'
      },
      selected: false,
      group: 'utility',
    },
  )
  return orderedNavigation(base).filter(
    (item) =>
      item.selected ||
      item.id === 'settings' ||
      item.id === 'help' ||
      !navigationPreferences.hidden.includes(item.id),
  )
})
function itemIcon(item: NavigationItem) {
  return iconOptions[navigationPreferences.icons[item.id] ?? ''] ?? item.icon
}
function active(page: string) {
  return page === 'overview'
    ? tab.value === page || !!review.value || !!mixed.value
    : tab.value === page && !review.value && !mixed.value
}
const navigation = ref<HTMLElement>()
const selection = ref<HTMLElement>()
let observer: ResizeObserver | undefined
let resizeFrame: number | undefined
const observedLinks = new Set<HTMLElement>()
function positionSelection() {
  const nav = navigation.value
  const background = selection.value
  if (!nav || !background) return
  const target = nav.querySelector<HTMLElement>('.nav-link[aria-current="page"]')
  if (!target?.offsetWidth || !target.offsetHeight) {
    background.removeAttribute('data-on')
    return
  }
  const firstFrame = !background.hasAttribute('data-on')
  if (firstFrame) background.style.transition = 'none'
  // Layout offsets ignore the button's brief pressed scale and remain stable
  // while the navigation scrolls. Vertical width follows the rail directly in CSS.
  background.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`
  background.style.setProperty('--selection-width', `${target.offsetWidth}px`)
  background.style.height = `${target.offsetHeight}px`
  background.setAttribute('data-on', '')
  if (firstFrame) {
    void background.offsetHeight
    background.style.transition = ''
  }
}
function updateSelection() {
  const links = new Set(navigation.value?.querySelectorAll<HTMLElement>('.nav-link'))
  for (const link of observedLinks) {
    if (!links.has(link)) {
      observer?.unobserve(link)
      observedLinks.delete(link)
    }
  }
  for (const link of links) {
    if (!observedLinks.has(link)) {
      observer?.observe(link)
      observedLinks.add(link)
    }
  }
  positionSelection()
}
function positionAfterResize() {
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  // Chromium can report resize/media changes before applying the new CSS gap,
  // even in that frame's rAF. Cross the render boundary before measuring it.
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      positionSelection()
    })
  })
}
onMounted(() => {
  observer = new ResizeObserver(positionSelection)
  if (navigation.value) observer.observe(navigation.value)
  updateSelection()
  // Responsive gaps can move links without resizing the links or navigation.
  // ResizeObserver alone does not report that positional change.
  window.addEventListener('resize', positionAfterResize)
})
onUpdated(updateSelection)
onBeforeUnmount(() => {
  window.removeEventListener('resize', positionAfterResize)
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  observer?.disconnect()
  observedLinks.clear()
})
</script>
<template>
  <aside
    class="sidebar"
    :data-density="navigationPreferences.density"
    :data-always-labels="navigationPreferences.labels === 'always'"
    :data-custom-order="navigationPreferences.order.length > 0"
  >
    <div class="sidebar-tools">
      <UiButton
        v-if="canToggle"
        variant="ghost"
        icon
        class="sidebar-toggle"
        :aria-label="t(collapsed ? '展开侧栏' : '收起侧栏')"
        :title="t(collapsed ? '展开侧栏' : '收起侧栏')"
        :aria-expanded="!collapsed"
        aria-controls="primary-navigation"
        @click="$emit('toggle')"
        ><PanelLeft :size="20"
      /></UiButton>
      <a
        href="#"
        class="brand"
        :aria-label="t('Repeaty 首页')"
        @click.prevent="navigate('overview')"
        ><span class="brand-mark"><Repeat2 :size="24" :stroke-width="2.4" /></span
        ><span class="brand-name">repeaty<span class="brand-dot">.</span></span></a
      >
    </div>
    <div class="sidebar-content">
      <nav ref="navigation" id="primary-navigation" class="main-nav" :aria-label="t('主导航')">
        <span ref="selection" class="sidebar-nav-selection" aria-hidden="true" />
        <template v-for="(item, index) in items" :key="item.id">
          <hr
            v-if="
              !navigationPreferences.order.length &&
              item.group === 'management' &&
              items[index - 1]?.group === 'learning'
            "
            class="sidebar-divider"
            :aria-label="t('学习与管理')"
          />
          <UiButton
            variant="ghost"
            class="nav-link text-(--muted) hover:bg-(--app-nav-hover)"
            :class="{
              active: item.selected,
              'bg-transparent text-(--app-nav-ink) hover:bg-transparent': item.selected,
              'workspace-nav': item.id === 'workspace',
              'plugin-nav-link': !!item.pluginId,
              'nav-utility-start':
                !navigationPreferences.order.length &&
                item.group === 'utility' &&
                items[index - 1]?.group !== 'utility',
              'sidebar-help': item.id === 'help',
            }"
            :aria-current="item.selected ? 'page' : undefined"
            :aria-label="t(item.label)"
            :aria-description="item.description ? t(item.description) : undefined"
            :title="t(item.label)"
            :data-plugin-page="item.pluginId ? `${item.pluginId}/${item.pageId}` : undefined"
            :data-navigation-id="item.id"
            @click="item.action()"
          >
            <span
              v-if="item.pluginId && !iconOptions[navigationPreferences.icons[item.id] ?? '']"
              class="plugin-nav-icon"
              aria-hidden="true"
              ><PluginNavigationIcon :component="item.icon"
            /></span>
            <component :is="itemIcon(item)" v-else :size="22" aria-hidden="true" />
            <span class="nav-label">{{ t(item.label) }}</span>
            <span
              v-if="item.id === 'workspace' && workspacePendingCount"
              class="nav-count"
              aria-hidden="true"
              >{{ workspacePendingCount }}</span
            >
            <span
              v-else-if="item.id === 'workspace' && workspaceDetectionError"
              class="nav-count"
              aria-hidden="true"
              >!</span
            >
          </UiButton>
        </template>
      </nav>
    </div>
    <footer class="sidebar-bottom">
      <div class="version-links">
        <span class="version">v{{ version }}</span
        ><a
          href="https://github.com/KraHsu/repeaty"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          title="GitHub"
          ><ExternalLink :size="16" class="sidebar-footer-icon" aria-hidden="true" /><span
            class="sidebar-footer-label"
            >GitHub</span
          ></a
        >
      </div>
    </footer>
  </aside>
</template>
