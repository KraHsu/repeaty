<script setup lang="ts">
import { vUiButton, vUiControl } from '../../components/ui'
import { t } from '../../i18n'
import { Check } from '@lucide/vue'
import AppModal from '../../components/AppModal.vue'
import NoteEditor from '../../components/NoteEditor.vue'
import ImportNotes from '../../components/ImportNotes.vue'
import { colors } from '../../core/model'
import { useApplication } from '../context'
const {
  workspace,
  library,
  busy,
  selectedDeck,
  modal,
  notice,
  editingId,
  sourceDraft,
  deckForm,
  retentionPercent,
  editingNote,
  confirmation,
  saveDeck,
  saveCard,
  confirmAction,
  importNotes,
  importAnki,
} = useApplication()
</script>
<template>
  <AppModal
    :error="notice?.error ? t(notice.text) : undefined"
    v-if="modal === 'deck'"
    :title="editingId ? t('编辑卡组') : t('创建卡组')"
    :busy="busy"
    @close="modal = null"
    ><form class="editor-form" @submit.prevent="saveDeck">
      <label for="deck-name">{{ t('卡组名称') }}</label
      ><input
        v-ui-control
        id="deck-name"
        v-model.trim="deckForm.name"
        autofocus
        required
        maxlength="80"
        :placeholder="t('例如：英语词汇、计算机基础…')"
      /><label for="deck-description"
        >{{ t('描述') }}<span class="optional">{{ t('可选') }}</span></label
      ><textarea
        v-ui-control
        id="deck-description"
        v-model.trim="deckForm.description"
        maxlength="300"
        rows="3"
        :placeholder="t('卡组内容或用途')"
      />
      <div class="limit-fields">
        <label for="new-limit"
          >{{ t('每日新卡上限')
          }}<input
            v-ui-control
            id="new-limit"
            v-model.number="deckForm.newLimit"
            type="number"
            min="0"
            max="9999"
            required /></label
        ><label for="review-limit"
          >{{ t('每日复习上限')
          }}<input
            v-ui-control
            id="review-limit"
            v-model.number="deckForm.reviewLimit"
            type="number"
            min="0"
            max="9999"
            required
        /></label>
      </div>
      <p class="form-note">
        {{ t('每日上限按本机日期重置。设为 0 则不安排该类卡片；学习和重学步骤不受此限制。') }}
      </p>
      <label class="check-line"
        ><input v-ui-control v-model="deckForm.burySiblings" type="checkbox" />{{
          t('评分后自动暂缓同笔记的其他卡片至明天')
        }}</label
      >
      <div class="limit-fields">
        <label for="leech-threshold"
          >{{ t('顽固卡遗忘阈值')
          }}<input
            v-ui-control
            id="leech-threshold"
            v-model.number="deckForm.leechThreshold"
            type="number"
            min="0"
            max="100"
            required
        /></label>
        <label for="retention"
          >{{ t('目标记忆保留率（%）')
          }}<input
            v-ui-control
            id="retention"
            v-model.number="retentionPercent"
            type="number"
            min="70"
            max="97"
            step="1"
            required
        /></label>
      </div>
      <p class="form-note">
        {{
          t(
            '复习时遗忘达到指定次数，会标记为顽固卡；设为 0 关闭。目标保留率默认 90%，越高则复习越频繁。修改仅影响后续评分。',
          )
        }}
      </p>
      <fieldset class="color-picker">
        <legend>{{ t('卡组颜色') }}</legend>
        <label
          v-for="color in colors"
          :key="color"
          :class="['color-option', color, { chosen: deckForm.color === color }]"
          ><input
            v-ui-control="{ swatch: true }"
            v-model="deckForm.color"
            type="radio"
            name="color"
            :value="color"
            :aria-label="
              {
                sage: t('鼠尾草绿'),
                sand: t('暖沙色'),
                lavender: t('薰衣草紫'),
                blue: t('雾蓝色'),
                rose: t('蔷薇粉'),
              }[color]
            " /><Check v-if="deckForm.color === color" :size="17"
        /></label>
      </fieldset>
      <div class="form-actions">
        <button
          v-ui-button="'secondary'"
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="modal = null"
        >
          {{ t('取消') }}</button
        ><button v-ui-button="'primary'" type="submit" class="button primary" :disabled="busy">
          {{ busy ? t('保存中…') : t('保存卡组') }}
        </button>
      </div>
    </form></AppModal
  >
  <AppModal
    :error="notice?.error ? t(notice.text) : undefined"
    v-if="modal === 'card'"
    wide
    :title="editingId ? t('编辑卡片') : t('添加卡片')"
    :busy="busy"
    @close="modal = null"
    ><NoteEditor
      :library="library"
      :note="editingNote"
      :initial="sourceDraft"
      :deck-id="selectedDeck || undefined"
      :busy="busy"
      :get-media="workspace.getMedia"
      :submit="saveCard"
      @close="modal = null"
  /></AppModal>
  <AppModal
    v-if="modal === 'bulkImport'"
    :key="workspace.scope.value"
    wide
    :title="t('批量导入笔记')"
    :busy="busy"
    :error="notice?.error ? t(notice.text) : undefined"
    @close="modal = null"
    ><ImportNotes
      :library="library"
      :deck-id="selectedDeck"
      :busy="busy"
      :import-anki="importAnki"
      :preview-anki="workspace.previewAnki"
      :get-media="workspace.getMedia"
      :workspace-scope="workspace.scope.value"
      @import="importNotes"
      @close="modal = null"
  /></AppModal>
  <AppModal
    :error="notice?.error ? t(notice.text) : undefined"
    v-if="modal === 'confirm' && confirmation"
    :title="t(confirmation.title)"
    :busy="busy"
    @close="modal = null"
    ><p class="confirmation-text">{{ t(confirmation.message) }}</p>
    <div class="form-actions">
      <button
        v-ui-button="'secondary'"
        class="button secondary"
        :disabled="busy"
        @click="modal = null"
      >
        {{ t('取消') }}</button
      ><button v-ui-button="'danger'" class="button danger" :disabled="busy" @click="confirmAction">
        {{ t('确认删除') }}
      </button>
    </div></AppModal
  >
</template>
