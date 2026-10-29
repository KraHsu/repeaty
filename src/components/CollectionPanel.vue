<script setup lang="ts">
import { UiInput, UiSelect, UiButton, UiIconButton, UiCheckbox, UiCollapsible } from './ui'
import USeparator from '@nuxt/ui/components/Separator.vue'
import { t, locale } from '../i18n'

import { computed, ref, shallowRef, watch } from 'vue'
import { History, Layers, Pause, Pencil, Play, Plus, Repeat2, Trash2 } from '@lucide/vue'
import CardSearchInput from './CardSearchInput.vue'
import CollectionSearchTools from './CollectionSearchTools.vue'
import {
  cardViews,
  filterStates,
  noteTypes,
  type CardView,
  type Library,
  type SearchFilter,
  type StudySession,
} from '../core/model'
import { type CardAction } from '../core/scheduler'
import { cardStatus } from '../core/search'
import type { CardPage } from '../core/storage'
import type { BatchEdit } from '../core/batch'
const props = defineProps<{
  queryCards: (
    filter: SearchFilter,
    page: number,
    now: Date,
    study: boolean,
    signal?: AbortSignal,
  ) => Promise<CardPage>
  library: Library
  now: Date
  busy: boolean
  change: (ids: string[], action: CardAction) => Promise<boolean>
  batchEdit: (ids: string[], edit: BatchEdit) => Promise<boolean>
  saveSearch: (filter: SearchFilter, name: string, id?: string) => Promise<boolean>
  deleteSearch: (id: string) => Promise<boolean>
}>()
const deckId = defineModel<string>('deckId', { default: '' })
const emit = defineEmits<{
  edit: [card?: CardView]
  delete: [noteIds: string[]]
  review: []
  study: [session: StudySession]
  history: [card: CardView]
}>()
const query = defineModel<string>('query', { default: '' })
const state = defineModel<SearchFilter['state']>('state', { default: 'all' })
const selected = ref<string[]>([]),
  page = ref(1)
const targetDeck = ref(''),
  addTags = ref(''),
  removeTags = ref('')
const cards = computed(() => cardViews(props.library))
const historyCardIds = computed(() => new Set(props.library.practices.map((entry) => entry.cardId)))
const filter = computed<SearchFilter>(() => ({
  query: query.value,
  state: state.value,
  deckId: deckId.value,
}))
const result = shallowRef<CardPage & { error: string | Error }>({
  cards: [],
  total: 0,
  eligible: 0,
  studyIds: [],
  error: '',
})
const loading = ref(false)
const expanded = ref(false)
watch(
  [filter, page, expanded, () => props.library, () => props.now],
  async (_value, _old, onCleanup) => {
    let active = true
    const controller = new AbortController()
    onCleanup(() => {
      active = false
      controller.abort()
    })
    loading.value = true
    try {
      const data = await props.queryCards(
        filter.value,
        page.value,
        props.now,
        expanded.value,
        controller.signal,
      )
      if (active) {
        result.value = { ...data, error: '' }
        page.value = Math.min(page.value, Math.max(1, Math.ceil(data.total / 50)))
      }
    } catch (error) {
      if (active)
        result.value = { cards: [], total: 0, eligible: 0, studyIds: [], error: error as Error }
    } finally {
      if (active) loading.value = false
    }
  },
  { immediate: true },
)
const savedId = ref(''),
  savedName = ref(''),
  reschedule = ref(false),
  studyLimit = ref(50)
function applySaved() {
  const saved = props.library.savedSearches.find((entry) => entry.id === savedId.value)
  if (!saved) {
    savedName.value = ''
    return
  }
  query.value = saved.query
  state.value = saved.state
  deckId.value = saved.deckId
  savedName.value = saved.name
}
async function saveFilter(update = false) {
  if (await props.saveSearch(filter.value, savedName.value, update ? savedId.value : undefined)) {
    if (!update) savedId.value = props.library.savedSearches.at(-1)?.id ?? ''
    return true
  }
  return false
}
async function removeFilter() {
  if (await props.deleteSearch(savedId.value)) {
    savedId.value = ''
    savedName.value = ''
    return true
  }
  return false
}
function startStudy() {
  if (
    props.busy ||
    loading.value ||
    result.value.error ||
    !Number.isInteger(studyLimit.value) ||
    studyLimit.value < 1 ||
    studyLimit.value > 500
  )
    return
  const ids = result.value.studyIds.slice(0, studyLimit.value)
  if (ids.length) emit('study', { ids, reschedule: reschedule.value })
}
const pages = computed(() => Math.max(1, Math.ceil(result.value.total / 50)))
const visible = computed(() => result.value.cards)
const selectedNotes = computed(() => [
  ...new Set(
    cards.value.filter((card) => selected.value.includes(card.id)).map((card) => card.noteId),
  ),
])
const allSelected = computed(
  () => visible.value.length > 0 && visible.value.every((card) => selected.value.includes(card.id)),
)
watch([query, state, deckId], () => {
  selected.value = []
  page.value = 1
})
watch(
  () => props.library,
  () => {
    selected.value = selected.value.filter((id) => cards.value.some((card) => card.id === id))
  },
)
function selectPage() {
  const ids = new Set(selected.value)
  for (const card of visible.value) {
    if (allSelected.value) ids.delete(card.id)
    else ids.add(card.id)
  }
  selected.value = [...ids]
}
async function change(action: CardAction, ids = selected.value) {
  await props.change(ids, action)
}
function split(text: string) {
  return [
    ...new Set(
      text
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ]
}
async function editSelected() {
  if (
    await props.batchEdit(selectedNotes.value, {
      deckId: targetDeck.value || undefined,
      addTags: split(addTags.value),
      removeTags: split(removeTags.value),
    })
  ) {
    targetDeck.value = ''
    addTags.value = ''
    removeTags.value = ''
  }
}
</script>
<template>
  <div class="library-toolbar">
    <CardSearchInput v-model="query" :library="library" />
    <UiSelect
      class="library-filter w-auto min-w-0"
      :items="[
        { label: t('全部卡组'), value: '' },
        ...library.decks.map((deck) => ({ label: deck.name, value: deck.id })),
      ]"
      v-model="deckId"
      :aria-label="t('筛选卡组')"
    ></UiSelect>
    <UiSelect
      class="library-filter w-auto min-w-0"
      :items="[
        { label: t('全部状态'), value: 'all' },
        ...filterStates
          .filter((entry) => entry !== 'all')
          .map((label) => ({ label: t(label), value: label })),
      ]"
      v-model="state"
      :aria-label="t('筛选状态')"
    ></UiSelect>
    <UiButton
      variant="secondary"
      type="button"
      class="library-review shrink-0 whitespace-nowrap"
      @click="emit('review')"
    >
      <Repeat2 :size="16" />{{ t('复习') }}
    </UiButton>
  </div>
  <p v-if="result.error" class="import-warning" role="alert">{{ t(result.error) }}</p>
  <CollectionSearchTools
    v-model:saved-id="savedId"
    v-model:saved-name="savedName"
    v-model:reschedule="reschedule"
    v-model:study-limit="studyLimit"
    v-model:study-open="expanded"
    :saved-searches="library.savedSearches"
    :filter="filter"
    :deck-name="library.decks.find((deck) => deck.id === deckId)?.name ?? t('全部卡组')"
    :busy="busy"
    :loading="loading"
    :error="!!result.error"
    :eligible="result.eligible"
    :save-filter="saveFilter"
    :remove-filter="removeFilter"
    @apply-saved="applySaved"
    @study="startStudy"
  />
  <div class="library-count" :aria-busy="loading">
    {{ t('{p0} 张卡片 · 全库 {p1} 条笔记', { p0: result.total, p1: library.notes.length }) }}
  </div>
  <section v-if="selected.length" class="batch-panel">
    <strong>{{
      t('已选 {p0} 张卡片（{p1} 条笔记）', { p0: selected.length, p1: selectedNotes.length })
    }}</strong>
    <div class="batch-actions">
      <UiButton
        variant="secondary"
        type="submit"
        v-for="(label, action) in {
          suspend: '暂停所选',
          resume: '恢复所选',
          bury: '今天暂缓',
          unbury: '取消暂缓',
          clearLeech: '清除顽固标记',
        }"
        :key="action"
        :disabled="busy"
        @click="change(action)"
      >
        {{ t(label) }}</UiButton
      ><UiButton
        variant="danger"
        type="submit"
        :disabled="busy"
        @click="emit('delete', selectedNotes)"
      >
        {{ t('删除所选笔记') }}
      </UiButton>
    </div>
    <UiCollapsible :unmount-on-hide="false">
      <template #default="{ open }"
        ><UiButton type="button" variant="ghost" :aria-expanded="open">{{
          t('批量修改笔记的卡组与标签')
        }}</UiButton></template
      ><template #content>
        <p class="form-note">
          {{ t('同一笔记的所有关联卡片都会更新，复习进度保留。暂停和暂缓仅影响勾选的卡片。') }}
        </p>
        <div class="batch-fields">
          <label
            >{{ t('移动到卡组')
            }}<UiSelect
              :items="[
                { label: t('保持原卡组'), value: '' },
                ...library.decks.map((deck) => ({ label: deck.name, value: deck.id })),
              ]"
              v-model="targetDeck"
            ></UiSelect></label
          ><label
            >{{ t('添加标签')
            }}<UiInput v-model="addTags" maxlength="820" :placeholder="t('逗号分隔')" /></label
          ><label
            >{{ t('移除标签')
            }}<UiInput v-model="removeTags" maxlength="820" :placeholder="t('逗号分隔')"
          /></label>
        </div>
        <UiButton
          variant="primary"
          type="submit"
          :disabled="busy || (!targetDeck && !addTags.trim() && !removeTags.trim())"
          @click="editSelected"
        >
          {{ t('应用笔记修改') }}
        </UiButton>
      </template></UiCollapsible
    >
  </section>
  <div v-if="result.total" class="card-table-wrap">
    <table class="card-table expanded-table">
      <thead>
        <tr>
          <th class="select-column">
            <UiCheckbox
              :model-value="allSelected"
              :aria-label="t('选择本页卡片')"
              @update:model-value="selectPage"
            />
          </th>
          <th>{{ t('问题 / 答案') }}</th>
          <th>{{ t('卡组') }}</th>
          <th>{{ t('状态') }}</th>
          <th>{{ t('操作') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="card in visible" :key="card.id">
          <td>
            <UiCheckbox
              :model-value="selected.includes(card.id)"
              @update:model-value="
                (checked) => {
                  selected =
                    checked === true
                      ? [...selected, card.id]
                      : selected.filter((value) => value !== card.id)
                }
              "
              :value="card.id"
              :aria-label="t('选择卡片 {p0}', { p0: card.front })"
            />
          </td>
          <td>
            <div class="card-row-content">
              <UiButton
                variant="ghost"
                type="button"
                class="card-row-title line-clamp-2 w-full whitespace-normal px-0 text-left"
                @click="emit('edit', card)"
              >
                {{ card.front }}
              </UiButton>
              <USeparator />
              <p class="card-row-answer">{{ card.back }}</p>
            </div>
          </td>
          <td class="card-row-deck">
            <div class="card-row-deck-name">
              {{ library.decks.find((deck) => deck.id === card.deckId)?.name }}
            </div>
            <div class="tag-list">
              <span class="tag">
                {{
                  card.type === 'cloze'
                    ? t('挖空 {number}', { number: Number(card.variant.slice(6)) })
                    : card.type === 'plugin'
                      ? card.plugin?.id === 'leetcode'
                        ? 'LeetCode'
                        : card.plugin?.id
                      : t(noteTypes[card.type])
                }}
                <template v-if="card.type === 'reversed'">
                  · {{ t(card.variant === 'reverse' ? '背面 → 正面' : '正面 → 背面') }}
                </template></span
              ><span v-if="card.frontMedia.length + card.backMedia.length" class="tag">{{
                t('{p0} 个媒体', { p0: card.frontMedia.length + card.backMedia.length })
              }}</span
              ><span v-for="tag in card.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </td>
          <td>
            <span :class="['status-chip', { fresh: card.schedule.state === 0 }]">{{
              t(cardStatus(card, now))
            }}</span
            ><small v-if="card.schedule.state !== 0" class="due-date">{{
              new Date(card.schedule.due).toLocaleString(locale, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            }}</small>
            <span v-if="card.leech" class="status-chip leech">{{ t('顽固卡') }}</span>
            <small class="due-date">{{
              t('正式遗忘 {p0} 次', { p0: card.schedule.lapses })
            }}</small>
          </td>
          <td>
            <div class="row-actions">
              <UiIconButton
                v-if="historyCardIds.has(card.id)"
                :label="t('查看 {title} 的练习历史', { title: card.front })"
                @click="emit('history', card)"
              >
                <History :size="16" />
              </UiIconButton>
              <UiIconButton
                :label="t('编辑卡片 {p0}', { p0: card.front })"
                @click="emit('edit', card)"
              >
                <Pencil :size="16" />
              </UiIconButton>
              <UiIconButton
                :label="card.suspended ? t('恢复') : t('暂停')"
                :disabled="busy"
                @click="change(card.suspended ? 'resume' : 'suspend', [card.id])"
              >
                <Play v-if="card.suspended" :size="16" />
                <Pause v-else :size="16" />
              </UiIconButton>
              <UiIconButton
                class="danger-text"
                :label="t('删除卡片 {p0}', { p0: card.front })"
                @click="emit('delete', [card.noteId])"
              >
                <Trash2 :size="16" />
              </UiIconButton>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-else class="empty-state">
    <Layers :size="36" />
    <h2>{{ query || state !== 'all' ? t('没有匹配的卡片') : t('暂无卡片') }}</h2>
    <p>
      {{
        query || state !== 'all'
          ? t('更换关键词或调整筛选条件。')
          : t('点击「添加卡片」，或从 CSV / TSV 文件导入。')
      }}
    </p>
    <UiButton
      variant="primary"
      type="submit"
      v-if="!query && state === 'all'"
      @click="emit('edit')"
    >
      <Plus :size="16" />{{ t('添加卡片') }}
    </UiButton>
  </div>
  <div v-if="pages > 1" class="pagination">
    <UiButton variant="secondary" type="submit" :disabled="page === 1" @click="page--">
      {{ t('上一页') }}</UiButton
    ><span>{{ page }} / {{ pages }}</span
    ><UiButton variant="secondary" type="submit" :disabled="page === pages" @click="page++">
      {{ t('下一页') }}
    </UiButton>
  </div>
</template>
