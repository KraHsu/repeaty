<script setup lang="ts">
import { UiButton } from '../../components/ui'
import { version } from '../../../package.json'
import { t } from '../../i18n'
import {
  Database,
  History,
  FileText,
  FolderOpen,
  ExternalLink,
  Layers,
  LayoutGrid,
  Plus,
  Repeat2,
  Settings,
  Puzzle,
} from '@lucide/vue'
import { remoteWorkspace, desktopEdition } from '../../edition'
import { WorkspaceBrowser, workspacePendingCount, workspaceDetectionError } from '@repeaty-platform'
import { useApplication } from '../context'
const {
  library,
  ready,
  busy,
  tab,
  selectedDeck,
  review,
  navigate,
  openHistory,
  openDeck,
  deckCards,
  editDeck,
} = useApplication()
</script>
<template>
  <aside class="sidebar">
    <a href="#" class="brand" :aria-label="t('Repeaty 首页')" @click.prevent="navigate('overview')"
      ><span class="brand-mark"><Repeat2 :size="24" :stroke-width="2.4" /></span
      ><span class="brand-name">repeaty<span class="brand-dot">.</span></span></a
    >
    <div class="sidebar-content">
      <span class="sidebar-label">{{ t('间隔复习') }}</span>
      <nav class="main-nav" :aria-label="t('主导航')">
        <UiButton
          :variant="tab === 'workspace' && !review ? 'primary' : 'ghost'"
          v-if="WorkspaceBrowser"
          class="workspace-nav"
          :class="{ active: tab === 'workspace' && !review }"
          :aria-current="tab === 'workspace' && !review ? 'page' : undefined"
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
        >
          <FolderOpen :size="19" /><span class="nav-label">{{ t('工作目录') }}</span
          ><span
            v-if="workspacePendingCount"
            class="nav-count"
            aria-hidden="true"
            :title="t('{count} 项文件修改待检查', { count: workspacePendingCount })"
            >{{ workspacePendingCount }}</span
          ><span
            v-else-if="workspaceDetectionError"
            class="nav-count"
            aria-hidden="true"
            :title="t('文件检测需要检查，请打开工作目录。')"
            >!</span
          >
        </UiButton>
        <UiButton
          :variant="tab === 'overview' && !review ? 'primary' : 'ghost'"
          :class="{ active: tab === 'overview' && !review }"
          :aria-current="tab === 'overview' && !review ? 'page' : undefined"
          :aria-label="t('学习概览')"
          :title="t('学习概览')"
          @click="navigate('overview')"
        >
          <LayoutGrid :size="19" /><span class="nav-label">{{ t('学习概览') }}</span>
        </UiButton>
        <UiButton
          :variant="tab === 'cards' && !review ? 'primary' : 'ghost'"
          :class="{ active: tab === 'cards' && !review }"
          :aria-current="tab === 'cards' && !review ? 'page' : undefined"
          :aria-label="t('全部卡片')"
          :title="t('全部卡片')"
          @click="navigate('cards')"
        >
          <Layers :size="19" /><span class="nav-label">{{ t('全部卡片') }}</span
          ><span class="nav-count">{{ library.cards.length }}</span>
        </UiButton>
        <UiButton
          :variant="tab === 'sources' && !review ? 'primary' : 'ghost'"
          :class="{ active: tab === 'sources' && !review }"
          :aria-current="tab === 'sources' && !review ? 'page' : undefined"
          :aria-label="t('学习材料')"
          :title="t('学习材料')"
          @click="navigate('sources')"
        >
          <FileText :size="19" /><span class="nav-label">{{ t('学习材料') }}</span>
        </UiButton>
        <UiButton
          :variant="tab === 'history' && !review ? 'primary' : 'ghost'"
          v-if="desktopEdition || library.practices.length"
          :class="{ active: tab === 'history' && !review }"
          :aria-current="tab === 'history' && !review ? 'page' : undefined"
          :aria-label="t('练习历史')"
          :title="t('练习历史')"
          @click="openHistory()"
        >
          <History :size="19" /><span class="nav-label">{{ t('练习历史') }}</span>
        </UiButton>
        <UiButton
          :variant="tab === 'plugins' && !review ? 'primary' : 'ghost'"
          :class="{ active: tab === 'plugins' && !review }"
          :aria-current="tab === 'plugins' && !review ? 'page' : undefined"
          :aria-label="t('插件')"
          :title="t('插件')"
          @click="navigate('plugins')"
        >
          <Puzzle :size="19" /><span class="nav-label">{{ t('插件') }}</span>
        </UiButton>
        <UiButton
          :variant="tab === 'settings' && !review ? 'primary' : 'ghost'"
          :class="{ active: tab === 'settings' && !review }"
          :aria-current="tab === 'settings' && !review ? 'page' : undefined"
          :aria-label="t('设置')"
          :title="t('设置')"
          @click="navigate('settings')"
        >
          <Settings :size="19" /><span class="nav-label">{{ t('设置') }}</span>
        </UiButton>
        <UiButton
          :variant="tab === 'data' && !review ? 'primary' : 'ghost'"
          :class="{ active: tab === 'data' && !review }"
          :aria-current="tab === 'data' && !review ? 'page' : undefined"
          :aria-label="t('数据与备份')"
          :title="t('数据与备份')"
          @click="navigate('data')"
        >
          <Database :size="19" /><span class="nav-label">{{ t('数据与备份') }}</span>
        </UiButton>
      </nav>
      <div class="sidebar-decks">
        <div class="sidebar-section-title">
          <span class="sidebar-section-label">{{ t('我的卡组') }}</span
          ><UiButton
            v-bind="{ variant: 'ghost', icon: true }"
            type="submit"
            :aria-label="t('新建卡组')"
            :title="t('新建卡组')"
            :disabled="!ready || busy"
            @click="editDeck()"
          >
            <Plus :size="16" />
          </UiButton>
        </div>
        <UiButton
          :variant="selectedDeck === deck.id ? 'primary' : 'ghost'"
          v-for="deck in library.decks"
          :key="deck.id"
          class="sidebar-deck"
          :class="{ selected: selectedDeck === deck.id }"
          :aria-label="deck.name"
          :title="deck.name"
          @click="openDeck(deck)"
        >
          <span :class="['color-dot', deck.color]" /><span class="deck-name truncate">{{
            deck.name
          }}</span
          ><span class="deck-count">{{ deckCards(deck.id) }}</span>
        </UiButton>
        <p v-if="!library.decks.length" class="sidebar-empty">
          {{ t('暂无卡组') }}
        </p>
      </div>
    </div>
    <div class="sidebar-bottom">
      <div class="local-status">
        <span />{{ t(desktopEdition || remoteWorkspace ? 'SQLite 存储' : '本地存储') }}
      </div>
      <p>
        {{
          t(remoteWorkspace ? '后端版' : desktopEdition ? '桌面版 · 本地学习库' : '仅限当前浏览器')
        }}
      </p>
      <div class="version-links">
        <span class="version">Repeaty {{ version }}</span>
        <a
          href="https://github.com/KraHsu/repeaty"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          title="GitHub"
        >
          <ExternalLink :size="16" class="sidebar-footer-icon" aria-hidden="true" /><span
            class="sidebar-footer-label"
            >GitHub</span
          >
        </a>
      </div>
    </div>
  </aside>
</template>
