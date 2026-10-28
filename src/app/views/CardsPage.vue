<script setup lang="ts">
import '../../styles/content-pages.css'
import { UiButton } from '../../components/ui'
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
  <div class="page cards-page">
    <header class="page-heading">
      <div>
        <h1>{{ currentDeck?.name ?? t('全部卡片') }}</h1>
        <p>{{ currentDeck?.description || t('搜索、编辑卡片，或批量调整卡组和标签。') }}</p>
      </div>
      <div class="heading-actions">
        <UiButton
          v-bind="{ variant: 'ghost', icon: true }"
          type="submit"
          v-if="currentDeck"
          :aria-label="t('编辑当前卡组')"
          @click="editDeck(currentDeck)"
        >
          <Pencil :size="18" /></UiButton
        ><UiButton
          v-bind="{ variant: 'ghost', icon: true }"
          type="submit"
          v-if="currentDeck"
          class="danger-text"
          :aria-label="t('删除当前卡组')"
          @click="confirmDeleteDeck(currentDeck)"
        >
          <Trash2 :size="18" />
        </UiButton>
        <UiButton variant="secondary" type="submit" @click="openImport">
          <ArrowUpFromLine :size="16" />{{ t('批量导入') }}
        </UiButton>
        <UiButton variant="primary" type="submit" @click="editCard()">
          <Plus :size="17" />{{ t('添加卡片') }}
        </UiButton>
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
