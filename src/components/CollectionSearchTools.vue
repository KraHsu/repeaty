<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { BookmarkPlus, BookOpen, ChevronDown, Play, X } from '@lucide/vue'
import { UiButton, UiIconButton, UiInput, UiSelect } from './ui'
import { t } from '../i18n'
import type { Library, SearchFilter } from '../core/model'

const props = defineProps<{
  savedSearches: Library['savedSearches']
  filter: SearchFilter
  deckName: string
  busy: boolean
  loading: boolean
  error: boolean
  eligible: number
  saveFilter: (update: boolean) => Promise<boolean>
  removeFilter: () => Promise<boolean>
}>()
const savedId = defineModel<string>('savedId', { required: true })
const savedName = defineModel<string>('savedName', { required: true })
const reschedule = defineModel<boolean>('reschedule', { required: true })
const studyLimit = defineModel<number>('studyLimit', { required: true })
const studyOpen = defineModel<boolean>('studyOpen', { required: true })
const emit = defineEmits<{ applySaved: []; study: [] }>()
const panel = ref<'' | 'save' | 'syntax' | 'study'>('')
const id = useId()
const pending = ref(false)
const validLimit = computed(
  () => Number.isInteger(studyLimit.value) && studyLimit.value >= 1 && studyLimit.value <= 500,
)
const plannedCount = computed(() => Math.min(props.eligible, studyLimit.value))
const canSave = computed(
  () => !props.busy && !pending.value && !props.error && !!savedName.value.trim(),
)
watch(panel, (value) => (studyOpen.value = value === 'study'), { flush: 'sync' })
function toggle(next: typeof panel.value) {
  panel.value = panel.value === next ? '' : next
}
async function closePanel() {
  const trigger = document.getElementById(`${id}-toggle-${panel.value}`)
  panel.value = ''
  await nextTick()
  trigger?.focus({ preventScroll: true })
}
async function save(update: boolean) {
  if (!canSave.value) return
  pending.value = true
  try {
    if ((await props.saveFilter(update)) && panel.value === 'save') await closePanel()
  } finally {
    pending.value = false
  }
}
async function remove() {
  if (props.busy || pending.value) return
  pending.value = true
  try {
    if ((await props.removeFilter()) && panel.value === 'save') await closePanel()
  } finally {
    pending.value = false
  }
}
const syntax = [
  { code: 'tag:英语', label: '指定标签' },
  { code: 'deck:"卡组名称"', label: '指定卡组' },
  { code: 'is:new / is:due / is:leech', label: '新卡、到期或顽固卡' },
  { code: 'type:basic / type:reversed / type:cloze', label: '正反面、双向或挖空' },
  { code: 'type:plugin / type:leetcode', label: '插件卡片或 LeetCode' },
  { code: 'due:<=7', label: '未来 7 天内到期（含逾期）' },
  { code: 'lapses:>=3', label: '遗忘至少 3 次' },
] as const
</script>

<template>
  <div class="collection-search-tools">
    <div class="search-tools-bar">
      <div class="search-tools-saved">
        <div class="search-saved-picker">
          <UiSelect
            v-model="savedId"
            class="w-full min-w-0"
            :disabled="pending"
            :items="[
              { label: t('常用筛选'), value: '' },
              ...savedSearches.map((saved) => ({ label: saved.name, value: saved.id })),
            ]"
            :aria-label="t('常用筛选')"
            @change="emit('applySaved')"
          />
        </div>
        <UiButton
          variant="ghost"
          :id="`${id}-toggle-save`"
          :aria-expanded="panel === 'save'"
          :aria-controls="`${id}-save`"
          @click="toggle('save')"
          ><BookmarkPlus :size="16" />{{ t('保存筛选') }}</UiButton
        >
      </div>
      <div class="search-tools-actions">
        <UiButton
          variant="ghost"
          :id="`${id}-toggle-syntax`"
          :aria-expanded="panel === 'syntax'"
          :aria-controls="`${id}-syntax`"
          @click="toggle('syntax')"
          ><BookOpen :size="16" />{{ t('搜索语法') }}</UiButton
        >
        <UiButton
          variant="secondary"
          :id="`${id}-toggle-study`"
          :aria-expanded="panel === 'study'"
          :aria-controls="`${id}-study`"
          @click="toggle('study')"
          ><Play :size="16" />{{ t('专项练习')
          }}<ChevronDown :size="16" :class="{ 'search-tools-chevron-open': panel === 'study' }"
        /></UiButton>
      </div>
    </div>

    <section
      v-if="panel"
      :id="`${id}-${panel}`"
      class="search-tools-panel"
      :aria-labelledby="`${id}-title`"
    >
      <div class="search-tools-heading">
        <h2 :id="`${id}-title`">
          {{ t(panel === 'save' ? '保存当前条件' : panel === 'syntax' ? '搜索语法' : '专项练习') }}
        </h2>
        <UiIconButton :label="t('收起搜索工具')" @click="closePanel"><X :size="18" /></UiIconButton>
      </div>

      <template v-if="panel === 'save'">
        <div class="search-filter-summary">
          <span
            >{{ deckName }} · {{ filter.state === 'all' ? t('全部状态') : t(filter.state) }}</span
          >
          <code v-if="filter.query" :title="filter.query">{{ filter.query }}</code>
          <span v-else>{{ t('未限制关键词') }}</span>
        </div>
        <form class="search-save-form" @submit.prevent="save(!!savedId)">
          <label class="search-save-name"
            >{{ t('筛选名称')
            }}<UiInput
              v-model="savedName"
              :disabled="pending"
              maxlength="80"
              required
              :placeholder="t('例如：英语易忘卡')"
          /></label>
          <div class="search-save-actions">
            <UiButton variant="primary" type="submit" :disabled="!canSave" :busy="pending">{{
              t(savedId ? '更新筛选' : '另存筛选')
            }}</UiButton>
            <UiButton
              v-if="savedId"
              variant="secondary"
              :disabled="!canSave"
              @click="save(false)"
              >{{ t('另存筛选') }}</UiButton
            >
            <UiButton
              v-if="savedId"
              variant="ghost"
              class="text-(--ui-error)"
              :disabled="busy || pending"
              @click="remove"
              >{{ t('删除筛选') }}</UiButton
            >
          </div>
        </form>
      </template>

      <template v-else-if="panel === 'syntax'">
        <p class="search-syntax-intro">
          {{ t('多个条件用空格连接；用双引号匹配短语，用减号排除条件。') }}
        </p>
        <dl class="search-syntax-list">
          <template v-for="entry in syntax" :key="entry.code"
            ><dt>
              <code>{{ t(entry.code) }}</code>
            </dt>
            <dd>{{ t(entry.label) }}</dd></template
          >
        </dl>
        <p class="search-tools-note">
          {{
            t('due 按距今天的日历天数计算，负数表示逾期。is:due 包含所有到期卡片，不考虑每日额度。')
          }}
        </p>
      </template>

      <template v-else>
        <p class="search-study-count" :aria-busy="loading">
          <template v-if="loading">{{ t('正在计算可练习卡片…') }}</template>
          <template v-else-if="error">{{ t('请先修正搜索条件。') }}</template>
          <template v-else
            ><strong>{{ t('可练习 {count} 张', { count: eligible }) }}</strong
            ><span>{{ t('已排除暂停和今日暂缓的卡片。') }}</span></template
          >
        </p>
        <form class="search-study-form" @submit.prevent="validLimit && emit('study')">
          <div class="search-study-mode">
            <label
              >{{ t('练习模式')
              }}<UiSelect
                v-model="reschedule"
                :aria-label="t('练习模式')"
                :items="[
                  { label: t('只练习，不改进度'), value: false },
                  { label: t('评分并更新进度'), value: true },
                ]"
            /></label>
            <p class="search-tools-note">
              {{
                reschedule
                  ? t('评分会更新复习时间并计入今日学习，不受每日上限限制。')
                  : t('评分仅用于本轮练习，不改变复习时间、每日用量或统计。')
              }}
            </p>
          </div>
          <label class="search-study-limit"
            >{{ t('卡片数量上限')
            }}<UiInput
              v-model.number="studyLimit"
              :aria-label="t('卡片数量上限')"
              type="number"
              min="1"
              max="500"
              step="1"
              required
            /><span class="search-tools-note">{{ t('1–500 张，每张练习一次') }}</span></label
          >
          <div class="search-study-start">
            <UiButton
              variant="primary"
              type="submit"
              :disabled="busy || loading || error || !eligible || !validLimit"
              ><Play :size="16" />{{ t('开始专项练习') }}</UiButton
            ><span v-if="!loading && !error && validLimit" class="search-tools-note">{{
              t('本轮 {count} 张', { count: plannedCount })
            }}</span>
          </div>
        </form>
      </template>
    </section>
  </div>
</template>

<style scoped>
.collection-search-tools {
  margin: 1rem 0;
  container-type: inline-size;
}
.search-tools-bar,
.search-tools-saved,
.search-tools-actions,
.search-tools-heading,
.search-save-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.search-tools-bar {
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
}
.search-tools-saved {
  flex: 1;
  min-width: 0;
}
.search-saved-picker {
  width: clamp(10rem, 20vw, 18rem);
  max-width: 100%;
}
.search-tools-actions {
  margin-left: auto;
}
.search-tools-bar :deep(.ui-button),
.search-save-actions :deep(.ui-button) {
  white-space: nowrap;
}
.search-tools-bar :deep([aria-expanded='true']) {
  background: var(--app-selected);
  color: var(--ui-text-highlighted);
}
.search-tools-chevron-open {
  transform: rotate(180deg);
}
.search-tools-actions svg {
  transition: transform 180ms ease;
}
.search-tools-panel {
  margin-top: 0.75rem;
  padding: 1.25rem 1.5rem 1.5rem;
  border: 1px solid var(--line);
  border-radius: var(--app-radius);
  background: var(--paper);
  min-width: 0;
}
.search-tools-heading {
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 1rem;
  margin-bottom: 1rem;
}
.search-tools-heading h2 {
  margin: 0;
  font-size: var(--font-size-body);
}
.search-tools-heading :deep(.ui-button) {
  margin: -0.5rem -0.5rem -0.5rem 0;
  flex-shrink: 0;
}
.search-filter-summary {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: var(--muted);
  margin-bottom: 1rem;
  font-size: var(--font-size-meta);
  min-width: 0;
}
.search-filter-summary code {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ui-text);
}
.search-save-form {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 1rem;
}
.search-save-name {
  flex: 1 1 16rem;
  max-width: 32rem;
  min-width: 0;
}
.search-tools-panel label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: var(--font-size-control);
}
.search-study-count {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 0 0 1.25rem;
}
.search-study-count strong {
  font-size: var(--font-size-section);
  font-weight: var(--font-weight-semibold);
}
.search-study-count > span {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.search-study-form {
  display: grid;
  grid-template-columns: minmax(12rem, 1fr) minmax(8rem, 11rem) auto;
  gap: 1.5rem;
  align-items: start;
}
.search-study-form > *,
.search-study-form label {
  min-width: 0;
}
.search-study-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding-top: 2rem;
}
.search-study-start :deep(.ui-button) {
  white-space: nowrap;
}
.search-tools-note {
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-ui);
  margin: 0.5rem 0 0;
}
.search-study-limit .search-tools-note,
.search-study-start .search-tools-note {
  margin: 0;
}
.search-syntax-intro {
  margin: 0 0 1rem;
}
.search-syntax-list {
  display: grid;
  grid-template-columns: minmax(12rem, auto) 1fr;
  gap: 0.75rem 2rem;
  margin: 0 0 1rem;
  font-size: var(--font-size-meta);
}
.search-syntax-list dt,
.search-syntax-list dd {
  margin: 0;
  min-width: 0;
}
.search-syntax-list code {
  overflow-wrap: anywhere;
}
.search-syntax-list dd {
  color: var(--muted);
}
@media (prefers-reduced-motion: no-preference) {
  .search-tools-bar {
    animation: search-tools-enter 220ms ease-out;
  }
  .search-tools-panel {
    animation: search-tools-enter 180ms ease-out;
  }
}
@keyframes search-tools-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@container (max-width: 40rem) {
  .search-study-form {
    grid-template-columns: minmax(0, 1fr) minmax(8rem, 11rem);
  }
  .search-study-start {
    grid-column: 1 / -1;
    padding-top: 0;
    align-items: flex-start;
  }
}
@container (max-width: 28rem) {
  .search-tools-saved {
    flex-basis: 100%;
  }
  .search-saved-picker {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .search-tools-actions {
    margin-left: 0;
  }
  .search-tools-panel {
    padding: 1rem;
  }
  .search-study-form,
  .search-syntax-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .search-study-form {
    gap: 1rem;
  }
  .search-syntax-list {
    gap: 0.25rem;
  }
  .search-syntax-list dd {
    margin-bottom: 0.75rem;
  }
  .search-study-start {
    align-items: stretch;
  }
  .search-save-name {
    max-width: none;
  }
}
</style>
