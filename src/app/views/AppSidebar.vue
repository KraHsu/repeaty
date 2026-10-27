<script setup lang="ts">
import { version } from '../../../package.json'
import { t } from '../../i18n'
import {
  Database,
  History,
  FileText,
  FolderOpen,
  Layers,
  LayoutGrid,
  Plus,
  Puzzle,
  Repeat2,
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
      ><span class="brand-mark"><Repeat2 :size="24" :stroke-width="2.4" /></span>repeaty<span
        class="brand-dot"
        >.</span
      ></a
    >
    <div class="sidebar-content">
      <span class="sidebar-label">{{ t('间隔复习') }}</span>
      <nav class="main-nav" :aria-label="t('主导航')">
        <button
          v-if="WorkspaceBrowser"
          :class="{ active: tab === 'workspace' && !review }"
          :aria-current="tab === 'workspace' && !review ? 'page' : undefined"
          :aria-label="t('工作目录')"
          @click="navigate('workspace')"
        >
          <FolderOpen :size="19" />{{ t('工作目录')
          }}<span
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
        </button>
        <button
          :class="{ active: tab === 'overview' && !review }"
          :aria-current="tab === 'overview' && !review ? 'page' : undefined"
          @click="navigate('overview')"
        >
          <LayoutGrid :size="19" />{{ t('学习概览') }}
        </button>
        <button
          :class="{ active: tab === 'cards' && !review }"
          :aria-current="tab === 'cards' && !review ? 'page' : undefined"
          @click="navigate('cards')"
        >
          <Layers :size="19" />{{ t('全部卡片')
          }}<span class="nav-count">{{ library.cards.length }}</span>
        </button>
        <button
          :class="{ active: tab === 'sources' && !review }"
          :aria-current="tab === 'sources' && !review ? 'page' : undefined"
          @click="navigate('sources')"
        >
          <FileText :size="19" />{{ t('学习材料') }}
        </button>
        <button
          v-if="desktopEdition || library.practices.length"
          :class="{ active: tab === 'history' && !review }"
          :aria-current="tab === 'history' && !review ? 'page' : undefined"
          @click="openHistory()"
        >
          <History :size="19" />{{ t('练习历史') }}
        </button>
        <button
          :class="{ active: tab === 'plugins' && !review }"
          :aria-current="tab === 'plugins' && !review ? 'page' : undefined"
          @click="navigate('plugins')"
        >
          <Puzzle :size="19" />{{ t('插件') }}
        </button>
        <button
          :class="{ active: tab === 'data' && !review }"
          :aria-current="tab === 'data' && !review ? 'page' : undefined"
          @click="navigate('data')"
        >
          <Database :size="19" />{{ t('数据与备份') }}
        </button>
      </nav>
      <div class="sidebar-decks">
        <div class="sidebar-section-title">
          {{ t('我的卡组')
          }}<button
            class="icon-button"
            :aria-label="t('新建卡组')"
            :disabled="!ready || busy"
            @click="editDeck()"
          >
            <Plus :size="16" />
          </button>
        </div>
        <button
          v-for="deck in library.decks"
          :key="deck.id"
          class="sidebar-deck"
          :class="{ selected: selectedDeck === deck.id }"
          @click="openDeck(deck)"
        >
          <span :class="['color-dot', deck.color]" /><span class="truncate">{{ deck.name }}</span
          ><span>{{ deckCards(deck.id) }}</span>
        </button>
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
        <a href="https://github.com/KraHsu/repeaty" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </div>
    </div>
  </aside>
</template>
