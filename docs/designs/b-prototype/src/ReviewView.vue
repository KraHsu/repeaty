<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft, ArrowRight, Pencil, Check, Layers, RotateCcw, Keyboard } from '@lucide/vue'
import { demo, commit, navigate, setNavigationGuard } from './state.js'

const selectedDeck =
  demo.data.decks.find((deck) => deck.id === demo.selectedDeck) || demo.data.decks[0]
const queue = ref(
  demo.data.cards
    .filter((card) => card.deckId === selectedDeck?.id && ['due', 'new'].includes(card.status))
    .map((card) => ({ ...card, tags: [...card.tags] })),
)
const position = ref(0)
const revealed = ref(false)
const reviewed = ref(0)
const lastRating = ref('')
const saveError = ref('')
const currentCard = computed(() => queue.value[position.value])
const complete = computed(() => queue.value.length > 0 && position.value >= queue.value.length)
const ratings = [
  { value: 1, label: '重来', description: '还没记住', className: 'again' },
  { value: 2, label: '困难', description: '想了很久', className: 'hard' },
  { value: 3, label: '良好', description: '顺利想起', className: 'good' },
  { value: 4, label: '简单', description: '轻松记住', className: 'easy' },
]
const editOpen = ref(false)
const exitOpen = ref(false)
const draft = ref({ question: '', answer: '' })
const editError = ref('')
const validation = ref('')
const stageElement = ref(null)
let pendingNavigation = { view: 'home', options: {} }
let removeNavigationGuard = () => {}

function showAnswer() {
  if (!currentCard.value) return
  revealed.value = true
  saveError.value = ''
}

function rate(rating) {
  if (!revealed.value || !currentCard.value || editOpen.value || exitOpen.value) return
  const saved = commit((data) => {
    const card = data.cards.find((item) => item.id === currentCard.value.id)
    if (!card || !['due', 'new'].includes(card.status)) throw new Error('卡片不在待复习队列中。')
    const deck = data.decks.find((item) => item.id === card.deckId)
    if (deck) {
      if (card.status === 'due') deck.due = Math.max(0, deck.due - 1)
      if (card.status === 'new') deck.fresh = Math.max(0, deck.fresh - 1)
    }
    card.status = 'learned'
    data.reviewCount = (Number(data.reviewCount) || 0) + 1
  }, '')
  if (!saved) {
    saveError.value = demo.saveError || '评分未保存，当前卡片仍然保留，请重试。'
    return
  }
  reviewed.value += 1
  lastRating.value = rating.label
  saveError.value = ''
  revealed.value = false
  const scrollRegion = stageElement.value?.closest('main')
  position.value += 1
  nextTick(() => scrollRegion?.scrollTo({ top: 0, behavior: 'instant' }))
}

function editCurrent() {
  if (!currentCard.value) return
  draft.value = { question: currentCard.value.question, answer: currentCard.value.answer }
  validation.value = ''
  editError.value = ''
  editOpen.value = true
}

function saveEdit() {
  if (!draft.value.question.trim() || !draft.value.answer.trim()) {
    validation.value = '请填写问题和答案。'
    return
  }
  validation.value = ''
  const id = currentCard.value.id
  const question = draft.value.question.trim()
  const answer = draft.value.answer.trim()
  const saved = commit((data) => {
    const card = data.cards.find((item) => item.id === id)
    if (!card) throw new Error('这张卡片已不存在，修改未保存。')
    card.question = question
    card.answer = answer
  }, '卡片已保存')
  if (!saved) {
    editError.value = demo.saveError || '保存失败，草稿仍保留在这里，请重试。'
    return
  }
  currentCard.value.question = question
  currentCard.value.answer = answer
  editOpen.value = false
}

function requestExit() {
  navigate('home')
}

function confirmExit() {
  removeNavigationGuard()
  navigate(pendingNavigation.view, pendingNavigation.options)
}

function onKeydown(event) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    editOpen.value ||
    exitOpen.value
  )
    return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="slider"], [role="dialog"]',
    )
  )
    return
  if (event.key === 'Escape') {
    event.preventDefault()
    requestExit()
    return
  }
  if (!currentCard.value) return
  if (event.code === 'Space' && !revealed.value) {
    if (target instanceof Element && target.closest('button, [role="button"], a')) return
    event.preventDefault()
    showAnswer()
  } else if (revealed.value && /^[1-4]$/.test(event.key)) {
    event.preventDefault()
    rate(ratings[Number(event.key) - 1])
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  removeNavigationGuard = setNavigationGuard((view, options) => {
    if (view === 'review' || !currentCard.value) return true
    pendingNavigation = { view, options }
    exitOpen.value = true
    return false
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  removeNavigationGuard()
})
</script>

<template>
  <section class="review-page">
    <header class="review-header">
      <PButton text @click="requestExit"
        ><ArrowLeft :size="18" aria-hidden="true" />返回卡组</PButton
      >
      <div class="review-deck">
        <Layers :size="18" aria-hidden="true" /><span>{{ selectedDeck?.name || '当前卡组' }}</span>
      </div>
      <span class="review-counter meta" aria-live="polite"
        >{{ reviewed }} / {{ queue.length }} 已完成</span
      >
    </header>

    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="reviewed"
      :aria-valuemax="queue.length || 1"
      aria-valuemin="0"
      aria-label="本轮复习进度"
    >
      <div :style="{ width: `${queue.length ? (reviewed / queue.length) * 100 : 0}%` }"></div>
    </div>

    <div v-if="currentCard" class="review-session">
      <div class="session-meta">
        <span class="meta muted"
          >第 {{ position + 1 }} 张<span class="meta-divider">/</span>共
          {{ queue.length }} 张卡片</span
        ><span v-if="lastRating" class="last-rating meta" role="status"
          ><Check :size="15" aria-hidden="true" />上一张：{{ lastRating }}</span
        >
      </div>
      <article ref="stageElement" class="review-stage surface" aria-label="当前复习卡片">
        <header class="card-top">
          <span class="side-label">问题</span
          ><PButton
            text
            class="icon-button"
            title="编辑当前卡片"
            aria-label="编辑当前卡片"
            @click="editCurrent"
            ><Pencil :size="18" aria-hidden="true"
          /></PButton>
        </header>
        <div class="question-section">
          <h1>{{ currentCard.question }}</h1>
          <ul v-if="currentCard.tags.length" class="review-tags" aria-label="标签">
            <li v-for="tag in currentCard.tags" :key="tag">{{ tag }}</li>
          </ul>
        </div>
        <div v-if="revealed" class="answer-section">
          <span class="side-label">答案</span>
          <div class="answer-copy">{{ currentCard.answer }}</div>
        </div>
        <div v-else class="answer-placeholder">
          <span class="placeholder-line"></span>
          <p class="muted">先回想一下，再查看答案。</p>
        </div>
      </article>

      <div v-if="!revealed" class="reveal-actions">
        <PButton class="reveal-button" @click="showAnswer"
          >显示答案<ArrowRight :size="19" aria-hidden="true" /></PButton
        ><span class="meta muted shortcut-hint"
          ><Keyboard :size="16" aria-hidden="true" /><kbd>空格</kbd> 显示答案</span
        >
      </div>

      <div v-else class="rating-dock" aria-label="评价回忆情况">
        <PMessage v-if="saveError" severity="error" :closable="false">{{ saveError }}</PMessage>
        <div class="rating-heading">
          <span>这次回忆得怎么样？</span><span class="meta muted">选择后进入下一张</span>
        </div>
        <div class="rating-buttons">
          <PButton
            v-for="rating in ratings"
            :key="rating.value"
            :class="['rating-button', rating.className]"
            :aria-label="`${rating.label}，${rating.description}，快捷键 ${rating.value}`"
            @click="rate(rating)"
            ><span class="rating-main"
              >{{ rating.label }}<kbd>{{ rating.value }}</kbd></span
            ><span class="rating-description">{{ rating.description }}</span></PButton
          >
        </div>
      </div>
    </div>

    <div v-else-if="complete" class="completion-stage surface" aria-live="polite">
      <span class="completion-mark"
        ><Check :size="34" stroke-width="1.8" aria-hidden="true"
      /></span>
      <p class="completion-eyebrow">{{ selectedDeck?.name }}</p>
      <h1>本轮复习完成</h1>
      <p class="completion-copy">
        你完成了 <strong>{{ reviewed }}</strong> 张卡片。
      </p>
      <p class="muted meta">本轮评分已保存。</p>
      <PButton class="completion-button" @click="navigate('home')"
        >返回卡组<ArrowRight :size="18" aria-hidden="true"
      /></PButton>
    </div>

    <div v-else class="completion-stage surface">
      <span class="completion-mark"><RotateCcw :size="30" aria-hidden="true" /></span>
      <h1>暂无可复习的卡片</h1>
      <p class="muted">可以前往卡片列表恢复已暂停的卡片。</p>
      <div class="empty-actions">
        <PButton outlined label="返回卡组" @click="navigate('home')" /><PButton
          label="查看卡片"
          @click="navigate('cards')"
        />
      </div>
    </div>

    <PDialog
      v-model:visible="editOpen"
      modal
      header="编辑当前卡片"
      :style="{ width: '640px' }"
      :breakpoints="{ '700px': 'calc(100vw - 32px)' }"
      :draggable="false"
    >
      <form class="review-editor" @submit.prevent="saveEdit">
        <p class="meta muted editor-note">保存或取消后，继续当前复习。</p>
        <div class="editor-field">
          <label for="review-edit-question">问题</label
          ><PTextarea
            id="review-edit-question"
            v-model="draft.question"
            rows="3"
            auto-resize
            :invalid="!!validation && !draft.question.trim()"
          />
        </div>
        <div class="editor-field">
          <label for="review-edit-answer">答案</label
          ><PTextarea
            id="review-edit-answer"
            v-model="draft.answer"
            rows="5"
            auto-resize
            :invalid="!!validation && !draft.answer.trim()"
          />
        </div>
        <PMessage v-if="validation || editError" severity="error" :closable="false">{{
          validation || editError
        }}</PMessage>
        <div class="editor-actions">
          <PButton
            type="button"
            label="取消"
            severity="secondary"
            outlined
            @click="editOpen = false"
          /><PButton type="submit" label="保存并继续" />
        </div>
      </form>
    </PDialog>

    <PDialog
      v-model:visible="exitOpen"
      modal
      header="结束本轮复习？"
      :style="{ width: '460px' }"
      :breakpoints="{ '520px': 'calc(100vw - 32px)' }"
      :draggable="false"
    >
      <p class="exit-copy">
        已完成 {{ reviewed }} 张，剩余
        {{ queue.length - reviewed }} 张。已保存的评分会保留，当前未评分的卡片不计入完成数量。
      </p>
      <p v-if="editOpen" class="meta muted">当前编辑尚未保存，结束后会保留卡片原来的内容。</p>
      <template #footer
        ><PButton
          label="继续复习"
          severity="secondary"
          outlined
          @click="exitOpen = false" /><PButton label="结束并离开" @click="confirmExit"
      /></template>
    </PDialog>
  </section>
</template>

<style scoped>
.answer-copy {
  max-width: 30em;
  text-wrap: pretty;
}
.review-page {
  margin: 0 auto;
  padding-bottom: 30px;
}
.review-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 20px;
  align-items: center;
  min-height: 52px;
}
.review-header > :first-child {
  justify-self: start;
}
.review-deck {
  display: flex;
  gap: 10px;
  align-items: center;
  font-weight: 600;
}
.review-deck > svg {
  color: #52665a;
  flex-shrink: 0;
}
.review-counter {
  justify-self: end;
  color: #52665a;
  white-space: nowrap;
}
.progress-track {
  height: 3px;
  background: #e1e8dc;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 18px;
}
.progress-track > div {
  height: 100%;
  background: #34674d;
  transition: width 160ms ease-out;
}
.review-session {
  max-width: 760px;
  margin: 28px auto 0;
}
.session-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 28px;
  margin-bottom: 14px;
}
.meta-divider {
  margin: 0 10px;
  color: #869384;
}
.last-rating {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #34674d;
}
.review-stage {
  min-height: 450px;
  padding: 24px 40px 36px;
  border: 1px solid #d8e1d4;
  border-radius: 16px;
  box-shadow: 0 6px 24px #243c3105;
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 44px;
}
.card-top .icon-button {
  width: 44px;
  height: 44px;
}
.side-label {
  color: #52665a;
  font-size: 0.875rem;
  font-weight: 600;
}
.question-section {
  padding: 22px 0 30px;
}
.question-section h1 {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.85;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.review-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  list-style: none;
  margin: 20px 0 0;
}
.review-tags li {
  font-size: 0.875rem;
  color: #52665a;
  background: #f0f4eb;
  padding: 3px 9px;
  border-radius: 5px;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.answer-section {
  border-top: 1px solid #e0e7d9;
  padding-top: 26px;
}
.answer-copy {
  margin-top: 16px;
  font-size: 1.25rem;
  line-height: 1.85;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.answer-placeholder {
  padding-top: 18px;
  color: #52665a;
}
.placeholder-line {
  display: block;
  width: 48px;
  height: 2px;
  background: #dbe4d4;
}
.answer-placeholder p {
  margin: 22px 0 0;
  font-size: 1rem;
}
.reveal-actions {
  position: sticky;
  bottom: 0;
  z-index: 3;
  background: #f3f5f0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 22px 0 16px;
}
.reveal-button {
  min-width: 228px;
  min-height: 50px;
  justify-content: center;
  gap: 18px;
}
.shortcut-hint {
  display: flex;
  gap: 8px;
  align-items: center;
}
kbd {
  font: inherit;
  font-size: 0.875rem;
}
.shortcut-hint kbd {
  padding: 1px 7px;
  background: #eaf0e3;
  border: 1px solid #d6dfce;
  border-radius: 4px;
}
.rating-dock {
  position: sticky;
  bottom: 0;
  z-index: 3;
  padding: 20px 0 12px;
  background: #f3f5f0;
}
.rating-dock :deep(.p-message) {
  margin-bottom: 14px;
}
.rating-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.rating-heading > :first-child {
  font-weight: 600;
}
.rating-buttons {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.rating-button {
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 5px;
  min-height: 82px;
  padding: 12px 18px;
  border: 1px solid transparent;
  box-shadow: none;
}
.rating-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: 1rem;
}
.rating-main kbd {
  width: 24px;
  height: 24px;
  border: 1px solid currentColor;
  border-radius: 5px;
  opacity: 0.72;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.rating-description {
  text-align: left;
  font-size: 0.875rem;
  font-weight: 400;
}
.rating-button.again {
  color: #963e36;
  background: #fbece8;
  border-color: #edc9c2;
}
.rating-button.again:hover {
  background: #f6ded7;
  border-color: #c88378;
}
.rating-button.hard {
  color: #82551f;
  background: #fbf2df;
  border-color: #e8d6ae;
}
.rating-button.hard:hover {
  background: #f5e7c7;
  border-color: #bd9653;
}
.rating-button.good {
  color: #28543b;
  background: #e7efdf;
  border-color: #bdcdb2;
}
.rating-button.good:hover {
  background: #d7e6ca;
  border-color: #739568;
}
.rating-button.easy {
  color: #345d86;
  background: #eaf1f9;
  border-color: #c6d7e9;
}
.rating-button.easy:hover {
  background: #dae8f6;
  border-color: #82a5c8;
}
.rating-note {
  margin: 13px 0 0;
  text-align: center;
}
.completion-stage {
  max-width: 760px;
  min-height: 480px;
  margin: 56px auto 0;
  padding: 48px 32px;
  border: 1px solid #d8e1d4;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.completion-mark {
  display: flex;
  width: 66px;
  height: 66px;
  align-items: center;
  justify-content: center;
  color: #34674d;
  background: #e7efdf;
  border-radius: 50%;
  margin-bottom: 24px;
}
.completion-eyebrow {
  font-size: 0.875rem;
  color: #52665a;
  margin: 0 0 10px;
}
.completion-stage h1 {
  font-size: 1.75rem;
  margin: 0;
  line-height: 1.4;
}
.completion-copy {
  font-size: 1.25rem;
  margin: 20px 0 0;
}
.completion-copy strong {
  color: #34674d;
  font-weight: 600;
}
.completion-button {
  margin-top: 24px;
  min-width: 190px;
  gap: 20px;
}
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
}
.review-editor {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.editor-note {
  margin: 0;
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
.exit-copy {
  margin: 0;
  line-height: 1.75;
}
@media (max-width: 800px) {
  .review-header {
    grid-template-columns: 1fr auto;
    gap: 10px;
  }
  .review-deck {
    order: 3;
    grid-column: 1 / -1;
    padding: 8px 0 0;
  }
  .review-stage {
    padding: 20px 28px 28px;
  }
  .rating-button {
    padding: 12px;
  }
  .rating-buttons {
    gap: 8px;
  }
}
@media (max-width: 540px) {
  .review-session {
    margin-top: 20px;
  }
  .review-stage {
    min-height: 360px;
    padding: 14px 20px 26px;
    border-radius: 12px;
  }
  .question-section h1 {
    font-size: 1.25rem;
    line-height: 1.75;
  }
  .answer-copy {
    font-size: 1.25rem;
    line-height: 1.75;
  }
  .question-section {
    padding-top: 14px;
  }
  .rating-heading {
    flex-wrap: wrap;
    gap: 4px;
  }
  .rating-buttons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .rating-button {
    min-height: 70px;
  }
  .rating-dock {
    padding-top: 16px;
  }
  .rating-note {
    font-size: 0.875rem;
    text-align: left;
  }
  .session-meta {
    flex-wrap: wrap;
    gap: 3px;
  }
  .completion-stage {
    margin-top: 28px;
    padding: 36px 20px;
    min-height: 420px;
  }
  .completion-stage h1 {
    font-size: 1.5625rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .progress-track > div {
    transition: none;
  }
}
</style>
