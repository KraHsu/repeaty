<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { t } from '../i18n'
import { type Library, localDay } from '../core/model'
import { dueCards } from '../core/scheduler'
import { sourceQueueState } from '../core/source-queue'
import { canReviewCard } from '../plugins'
import type { Operation } from '../core/operations'
import {
  startMixedRound,
  nextMixedTask,
  finishMixedCard,
  finishMixedReading,
  type MixedTask,
} from '../core/mixed-study'

const props = defineProps<{
  library: Library
  scope: string
  now: Date
  busy: boolean
  cardsPerReading: number
  leaveReading: () => Promise<boolean>
  undoCard: () => Promise<boolean>
  undoReading: () => Promise<boolean>
  canUndoReading: boolean
  readingUndoId?: string
}>()
const emit = defineEmits<{ close: []; clearNotice: [] }>()
type Task = MixedTask & { key: number }
type CardTask = Extract<Task, { kind: 'card' }>
type ReadingTask = Extract<Task, { kind: 'reading' }>
defineSlots<{
  card(props: {
    item: CardTask
    done: (graded: boolean) => void
    activity: (busy: boolean) => void
  }): unknown
  reading(props: {
    item: ReadingTask
    done: (arranged: boolean) => void
    activity: (busy: boolean) => void
  }): unknown
}>()
const round = shallowRef(startMixedRound(props.library, props.now, props.cardsPerReading))
const current = shallowRef<Task>()
const active = ref(false),
  switching = ref(false)
const locked = computed(() => props.busy || active.value || switching.value)
const grades = shallowRef<{ id: string; cardId: string }[]>([])
const readingCheckpoints = shallowRef<{ id: string; index: number; after: number }[]>([])
let key = 0,
  alive = true
onUnmounted(() => {
  alive = false
})
const canUndoCard = computed(() => {
  const latest = props.library.reviews.at(-1)
  return !!latest?.previous && grades.value.at(-1)?.id === latest.id
})
function choose(task = nextMixedTask(round.value, props.library, props.now, canReviewCard)) {
  active.value = false
  current.value = task && { ...task, key: ++key }
}
choose()
function activity(item: Task, busy: boolean) {
  if (current.value?.key === item.key) active.value = busy
}
function cardDone(item: CardTask, graded: boolean) {
  if (!alive || current.value?.key !== item.key) return
  if (graded) {
    round.value = finishMixedCard(round.value)
    const review = props.library.reviews.at(-1)
    if (review?.cardId === item.id)
      grades.value = [...grades.value, { id: review.id, cardId: item.id }]
  }
  choose()
}
function readingDone(item: ReadingTask, arranged: boolean) {
  if (!alive || current.value?.key !== item.key) return
  round.value = finishMixedReading(round.value, item.index)
  const undoId = props.readingUndoId
  if (undoId && arranged)
    readingCheckpoints.value = [
      ...readingCheckpoints.value.slice(-19),
      { id: undoId, index: item.index, after: round.value.cursor },
    ]
  choose()
}
const callbacks = computed(() => {
  const item = current.value
  return {
    card: (graded: boolean) => {
      if (item?.kind === 'card') cardDone(item, graded)
    },
    reading: (arranged: boolean) => {
      if (item?.kind === 'reading') readingDone(item, arranged)
    },
    activity: (busy: boolean) => {
      if (item) activity(item, busy)
    },
  }
})
async function leave() {
  return current.value?.kind !== 'reading' || (await props.leaveReading())
}
async function close() {
  if (locked.value) return
  switching.value = true
  try {
    if ((await leave()) && alive) emit('close')
  } finally {
    switching.value = false
  }
}
async function undoCard() {
  if (locked.value || !canUndoCard.value) return
  const latest = grades.value.at(-1)!,
    scope = props.scope
  switching.value = true
  emit('clearNotice')
  try {
    if (
      !(await leave()) ||
      !alive ||
      scope !== props.scope ||
      !canUndoCard.value ||
      grades.value.at(-1) !== latest
    )
      return
    if (!(await props.undoCard()) || !alive || scope !== props.scope) return
    grades.value = grades.value.slice(0, -1)
    round.value = {
      ...round.value,
      cardsSinceReading: Math.max(0, round.value.cardsSinceReading - 1),
      completedCards: Math.max(0, round.value.completedCards - 1),
    }
    choose(
      dueCards(props.library, props.now, undefined, canReviewCard).some(
        (card) => card.id === latest.cardId,
      )
        ? { kind: 'card', id: latest.cardId }
        : undefined,
    )
  } finally {
    switching.value = false
  }
}
async function undoReading() {
  if (locked.value || !props.canUndoReading) return
  const undoId = props.readingUndoId,
    checkpoint = readingCheckpoints.value.find((entry) => entry.id === undoId),
    scope = props.scope
  switching.value = true
  emit('clearNotice')
  try {
    if (
      !(await leave()) ||
      !alive ||
      scope !== props.scope ||
      !props.canUndoReading ||
      props.readingUndoId !== undoId
    )
      return
    if (!(await props.undoReading()) || !alive || scope !== props.scope) return
    if (checkpoint && checkpoint.id === undoId && checkpoint.after === round.value.cursor) {
      round.value = {
        ...round.value,
        cursor: checkpoint.index,
        cardsSinceReading: round.value.cardsPerReading,
        completedReadings: Math.max(0, round.value.completedReadings - 1),
      }
    }
    readingCheckpoints.value = readingCheckpoints.value.filter((entry) => entry.id !== undoId)
    choose()
  } finally {
    switching.value = false
  }
}
const currentValid = computed(() => {
  if (!current.value) return true
  const item = current.value
  return item.kind === 'card'
    ? dueCards(props.library, props.now, undefined, canReviewCard).some(
        (card) => card.id === item.id,
      )
    : props.library.sources.some(
        (source) =>
          source.id === item.id &&
          source.mediaId === item.mediaId &&
          sourceQueueState(source, localDay(props.now)) === 'ready',
      )
})
watch([currentValid, locked], ([valid, busy]) => {
  if (!busy && current.value && !valid) choose()
})
async function reconcileUndo(operation: Operation) {
  if (!operation.cardId || !alive) return
  if (
    dueCards(props.library, props.now, undefined, canReviewCard).some(
      (card) => card.id === operation.cardId,
    )
  )
    choose({ kind: 'card', id: operation.cardId })
}
defineExpose({ undoCard, undoReading, canUndoCard, locked, leave, reconcileUndo })
</script>

<template>
  <section class="mixed-session" :aria-label="t('混合学习')">
    <header class="mixed-header">
      <div>
        <h1>{{ t('混合学习') }}</h1>
        <p role="status">
          {{
            t('已复习 {cards} 次 · 已处理 {sources} 篇', {
              cards: round.completedCards,
              sources: round.completedReadings,
            })
          }}
        </p>
        <p class="form-note">
          {{ t('每 {count} 张卡片穿插 1 篇材料。', { count: round.cardsPerReading }) }}
        </p>
      </div>
      <div class="mixed-actions">
        <button class="text-button" :disabled="locked || !canUndoCard" @click="undoCard">
          {{ t('撤销上次评分') }}
        </button>
        <button v-if="canUndoReading" class="text-button" :disabled="locked" @click="undoReading">
          {{ t('撤销阅读安排') }}
        </button>
        <button class="button secondary" :disabled="locked" @click="close">
          {{ t('结束混合学习') }}
        </button>
      </div>
    </header>
    <slot
      v-if="current?.kind === 'card'"
      name="card"
      :item="current"
      :done="callbacks.card"
      :activity="callbacks.activity"
    />
    <slot
      v-else-if="current?.kind === 'reading'"
      name="reading"
      :item="current"
      :done="callbacks.reading"
      :activity="callbacks.activity"
    />
    <div v-else class="empty-state">
      <h2>{{ t('本轮混合学习结束') }}</h2>
      <p>{{ t('本轮材料已处理完，当前没有可复习卡片。') }}</p>
      <button class="button primary" :disabled="locked" @click="close">
        {{ t('返回学习概览') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.mixed-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 2rem 2.5rem 1rem;
  border-bottom: 1px solid var(--line);
}
h1 {
  font-size: 1.5rem;
  margin: 0 0 0.5rem;
}
p {
  margin: 0.5rem 0;
}
.mixed-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}
@media (max-width: 720px) {
  .mixed-header {
    padding: 1.25rem;
  }
}
</style>
