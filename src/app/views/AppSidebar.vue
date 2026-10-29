<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'
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
} from '@lucide/vue'
import { desktopEdition } from '../../edition'
import { WorkspaceBrowser, workspacePendingCount, workspaceDetectionError } from '@repeaty-platform'
import { useApplication } from '../context'
defineProps<{ collapsed: boolean; canToggle: boolean }>()
defineEmits<{ toggle: [] }>()
const { library, tab, review, mixed, modal, navigate, openHistory } = useApplication()
const { pluginPages, activePluginPage, openPluginPage } = useApplication()
const learning = [
  { page: 'overview', label: '学习概览', icon: Layers },
  { page: 'cards', label: '全部卡片', icon: Files },
  { page: 'sources', label: '学习材料', icon: BookOpen },
] as const
const utilities = [
  { page: 'plugins', label: '插件', icon: Puzzle },
  { page: 'settings', label: '设置', icon: Settings },
] as const
function active(page: string) {
  return page === 'overview'
    ? tab.value === page || !!review.value || !!mixed.value
    : tab.value === page && !review.value && !mixed.value
}
const navigation = ref<HTMLElement>()
const selection = ref<HTMLElement>()
let observer: ResizeObserver | undefined
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
onMounted(() => {
  observer = new ResizeObserver(positionSelection)
  if (navigation.value) observer.observe(navigation.value)
  updateSelection()
})
onUpdated(updateSelection)
onBeforeUnmount(() => {
  observer?.disconnect()
  observedLinks.clear()
})
</script>
<template>
  <aside class="sidebar">
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
        <UiButton
          v-for="item in learning"
          :key="item.page"
          variant="ghost"
          class="nav-link text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active(item.page),
            'bg-transparent text-(--app-nav-ink) hover:bg-transparent': active(item.page),
          }"
          :aria-current="active(item.page) ? 'page' : undefined"
          :aria-label="t(item.label)"
          :title="t(item.label)"
          @click="navigate(item.page)"
          ><component :is="item.icon" :size="22" /><span class="nav-label">{{
            t(item.label)
          }}</span></UiButton
        >
        <UiButton
          v-if="desktopEdition || library.practices.length"
          variant="ghost"
          class="nav-link text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active('history'),
            'bg-transparent text-(--app-nav-ink) hover:bg-transparent': active('history'),
          }"
          :aria-current="active('history') ? 'page' : undefined"
          :aria-label="t('练习历史')"
          :title="t('练习历史')"
          @click="openHistory()"
          ><History :size="22" /><span class="nav-label">{{ t('练习历史') }}</span></UiButton
        >
        <hr class="sidebar-divider" :aria-label="t('学习与管理')" />
        <UiButton
          v-if="WorkspaceBrowser"
          variant="ghost"
          class="nav-link workspace-nav text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active('workspace'),
            'bg-transparent text-(--app-nav-ink) hover:bg-transparent': active('workspace'),
          }"
          :aria-current="active('workspace') ? 'page' : undefined"
          :aria-label="t('工作目录')"
          :aria-description="
            workspacePendingCount
              ? t('{count} 项文件修改待检查', { count: workspacePendingCount })
              : workspaceDetectionError
                ? t('文件检测需要检查，请打开工作目录。')
                : undefined
          "
          :title="
            workspacePendingCount
              ? `${t('工作目录')} · ${t('{count} 项文件修改待检查', { count: workspacePendingCount })}`
              : workspaceDetectionError
                ? t('文件检测需要检查，请打开工作目录。')
                : t('工作目录')
          "
          @click="navigate('workspace')"
          ><FolderOpen :size="22" /><span class="nav-label">{{ t('工作目录') }}</span
          ><span v-if="workspacePendingCount" class="nav-count" aria-hidden="true">{{
            workspacePendingCount
          }}</span
          ><span v-else-if="workspaceDetectionError" class="nav-count" aria-hidden="true"
            >!</span
          ></UiButton
        >
        <UiButton
          variant="ghost"
          class="nav-link text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active('data'),
            'bg-transparent text-(--app-nav-ink) hover:bg-transparent': active('data'),
          }"
          :aria-current="active('data') ? 'page' : undefined"
          :aria-label="t('数据与备份')"
          :title="t('数据与备份')"
          @click="navigate('data')"
          ><Database :size="22" /><span class="nav-label">{{ t('数据与备份') }}</span></UiButton
        >
        <UiButton
          v-for="entry in pluginPages"
          :key="entry.key"
          variant="ghost"
          class="nav-link plugin-nav-link text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active('plugin-page') && activePluginPage?.key === entry.key,
            'bg-transparent text-(--app-nav-ink) hover:bg-transparent':
              active('plugin-page') && activePluginPage?.key === entry.key,
          }"
          :aria-current="
            active('plugin-page') && activePluginPage?.key === entry.key ? 'page' : undefined
          "
          :aria-label="t(entry.contribution.title)"
          :aria-description="t(entry.contribution.description ?? '') || undefined"
          :title="t(entry.contribution.title)"
          :data-plugin-page="`${entry.pluginId}/${entry.contribution.id}`"
          @click="openPluginPage(entry.pluginId, entry.contribution.id)"
        >
          <span class="plugin-nav-icon" aria-hidden="true"
            ><PluginNavigationIcon :component="entry.contribution.icon"
          /></span>
          <span class="nav-label plugin-nav-label">{{ t(entry.contribution.title) }}</span>
        </UiButton>
        <UiButton
          v-for="(item, index) in utilities"
          :key="item.page"
          variant="ghost"
          class="nav-link text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active(item.page),
            'nav-utility-start': index === 0,
            'bg-transparent text-(--app-nav-ink) hover:bg-transparent': active(item.page),
          }"
          :aria-current="active(item.page) ? 'page' : undefined"
          :aria-label="t(item.label)"
          :title="t(item.label)"
          @click="navigate(item.page)"
          ><component :is="item.icon" :size="22" /><span class="nav-label">{{
            t(item.label)
          }}</span></UiButton
        >
        <UiButton
          variant="ghost"
          class="nav-link sidebar-help text-(--muted) hover:bg-(--app-nav-hover)"
          :aria-label="t('帮助')"
          :title="t('快捷键') + ' · ?'"
          @click="modal = 'shortcuts'"
          ><CircleHelp :size="22" /><span class="nav-label">{{ t('帮助') }}</span></UiButton
        >
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
