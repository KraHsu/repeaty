<script setup lang="ts">
import { vUiControl, vUiButton } from './ui'
import { computed, ref } from 'vue'
import { t, locale } from '../i18n'
import type { SourceBatchAction, SourcePriority } from '../core/source-data'
import { nextReadingDay } from '../core/source-queue'
import AppModal from './AppModal.vue'

const props = defineProps<{
  titles: string[]
  now: Date
  busy: boolean
  error?: string
  save: (action: SourceBatchAction) => Promise<void>
}>()
const emit = defineEmits<{ close: [] }>()
const operation = ref<SourceBatchAction['type']>('priority')
const priority = ref<SourcePriority>('normal')
const date = ref(nextReadingDay(props.now))
const options = computed(() => [
  { label: '明天', days: 1 },
  { label: '3 天后', days: 3 },
  { label: '1 周后', days: 7 },
])
function submit() {
  if (props.busy) return
  const action: SourceBatchAction =
    operation.value === 'priority'
      ? { type: 'priority', priority: priority.value }
      : operation.value === 'defer'
        ? { type: 'defer', date: date.value }
        : { type: operation.value }
  return props.save(action)
}
</script>

<template>
  <AppModal :title="t('批量安排')" :busy="busy" :error="error" @close="emit('close')">
    <form class="source-batch-form" @submit.prevent="submit">
      <p class="source-batch-summary">
        {{ t('将更改所选的 {count} 篇材料。', { count: titles.length }) }}
      </p>
      <ul class="source-batch-titles">
        <li v-for="(title, index) in titles.slice(0, 5)" :key="index">{{ title }}</li>
      </ul>
      <p v-if="titles.length > 5" class="form-note">
        {{ t('以及另外 {count} 篇。', { count: titles.length - 5 }) }}
      </p>
      <label for="source-batch-action">{{ t('批量操作') }}</label>
      <select v-ui-control id="source-batch-action" v-model="operation" :disabled="busy">
        <option value="priority">{{ t('设置优先级') }}</option>
        <option value="defer">{{ t('稍后阅读') }}</option>
        <option value="archive">{{ t('归档材料') }}</option>
        <option value="restore">{{ t('加入待阅读') }}</option>
      </select>
      <template v-if="operation === 'priority'">
        <label for="source-batch-priority">{{ t('阅读优先级') }}</label>
        <select v-ui-control id="source-batch-priority" v-model="priority" :disabled="busy">
          <option value="high">{{ t('高') }}</option>
          <option value="normal">{{ t('普通') }}</option>
          <option value="low">{{ t('低') }}</option>
        </select>
      </template>
      <template v-if="operation === 'defer'">
        <div class="source-batch-dates" :aria-label="t('快捷安排')">
          <button
            v-ui-button
            v-for="option in options"
            :key="option.days"
            type="button"
            class="button secondary"
            :disabled="busy"
            :aria-pressed="date === nextReadingDay(now, option.days)"
            @click="date = nextReadingDay(now, option.days)"
          >
            {{ t(option.label) }}
          </button>
        </div>
        <label for="source-batch-date">{{ t('下次阅读日期') }}</label>
        <input
          v-ui-control
          id="source-batch-date"
          v-model="date"
          type="date"
          required
          :min="nextReadingDay(now)"
          max="9999-12-31"
          :disabled="busy"
          :lang="locale"
        />
      </template>
      <p class="form-note">{{ t('整批保存后可撤销。卡片和复习进度保持不变。') }}</p>
      <div class="form-actions">
        <button
          v-ui-button
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="emit('close')"
        >
          {{ t('取消') }}
        </button>
        <button v-ui-button="'primary'" type="submit" class="button primary" :disabled="busy">
          {{ t('确认批量安排') }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.source-batch-form {
  display: grid;
  gap: 1rem;
  padding: 1.25rem 1.75rem;
  overflow-y: auto;
}
.source-batch-form p {
  margin: 0;
}
.source-batch-summary {
  font-weight: var(--font-weight-semibold);
}
.source-batch-titles {
  margin: 0;
  padding-left: 1.25rem;
  overflow-wrap: anywhere;
  line-height: var(--line-height-ui);
}
.source-batch-dates {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
@media (max-width: 720px) {
  .source-batch-form {
    padding: 1.1rem;
  }
}
</style>
