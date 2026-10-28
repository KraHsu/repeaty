<script setup lang="ts">
import { UiInput, UiTextarea, UiCheckbox, UiButton } from '../../components/ui'
import URadioGroup from '@nuxt/ui/components/RadioGroup.vue'
import { t } from '../../i18n'
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
      ><UiInput
        id="deck-name"
        v-model.trim="deckForm.name"
        autofocus
        required
        maxlength="80"
        :placeholder="t('例如：英语词汇、计算机基础…')"
      /><label for="deck-description"
        >{{ t('描述') }}<span class="optional">{{ t('可选') }}</span></label
      ><UiTextarea
        id="deck-description"
        v-model.trim="deckForm.description"
        maxlength="300"
        rows="3"
        :placeholder="t('卡组内容或用途')"
      />
      <div class="limit-fields">
        <label for="new-limit"
          >{{ t('每日新卡上限')
          }}<UiInput
            id="new-limit"
            v-model.number="deckForm.newLimit"
            type="number"
            min="0"
            max="9999"
            required /></label
        ><label for="review-limit"
          >{{ t('每日复习上限')
          }}<UiInput
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
        ><UiCheckbox v-model="deckForm.burySiblings" />{{
          t('评分后自动暂缓同笔记的其他卡片至明天')
        }}</label
      >
      <div class="limit-fields">
        <label for="leech-threshold"
          >{{ t('顽固卡遗忘阈值')
          }}<UiInput
            id="leech-threshold"
            v-model.number="deckForm.leechThreshold"
            type="number"
            min="0"
            max="100"
            required
        /></label>
        <label for="retention"
          >{{ t('目标记忆保留率（%）')
          }}<UiInput
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
      <URadioGroup
        v-model="deckForm.color"
        :legend="t('卡组颜色')"
        name="color"
        orientation="horizontal"
        :disabled="busy"
        :items="
          colors.map((value) => ({
            value,
            label: {
              sage: t('鼠尾草绿'),
              sand: t('暖沙色'),
              lavender: t('薰衣草紫'),
              blue: t('雾蓝色'),
              rose: t('蔷薇粉'),
            }[value],
          }))
        "
      >
        <template #label="{ item }">
          <span class="inline-flex items-center gap-2">
            <span :class="['inline-block size-3 rounded-full', item.value]" aria-hidden="true" />
            {{ item.label }}
          </span>
        </template>
      </URadioGroup>
      <div class="form-actions">
        <UiButton variant="secondary" type="button" :disabled="busy" @click="modal = null">
          {{ t('取消') }}</UiButton
        ><UiButton variant="primary" type="submit" :disabled="busy">
          {{ busy ? t('保存中…') : t('保存卡组') }}
        </UiButton>
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
      <UiButton variant="secondary" type="submit" :disabled="busy" @click="modal = null">
        {{ t('取消') }}</UiButton
      ><UiButton variant="danger" type="submit" :disabled="busy" @click="confirmAction">
        {{ t('确认删除') }}
      </UiButton>
    </div></AppModal
  >
</template>
