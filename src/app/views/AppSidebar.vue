<script setup lang="ts">
import { UiButton } from '../../components/ui'
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
      <nav id="primary-navigation" class="main-nav" :aria-label="t('主导航')">
        <UiButton
          v-for="item in learning"
          :key="item.page"
          variant="ghost"
          class="nav-link text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active(item.page),
            'bg-(--app-nav-active) text-(--app-nav-ink) hover:bg-(--app-nav-active)': active(
              item.page,
            ),
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
            'bg-(--app-nav-active) text-(--app-nav-ink) hover:bg-(--app-nav-active)':
              active('history'),
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
            'bg-(--app-nav-active) text-(--app-nav-ink) hover:bg-(--app-nav-active)':
              active('workspace'),
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
            'bg-(--app-nav-active) text-(--app-nav-ink) hover:bg-(--app-nav-active)':
              active('data'),
          }"
          :aria-current="active('data') ? 'page' : undefined"
          :aria-label="t('数据与备份')"
          :title="t('数据与备份')"
          @click="navigate('data')"
          ><Database :size="22" /><span class="nav-label">{{ t('数据与备份') }}</span></UiButton
        >
        <UiButton
          v-for="(item, index) in utilities"
          :key="item.page"
          variant="ghost"
          class="nav-link text-(--muted) hover:bg-(--app-nav-hover)"
          :class="{
            active: active(item.page),
            'nav-utility-start': index === 0,
            'bg-(--app-nav-active) text-(--app-nav-ink) hover:bg-(--app-nav-active)': active(
              item.page,
            ),
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
