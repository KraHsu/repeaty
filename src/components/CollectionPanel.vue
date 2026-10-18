<script setup lang="ts">
import { t, locale } from '../i18n'

import { computed, ref, shallowRef, watch } from 'vue'
import { Layers, Pencil, Plus, Repeat2, Search, Trash2 } from '@lucide/vue'
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
}>()
const query = defineModel<string>('query', { default: '' })
const state = defineModel<SearchFilter['state']>('state', { default: 'all' })
const selected = ref<string[]>([]),
  page = ref(1)
const targetDeck = ref(''),
  addTags = ref(''),
  removeTags = ref('')
const cards = computed(() => cardViews(props.library))
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
  if (!saved) return
  query.value = saved.query
  state.value = saved.state
  deckId.value = saved.deckId
  savedName.value = saved.name
}
async function saveFilter(update = false) {
  if (await props.saveSearch(filter.value, savedName.value, update ? savedId.value : undefined)) {
    if (!update) savedId.value = props.library.savedSearches.at(-1)?.id ?? ''
  }
}
async function removeFilter() {
  if (await props.deleteSearch(savedId.value)) {
    savedId.value = ''
    savedName.value = ''
  }
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
    <label class="search-field"
      ><Search :size="18" /><input
        v-model="query"
        :aria-label="t('搜索卡片')"
        maxlength="1000"
        :placeholder="t('关键词、tag:英语、is:due、lapses:>=3…')"
    /></label>
    <select v-model="deckId" :aria-label="t('筛选卡组')">
      <option value="">{{ t('全部卡组') }}</option>
      <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">{{ deck.name }}</option>
    </select>
    <select v-model="state" :aria-label="t('筛选状态')">
      <option value="all">{{ t('全部状态') }}</option>
      <option
        v-for="label in filterStates.filter((entry) => entry !== 'all')"
        :key="label"
        :value="label"
      >
        {{ t(label) }}
      </option>
    </select>
    <button class="button secondary" @click="emit('review')">
      <Repeat2 :size="16" />{{ t('复习') }}
    </button>
  </div>
  <p v-if="result.error" class="import-warning" role="alert">{{ t(result.error) }}</p>
  <details class="search-options" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
    <summary>{{ t('高级搜索、常用筛选与专项练习') }}</summary>
    <p class="form-note">
      {{ t('空格连接的条件需同时满足；双引号包围短语，减号排除条件。例如')
      }}<code>{{ t('tag:英语 -is:suspended lapses:>=3') }}</code
      >{{
        t(
          '。支持 deck:"卡组名称"、type:cloze、is:leech、due:<=7（距今天的日历天数，负数表示逾期）。is:due 包含所有已到期卡片，不考虑额度。',
        )
      }}
    </p>
    <div class="batch-fields">
      <label
        >{{ t('常用筛选')
        }}<select v-model="savedId" :aria-label="t('常用筛选')" @change="applySaved">
          <option value="">{{ t('选择已保存筛选') }}</option>
          <option v-for="saved in library.savedSearches" :key="saved.id" :value="saved.id">
            {{ saved.name }}
          </option>
        </select></label
      >
      <label
        >{{ t('筛选名称')
        }}<input v-model="savedName" maxlength="80" :placeholder="t('例如：英语易忘卡')"
      /></label>
    </div>
    <div class="batch-actions">
      <button
        class="button secondary"
        :disabled="busy || !!result.error || !savedName.trim()"
        @click="saveFilter()"
      >
        {{ t('另存筛选') }}
      </button>
      <button
        v-if="savedId"
        class="button secondary"
        :disabled="busy || !!result.error || !savedName.trim()"
        @click="saveFilter(true)"
      >
        {{ t('更新筛选') }}
      </button>
      <button v-if="savedId" class="text-button danger-text" :disabled="busy" @click="removeFilter">
        {{ t('删除筛选') }}
      </button>
    </div>
    <form class="study-form" @submit.prevent="startStudy">
      <label
        >{{ t('练习模式')
        }}<select v-model="reschedule">
          <option :value="false">{{ t('只练习，不改进度') }}</option>
          <option :value="true">{{ t('评分并更新进度') }}</option>
        </select></label
      >
      <label
        >{{ t('卡片数量上限')
        }}<input v-model.number="studyLimit" type="number" min="1" max="500" step="1" required
      /></label>
      <button
        class="button primary"
        :disabled="busy || loading || !!result.error || !result.eligible"
      >
        {{ t('开始专项练习') }}
      </button>
    </form>
    <p class="form-note">
      {{
        t('可练习 {p0} 张，已排除暂停和今日暂缓的卡片。每张卡片练习一次。{p1}', {
          p0: result.eligible,
          p1: reschedule
            ? t('包含未到期卡片，不受每日上限限制。评分会更新下次复习时间，并计入今日学习。')
            : t('评分仅用于本轮练习，不改变到期时间、每日用量或统计。'),
        })
      }}
    </p>
  </details>
  <div class="library-count" :aria-busy="loading">
    {{ t('{p0} 张卡片 · {p1} 条笔记', { p0: result.total, p1: library.notes.length }) }}
  </div>
  <section v-if="selected.length" class="batch-panel">
    <strong>{{
      t('已选 {p0} 张卡片（{p1} 条笔记）', { p0: selected.length, p1: selectedNotes.length })
    }}</strong>
    <div class="batch-actions">
      <button
        v-for="(label, action) in {
          suspend: '暂停所选',
          resume: '恢复所选',
          bury: '今天暂缓',
          unbury: '取消暂缓',
          clearLeech: '清除顽固标记',
        }"
        :key="action"
        class="button secondary"
        :disabled="busy"
        @click="change(action)"
      >
        {{ t(label) }}</button
      ><button class="button danger" :disabled="busy" @click="emit('delete', selectedNotes)">
        {{ t('删除所选笔记') }}
      </button>
    </div>
    <details>
      <summary>{{ t('批量修改笔记的卡组与标签') }}</summary>
      <p class="form-note">
        {{ t('同一笔记的所有关联卡片都会更新，复习进度保留。暂停和暂缓仅影响勾选的卡片。') }}
      </p>
      <div class="batch-fields">
        <label
          >{{ t('移动到卡组')
          }}<select v-model="targetDeck">
            <option value="">{{ t('保持原卡组') }}</option>
            <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">
              {{ deck.name }}
            </option>
          </select></label
        ><label
          >{{ t('添加标签')
          }}<input v-model="addTags" maxlength="820" :placeholder="t('逗号分隔')" /></label
        ><label
          >{{ t('移除标签')
          }}<input v-model="removeTags" maxlength="820" :placeholder="t('逗号分隔')"
        /></label>
      </div>
      <button
        class="button primary"
        :disabled="busy || (!targetDeck && !addTags.trim() && !removeTags.trim())"
        @click="editSelected"
      >
        {{ t('应用笔记修改') }}
      </button>
    </details>
  </section>
  <div v-if="result.total" class="card-table-wrap">
    <table class="card-table expanded-table">
      <thead>
        <tr>
          <th class="select-column">
            <input
              type="checkbox"
              :checked="allSelected"
              :aria-label="t('选择本页卡片')"
              @change="selectPage"
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
            <input
              v-model="selected"
              type="checkbox"
              :value="card.id"
              :aria-label="t('选择卡片 {p0}', { p0: card.front })"
            />
          </td>
          <td>
            <button class="card-row-title" @click="emit('edit', card)">{{ card.front }}</button>
            <p>{{ card.back }}</p>
            <div class="tag-list">
              <span class="tag">{{ t(noteTypes[card.type]) }} · {{ card.variant }}</span
              ><span v-if="card.frontMedia.length + card.backMedia.length" class="tag">{{
                t('{p0} 个媒体', { p0: card.frontMedia.length + card.backMedia.length })
              }}</span
              ><span v-for="tag in card.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </td>
          <td>{{ library.decks.find((deck) => deck.id === card.deckId)?.name }}</td>
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
              <button
                class="icon-button"
                :aria-label="t('编辑卡片 {p0}', { p0: card.front })"
                @click="emit('edit', card)"
              >
                <Pencil :size="16" /></button
              ><button
                class="icon-button danger-text"
                :aria-label="t('删除卡片 {p0}', { p0: card.front })"
                @click="emit('delete', [card.noteId])"
              >
                <Trash2 :size="16" />
              </button>
            </div>
            <button
              class="text-button"
              :disabled="busy"
              @click="change(card.suspended ? 'resume' : 'suspend', [card.id])"
            >
              {{ card.suspended ? t('恢复') : t('暂停') }}
            </button>
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
    <button v-if="!query && state === 'all'" class="button primary" @click="emit('edit')">
      <Plus :size="16" />{{ t('添加卡片') }}
    </button>
  </div>
  <div v-if="pages > 1" class="pagination">
    <button class="button secondary" :disabled="page === 1" @click="page--">
      {{ t('上一页') }}</button
    ><span>{{ page }} / {{ pages }}</span
    ><button class="button secondary" :disabled="page === pages" @click="page++">
      {{ t('下一页') }}
    </button>
  </div>
</template>
