<script setup lang="ts">
import { t } from '../../i18n'
import { ArrowUpFromLine, Pencil, Plus, Trash2 } from '@lucide/vue'
import CollectionPanel from '../../components/CollectionPanel.vue'
import DeckStatus from '../../components/DeckStatus.vue'
import { useApplication } from '../context'
const {
  workspace,
  library,
  busy,
  now,
  selectedDeck,
  searchQuery,
  filterState,
  openHistory,
  currentDeck,
  deckStates,
  editDeck,
  editCard,
  openImport,
  confirmDeleteDeck,
  confirmDeleteNotes,
  startStudy,
  saveSearch,
  deleteSearch,
  changeCards,
  batchEdit,
  startReview,
} = useApplication()
</script>
<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <h1>{{ currentDeck?.name ?? t('全部卡片') }}</h1>
        <p>{{ currentDeck?.description || t('搜索、编辑卡片，或批量调整卡组和标签。') }}</p>
      </div>
      <div class="heading-actions">
        <button
          v-if="currentDeck"
          class="icon-button"
          :aria-label="t('编辑当前卡组')"
          @click="editDeck(currentDeck)"
        >
          <Pencil :size="18" /></button
        ><button
          v-if="currentDeck"
          class="icon-button danger-text"
          :aria-label="t('删除当前卡组')"
          @click="confirmDeleteDeck(currentDeck)"
        >
          <Trash2 :size="18" />
        </button>
        <button class="button secondary" @click="openImport">
          <ArrowUpFromLine :size="16" />{{ t('批量导入') }}
        </button>
        <button class="button primary" @click="editCard()">
          <Plus :size="17" />{{ t('添加卡片') }}
        </button>
      </div>
    </header>
    <DeckStatus v-if="currentDeck" :status="deckStates.get(currentDeck.id)!" />
    <CollectionPanel
      :query-cards="workspace.queryCards"
      v-model:deck-id="selectedDeck"
      v-model:query="searchQuery"
      v-model:state="filterState"
      :library="library"
      :now="now"
      :busy="busy"
      :change="changeCards"
      :batch-edit="batchEdit"
      :save-search="saveSearch"
      :delete-search="deleteSearch"
      @study="startStudy"
      @edit="editCard"
      @delete="confirmDeleteNotes"
      @review="startReview(selectedDeck || undefined)"
      @history="openHistory"
    />
  </div>
</template>
