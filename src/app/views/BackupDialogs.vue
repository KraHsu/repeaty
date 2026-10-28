<script setup lang="ts">
import { vUiButton } from '../../components/ui'
import { t } from '../../i18n'
import AppModal from '../../components/AppModal.vue'
import { useApplication } from '../context'
const { busy, modal, notice, pendingBackup, pendingSnapshot, restoreSnapshot, restoreBackup } =
  useApplication()
</script>
<template>
  <AppModal
    v-if="modal === 'snapshot' && pendingSnapshot"
    :title="t('恢复此快照？')"
    :busy="busy"
    :error="notice?.error ? t(notice.text) : undefined"
    @close="modal = null"
    ><p class="confirmation-text">
      {{
        t('包含 {p0} 条笔记、{p1} 张卡片。恢复会替换当前数据。操作前会保存当前数据的快照。', {
          p0: pendingSnapshot.notes.length,
          p1: pendingSnapshot.cards.length,
        })
      }}
    </p>
    <p v-if="pendingSnapshot.sources.length" class="confirmation-text">
      {{ t('还包含 {count} 份学习材料及其原文快照。', { count: pendingSnapshot.sources.length }) }}
    </p>
    <div class="form-actions">
      <button
        v-ui-button="'secondary'"
        class="button secondary"
        :disabled="busy"
        @click="modal = null"
      >
        {{ t('取消') }}</button
      ><button
        v-ui-button="'primary'"
        class="button primary"
        :disabled="busy"
        @click="restoreSnapshot"
      >
        {{ t('确认恢复快照') }}
      </button>
    </div></AppModal
  >
  <AppModal
    :error="notice?.error ? t(notice.text) : undefined"
    v-if="modal === 'import' && pendingBackup"
    :title="t('恢复此备份？')"
    :busy="busy"
    @close="modal = null"
    ><p class="confirmation-text">
      {{
        t('备份包含 {p0} 个卡组、{p1} 张卡片和 {p2} 条复习记录。', {
          p0: pendingBackup.library.decks.length,
          p1: pendingBackup.library.cards.length,
          p2: pendingBackup.library.reviews.length,
        })
      }}
    </p>
    <p v-if="pendingBackup.library.sources.length" class="confirmation-text">
      {{
        t('还包含 {count} 份学习材料及其原文快照。', {
          count: pendingBackup.library.sources.length,
        })
      }}
    </p>
    <p class="import-warning">
      {{ t('恢复会替换当前所有卡组、卡片和复习进度。建议先导出当前数据作为备份。') }}
    </p>
    <div class="form-actions">
      <button
        v-ui-button="'secondary'"
        class="button secondary"
        :disabled="busy"
        @click="modal = null"
      >
        {{ t('取消') }}</button
      ><button
        v-ui-button="'primary'"
        class="button primary"
        :disabled="busy"
        @click="restoreBackup"
      >
        {{ t('替换并恢复') }}
      </button>
    </div></AppModal
  >
</template>
