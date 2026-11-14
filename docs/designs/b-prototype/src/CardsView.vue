<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Search, Pencil, Pause, Play, Trash2, X, Layers, CircleHelp } from '@lucide/vue'
import { demo, commit, navigate, setNavigationGuard } from './state.js'

const search = ref('')
const deckFilter = computed({
  get: () => demo.cardsDeckFilter || 'all',
  set: (value) => {
    demo.cardsDeckFilter = value
  },
})
const statusFilter = ref('all')
const deckOptions = computed(() => [
  { label: '全部卡组', value: 'all' },
  ...demo.data.decks.map((deck) => ({ label: deck.name, value: deck.id })),
])
const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '待复习', value: 'due' },
  { label: '新卡片', value: 'new' },
  { label: '已复习', value: 'learned' },
  { label: '已暂停', value: 'paused' },
]
const statusNames = { due: '待复习', new: '新卡片', learned: '已复习', paused: '已暂停' }
const visibleCards = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return demo.data.cards.filter((card) => {
    const matchesText =
      !term ||
      [card.question, card.answer, ...card.tags].join(' ').toLocaleLowerCase().includes(term)
    return (
      matchesText &&
      (deckFilter.value === 'all' || card.deckId === deckFilter.value) &&
      (statusFilter.value === 'all' || card.status === statusFilter.value)
    )
  })
})
const hasFilters = computed(
  () => search.value || deckFilter.value !== 'all' || statusFilter.value !== 'all',
)
const deckName = (id) => demo.data.decks.find((deck) => deck.id === id)?.name || '未命名卡组'
const editing = ref(false)
const editingId = ref(null)
const draft = ref({ question: '', answer: '', tags: '' })
const validation = ref('')
const editSaveError = ref('')
const deleting = ref(false)
const pendingDelete = ref(null)
const deleteSaveError = ref('')
const originalDraft = ref('')
const discardOpen = ref(false)
let pendingNavigation = { view: 'home', options: {} }
let removeNavigationGuard = () => {}

function resetFilters() {
  search.value = ''
  deckFilter.value = 'all'
  statusFilter.value = 'all'
}

function editCard(card) {
  editingId.value = card.id
  draft.value = { question: card.question, answer: card.answer, tags: card.tags.join('，') }
  originalDraft.value = JSON.stringify(draft.value)
  validation.value = ''
  editSaveError.value = ''
  editing.value = true
}

function saveCard() {
  if (!draft.value.question.trim() || !draft.value.answer.trim()) {
    validation.value = '请填写问题和答案。'
    return
  }
  validation.value = ''
  const saved = commit((data) => {
    const card = data.cards.find((item) => item.id === editingId.value)
    if (!card) throw new Error('这张卡片已不存在，请关闭弹窗后重新选择。')
    card.question = draft.value.question.trim()
    card.answer = draft.value.answer.trim()
    card.tags = [
      ...new Set(
        draft.value.tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ]
  }, '卡片已保存')
  if (saved) editing.value = false
  else editSaveError.value = demo.saveError || '保存失败，草稿仍保留在这里，请重试。'
}

function changeAvailability(card) {
  const paused = card.status === 'paused'
  commit(
    (data) => {
      const target = data.cards.find((item) => item.id === card.id)
      const deck = data.decks.find((item) => item.id === card.deckId)
      if (!target) return
      const nextStatus = paused
        ? ['due', 'new', 'learned'].includes(target.previousStatus)
          ? target.previousStatus
          : 'due'
        : 'paused'
      if (deck) {
        if (target.status === 'due') deck.due = Math.max(0, deck.due - 1)
        if (target.status === 'new') deck.fresh = Math.max(0, deck.fresh - 1)
        if (nextStatus === 'due') deck.due += 1
        if (nextStatus === 'new') deck.fresh += 1
      }
      if (!paused) target.previousStatus = target.status
      target.status = nextStatus
    },
    paused ? '卡片已恢复' : '卡片已暂停',
  )
}

function confirmDelete(card) {
  pendingDelete.value = card
  deleteSaveError.value = ''
  deleting.value = true
}

function deleteCard() {
  const saved = commit((data) => {
    const index = data.cards.findIndex((item) => item.id === pendingDelete.value?.id)
    if (index < 0) throw new Error('这张卡片已不存在，请关闭弹窗后重新选择。')
    const [card] = data.cards.splice(index, 1)
    const deck = data.decks.find((item) => item.id === card.deckId)
    if (deck) {
      deck.count = Math.max(0, deck.count - 1)
      if (card.status === 'due') deck.due = Math.max(0, deck.due - 1)
      if (card.status === 'new') deck.fresh = Math.max(0, deck.fresh - 1)
    }
  }, '卡片已删除')
  if (saved) deleting.value = false
  else deleteSaveError.value = demo.saveError || '删除失败，卡片仍然保留，请重试。'
}

function leaveWithoutSaving() {
  removeNavigationGuard()
  navigate(pendingNavigation.view, pendingNavigation.options)
}

onMounted(() => {
  removeNavigationGuard = setNavigationGuard((view, options) => {
    if (view === 'cards' || !editing.value || JSON.stringify(draft.value) === originalDraft.value)
      return true
    pendingNavigation = { view, options }
    discardOpen.value = true
    return false
  })
})
onBeforeUnmount(() => removeNavigationGuard())
</script>

<template>
  <section class="cards-page">
    <header class="page-head">
      <div>
        <h1>卡片</h1>
        <p class="muted">浏览问题与答案，整理每一张卡片。</p>
      </div>
      <PButton outlined @click="navigate('home')"
        ><Layers :size="18" aria-hidden="true" />返回卡组</PButton
      >
    </header>

    <div class="cards-filters" role="search" aria-label="筛选卡片">
      <div class="search-field">
        <label class="control-label" for="card-search">搜索卡片</label>
        <div class="search-input">
          <Search :size="19" aria-hidden="true" />
          <PInputText id="card-search" v-model="search" placeholder="搜索问题、答案或标签" />
          <PButton
            v-if="search"
            text
            class="icon-button clear-search"
            aria-label="清空搜索"
            title="清空搜索"
            @click="search = ''"
            ><X :size="17" aria-hidden="true"
          /></PButton>
        </div>
      </div>
      <div class="filter-field">
        <label class="control-label" for="card-deck-filter">卡组</label
        ><PSelect
          input-id="card-deck-filter"
          v-model="deckFilter"
          :options="deckOptions"
          option-label="label"
          option-value="value"
        />
      </div>
      <div class="filter-field status-filter">
        <label class="control-label" for="card-status-filter">状态</label
        ><PSelect
          input-id="card-status-filter"
          v-model="statusFilter"
          :options="statusOptions"
          option-label="label"
          option-value="value"
        />
      </div>
    </div>

    <div class="result-line">
      <p class="meta" aria-live="polite">{{ visibleCards.length }} 张卡片</p>
      <PButton v-if="hasFilters" text label="清除筛选" @click="resetFilters" />
    </div>

    <div v-if="visibleCards.length" class="card-list surface">
      <div class="list-header meta" aria-hidden="true">
        <span>问题与答案</span><span>卡组 / 状态</span><span class="operation-label">操作</span>
      </div>
      <article
        v-for="card in visibleCards"
        :key="card.id"
        class="card-row"
        :aria-label="card.question"
      >
        <div class="card-content">
          <h2>{{ card.question }}</h2>
          <p class="card-answer">{{ card.answer }}</p>
          <ul v-if="card.tags.length" class="tags" aria-label="标签">
            <li v-for="tag in card.tags" :key="tag">{{ tag }}</li>
          </ul>
        </div>
        <div class="card-metadata">
          <span class="card-deck">{{ deckName(card.deckId) }}</span
          ><span class="status-pill" :class="`status-${card.status}`"
            ><span aria-hidden="true"></span>{{ statusNames[card.status] }}</span
          >
        </div>
        <div class="card-operations">
          <PButton
            text
            class="icon-button"
            :aria-label="`编辑：${card.question}`"
            title="编辑卡片"
            @click="editCard(card)"
            ><Pencil :size="18" aria-hidden="true"
          /></PButton>
          <PButton
            text
            class="icon-button"
            :aria-label="`${card.status === 'paused' ? '恢复' : '暂停'}：${card.question}`"
            :title="card.status === 'paused' ? '恢复卡片' : '暂停卡片'"
            @click="changeAvailability(card)"
            ><Play v-if="card.status === 'paused'" :size="18" aria-hidden="true" /><Pause
              v-else
              :size="18"
              aria-hidden="true"
          /></PButton>
          <PButton
            text
            severity="danger"
            class="icon-button"
            :aria-label="`删除：${card.question}`"
            title="删除卡片"
            @click="confirmDelete(card)"
            ><Trash2 :size="18" aria-hidden="true"
          /></PButton>
        </div>
      </article>
    </div>
    <div v-else class="empty-state surface cards-empty">
      <Search :size="32" aria-hidden="true" />
      <h2>没有找到匹配的卡片</h2>
      <p class="muted">换一个关键词，或清除卡组和状态筛选。</p>
      <PButton outlined label="清除筛选" @click="resetFilters" />
    </div>

    <PDialog
      v-model:visible="editing"
      modal
      header="编辑卡片"
      :style="{ width: '640px' }"
      :breakpoints="{ '700px': 'calc(100vw - 32px)' }"
      :draggable="false"
    >
      <form class="card-editor" @submit.prevent="saveCard">
        <div class="editor-field">
          <label for="card-edit-question">问题</label
          ><PTextarea
            id="card-edit-question"
            v-model="draft.question"
            rows="3"
            auto-resize
            :invalid="!!validation && !draft.question.trim()"
          />
        </div>
        <div class="editor-field">
          <label for="card-edit-answer">答案</label
          ><PTextarea
            id="card-edit-answer"
            v-model="draft.answer"
            rows="5"
            auto-resize
            :invalid="!!validation && !draft.answer.trim()"
          />
        </div>
        <div class="editor-field">
          <label for="card-edit-tags">标签</label
          ><PInputText
            id="card-edit-tags"
            v-model="draft.tags"
            aria-describedby="card-tags-help"
          /><span id="card-tags-help" class="meta muted">多个标签用逗号分隔。</span>
        </div>
        <PMessage v-if="validation || editSaveError" severity="error" :closable="false">{{
          validation || editSaveError
        }}</PMessage>
        <div class="editor-actions">
          <PButton
            type="button"
            label="取消"
            severity="secondary"
            outlined
            @click="editing = false"
          /><PButton type="submit" label="保存修改" />
        </div>
      </form>
    </PDialog>

    <PDialog
      v-model:visible="deleting"
      modal
      header="删除这张卡片？"
      :style="{ width: '480px' }"
      :breakpoints="{ '540px': 'calc(100vw - 32px)' }"
      :draggable="false"
    >
      <div class="delete-copy">
        <CircleHelp :size="24" aria-hidden="true" />
        <p>删除后这张卡片将从列表中移除。</p>
      </div>
      <blockquote class="delete-question">{{ pendingDelete?.question }}</blockquote>
      <PMessage v-if="deleteSaveError" severity="error" :closable="false">{{
        deleteSaveError
      }}</PMessage>
      <template #footer
        ><PButton label="取消" severity="secondary" outlined @click="deleting = false" /><PButton
          label="删除卡片"
          severity="danger"
          @click="deleteCard"
      /></template>
    </PDialog>
    <PDialog
      v-model:visible="discardOpen"
      modal
      header="放弃未保存的修改？"
      :style="{ width: '460px' }"
      :breakpoints="{ '520px': 'calc(100vw - 32px)' }"
      :draggable="false"
    >
      <p>这张卡片的修改尚未保存。离开后将保留原来的内容。</p>
      <template #footer
        ><PButton
          label="继续编辑"
          severity="secondary"
          outlined
          @click="discardOpen = false" /><PButton
          label="放弃并离开"
          severity="danger"
          @click="leaveWithoutSaving"
      /></template>
    </PDialog>
  </section>
</template>

<style scoped>
.cards-page {
  margin: 0 auto;
  padding-bottom: 32px;
}
.page-head p {
  margin: 8px 0 0;
}
.cards-filters {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(190px, 250px) 156px;
  gap: 16px;
  margin-top: 32px;
}
.control-label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #52665a;
}
.filter-field :deep(.p-select) {
  width: 100%;
}
.search-input {
  position: relative;
}
.search-input > svg {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  color: #52665a;
  pointer-events: none;
}
.search-input :deep(.p-inputtext) {
  width: 100%;
  padding-left: 44px;
  padding-right: 48px;
}
.clear-search {
  position: absolute;
  right: 1px;
  top: 50%;
  transform: translateY(-50%);
}
.result-line {
  min-height: 66px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.result-line p {
  margin: 0;
}
.result-divider {
  margin: 0 12px;
  color: #87958b;
}
.card-list {
  border: 1px solid #d8e1d4;
  border-radius: 12px;
  overflow: hidden;
}
.list-header,
.card-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px 140px;
  column-gap: 28px;
  padding: 0 24px;
}
.list-header {
  background: #edf1e9;
  min-height: 48px;
  align-items: center;
  color: #52665a;
  border-bottom: 1px solid #d8e1d4;
}
.operation-label {
  padding-left: 12px;
}
.card-row {
  background: #fff;
  padding-top: 24px;
  padding-bottom: 24px;
  align-items: start;
}
.card-row + .card-row {
  border-top: 1px solid #e2e8de;
}
.card-content {
  min-width: 0;
}
.card-answer {
  max-width: 42em;
}
.card-content h2 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.6;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.card-answer {
  white-space: pre-wrap;
  margin: 14px 0 0;
  padding-top: 13px;
  border-top: 1px solid #e9ede6;
  color: #52665a;
  line-height: 1.7;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tags {
  list-style: none;
  padding: 0;
  margin: 14px 0 0;
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.tags li {
  font-size: 0.875rem;
  line-height: 1.6;
  color: #52665a;
  background: #f1f4ee;
  border-radius: 5px;
  padding: 2px 8px;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.card-metadata {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  padding-top: 3px;
}
.card-deck {
  font-size: 0.875rem;
  line-height: 1.6;
  color: #52665a;
}
.status-pill {
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 5px;
  padding: 3px 8px;
}
.status-pill > span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status-due {
  color: #8a5522;
  background: #fbf1df;
}
.status-new {
  color: #34674d;
  background: #e8f0e3;
}
.status-learned {
  color: #35604a;
  background: #edf3e9;
}
.status-paused {
  color: #59655d;
  background: #edf0ec;
}
.card-operations {
  display: flex;
  align-items: center;
  gap: 2px;
}
.card-operations .icon-button {
  flex: 0 0 44px;
  height: 44px;
}
.cards-empty {
  min-height: 330px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 28px;
  border: 1px solid #d8e1d4;
}
.cards-empty h2,
.cards-empty p {
  margin: 0;
}
.cards-empty h2 {
  font-size: 1.25rem;
}
.cards-empty > svg {
  color: #708675;
  margin-bottom: 4px;
}
.cards-empty :deep(.p-button) {
  margin-top: 8px;
}
.card-editor {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-top: 4px;
}
.editor-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.editor-field label {
  font-size: 0.875rem;
  font-weight: 600;
}
.editor-field :deep(textarea) {
  resize: vertical;
  max-height: 48vh;
  overflow-y: auto !important;
  line-height: 1.65;
}
.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}
.delete-copy {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.delete-copy > svg {
  flex: 0 0 auto;
  color: #8c642f;
  margin-top: 3px;
}
.delete-copy p {
  margin: 0;
  line-height: 1.7;
}
.delete-question {
  margin: 20px 0 8px;
  padding: 16px;
  background: #f3f5f0;
  border-radius: 8px;
  color: #52665a;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
@media (max-width: 1050px) {
  .list-header,
  .card-row {
    grid-template-columns: minmax(0, 1fr) 150px 44px;
    column-gap: 20px;
  }
  .card-operations {
    flex-direction: column;
  }
  .operation-label {
    padding-left: 6px;
  }
}
@media (max-width: 700px) {
  .page-head {
    align-items: flex-start;
    gap: 18px;
    flex-wrap: wrap;
  }
  .cards-filters {
    grid-template-columns: minmax(0, 1fr) minmax(130px, 0.75fr);
    gap: 14px;
    margin-top: 24px;
  }
  .search-field {
    grid-column: 1 / -1;
  }
  .list-header {
    display: none;
  }
  .card-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    padding: 20px;
  }
  .card-content {
    grid-column: 1 / -1;
  }
  .card-metadata {
    gap: 6px;
    padding-top: 0;
  }
  .card-operations {
    flex-direction: row;
    align-self: end;
  }
  .result-line {
    min-height: 68px;
  }
  .result-divider {
    margin: 0 7px;
  }
}
@media (max-width: 430px) {
  .cards-filters {
    grid-template-columns: 1fr;
  }
  .card-row {
    grid-template-columns: 1fr;
    padding: 18px;
  }
  .card-content {
    grid-column: auto;
  }
  .card-metadata {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .card-operations {
    justify-content: flex-end;
    border-top: 1px solid #e9ede6;
    padding-top: 10px;
  }
  .status-pill {
    flex-shrink: 0;
  }
  .result-line {
    flex-wrap: wrap;
    padding: 12px 0;
  }
}
</style>
