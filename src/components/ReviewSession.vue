<script setup lang="ts">
import UDropdownMenu, { type DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue'
import UProgress from '@nuxt/ui/components/Progress.vue'
import { UiButton } from './ui'
import { t, msg } from '../i18n'
import { useNotifications } from '../notifications'

import { defineAsyncComponent, computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, Check, CornerDownLeft, RotateCcw, Ellipsis } from '@lucide/vue'
import { shortcutBlocked } from '../shortcuts'
import type { Operation } from '../core/operations'
import {
  available,
  blockedByLimit,
  dueCards,
  intervalLabel,
  previewReview,
} from '../core/scheduler'
import {
  createCardViewReader,
  type CardView,
  type Grade,
  type Library,
  type StudySession,
} from '../core/model'
import { studyCards } from '../core/search'
import { usePlugins } from '../plugins'
import { usePluginManager } from '../plugins/manager'
const { questionPlugin, canReviewCard, enabledReviewPanels } = usePlugins()
const { holdPluginRuntime } = usePluginManager()
const releasePluginRuntime = holdPluginRuntime()
onUnmounted(releasePluginRuntime)
import type { QuestionState } from '../plugins/types'
import type { Assessment } from '../plugins/data'
import type { Practice, Attempt } from '../core/practice-data'
const { notify } = useNotifications()

const SourceContext = defineAsyncComponent(() => import('./SourceContext.vue'))
const props = defineProps<{
  library: Library
  deckId?: string
  study?: StudySession
  mixedCardId?: string
  busy: boolean
  editing?: boolean
  lastOperationId?: string
  submit: (
    id: string,
    grade: Grade,
    assessment?: Assessment,
    practiceId?: string,
  ) => Promise<boolean>
  workspaceScope: string
  saveAttempt: (practice: Practice, attempt: Attempt, scope: string) => Promise<void>
  finishPractice: (id: string, cardId: string, assessment?: Assessment) => Promise<boolean>
  undo: () => Promise<boolean>
  change: (ids: string[], action: 'suspend' | 'bury') => Promise<boolean>
  getMedia: (id: string) => Promise<Blob | undefined>
  getSource: (id: string, signal?: AbortSignal, mediaId?: string) => Promise<string>
  getAttempt: (id: string, signal?: AbortSignal) => Promise<Attempt>
}>()
const emit = defineEmits<{
  close: []
  step: [graded: boolean]
  activity: [busy: boolean]
  edit: [card: CardView]
  add: [card: CardView]
  delete: [card: CardView]
}>()
const grading = ref(false)
const clock = ref(new Date())
const revealed = ref(false)
const sourceOpen = ref(false)
const currentSource = computed(() =>
  props.library.sources.find((source) => source.id === current.value?.excerpt?.sourceId),
)
const currentOrigin = computed(() =>
  props.library.sources.find((source) => source.id === currentSource.value?.origin?.sourceId),
)
const completed = ref(0)
const revision = ref(0)
const menuOpen = ref(false)
const currentId = ref<string>()
const automatic = computed(() => questionState.assessment?.mode === 'automatic')
const suggestedName = computed(
  () => grades.find((grade) => grade.value === questionState.suggestedGrade)?.label ?? '',
)
const practice = computed(() => Boolean(props.study && !props.study.reschedule))
const studied = ref<{ id: string; grade: Grade; reviewId?: string; operationId?: string }[]>([])
const readViews = createCardViewReader()
const views = computed(() => readViews(props.library))
const queue = computed(() =>
  props.study
    ? studyCards(
        props.library,
        props.study.ids,
        studied.value.map((entry) => entry.id),
        clock.value,
      ).filter(canReviewCard)
    : dueCards(props.library, clock.value, props.deckId, canReviewCard, views.value).filter(
        (card) => !props.mixedCardId || card.id === props.mixedCardId,
      ),
)
const startedWith = queue.value.length
const current = computed(() =>
  views.value.find(
    (card) => card.id === currentId.value && available(card, clock.value) && canReviewCard(card),
  ),
)
const plugin = computed(() => current.value && questionPlugin(current.value))
const cardHistory = computed(() => {
  const practices = props.library.practices.filter((entry) => entry.cardId === current.value?.id)
  const ids = new Set(practices.map((entry) => entry.id))
  return {
    practices,
    attempts: props.library.attempts.filter((entry) => ids.has(entry.practiceId)),
  }
})
const questionState = reactive<QuestionState>({ allowedGrades: [], busy: false })
const actionsLocked = computed(
  () => props.busy || props.editing || questionState.busy || grading.value,
)
const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('添加'),
    icon: 'i-lucide-plus',
    kbds: ['A'],
    disabled: actionsLocked.value,
    onSelect: addCurrent,
  },
  {
    label: t('编辑'),
    icon: 'i-lucide-pencil',
    kbds: ['E'],
    disabled: actionsLocked.value,
    onSelect: editCurrent,
  },
  {
    label: t('删除'),
    icon: 'i-lucide-trash-2',
    kbds: ['Ctrl', 'Del'],
    color: 'error',
    disabled: actionsLocked.value,
    onSelect: deleteCurrent,
  },
  ...(!practice.value
    ? [
        {
          label: t('今天暂缓'),
          kbds: ['B'],
          disabled: actionsLocked.value,
          onSelect: () => {
            void changeCurrent('bury')
          },
        },
        {
          label: t('暂停此卡'),
          kbds: ['S'],
          disabled: actionsLocked.value,
          onSelect: () => {
            void changeCurrent('suspend')
          },
        },
      ]
    : []),
])
watch(
  () => props.busy || props.editing || questionState.busy || grading.value,
  (value) => emit('activity', value),
  { immediate: true, flush: 'sync' },
)
watch(
  currentId,
  () => {
    sourceOpen.value = false
    questionState.allowedGrades = []
    questionState.suggestedGrade = undefined
    questionState.assessment = undefined
    questionState.practiceId = undefined
    questionState.complete = undefined
    questionState.busy = false
  },
  { flush: 'sync' },
)
const limited = computed(() =>
  props.study
    ? 0
    : blockedByLimit(props.library, clock.value, props.deckId, canReviewCard, views.value),
)
const canUndo = computed(() =>
  practice.value
    ? studied.value.length > 0
    : Boolean(props.library.reviews.at(-1)?.previous) &&
      (!props.study ||
        (studied.value.length > 0 &&
          studied.value.at(-1)?.reviewId === props.library.reviews.at(-1)?.id)),
)
const canUndoPractice = computed(
  () =>
    practice.value &&
    studied.value.length > 0 &&
    studied.value.at(-1)?.operationId === props.lastOperationId,
)
const deck = computed(() => props.library.decks.find((entry) => entry.id === current.value?.deckId))
const preview = computed(() =>
  current.value && !practice.value
    ? previewReview(current.value, clock.value, deck.value)
    : undefined,
)
const nextCard = computed(
  () =>
    views.value
      .filter(
        (card) =>
          canReviewCard(card) &&
          available(card, clock.value) &&
          (!props.deckId || card.deckId === props.deckId) &&
          new Date(card.schedule.due) > clock.value,
      )
      .sort((a, b) => a.schedule.due.localeCompare(b.schedule.due))[0],
)
const grades = [
  { value: 1, label: '重来', hint: '未能答对', class: 'again' },
  { value: 2, label: '困难', hint: '答对，但有困难', class: 'hard' },
  { value: 3, label: '良好', hint: '正确回答', class: 'good' },
  { value: 4, label: '简单', hint: '轻松答对', class: 'easy' },
] as const

function selectNext() {
  clock.value = new Date()
  currentId.value = queue.value[0]?.id
  revealed.value = false
}
function restart(id: string, noteId: string) {
  const target =
    views.value.find((card) => card.id === id) ?? views.value.find((card) => card.noteId === noteId)
  if (!target || !available(target, new Date()) || !canReviewCard(target)) return selectNext()
  if (
    !props.study &&
    !dueCards(props.library, new Date(), undefined, canReviewCard, views.value).some(
      (card) => card.id === target.id,
    )
  )
    return selectNext()
  currentId.value = target.id
  revealed.value = false
  sourceOpen.value = false
  questionState.allowedGrades = []
  questionState.suggestedGrade = undefined
  questionState.assessment = undefined
  questionState.practiceId = undefined
  questionState.complete = undefined
  questionState.busy = false
  revision.value++
}
function reconcileUndo(operation: Operation) {
  if (current.value && operation.noteIds.includes(current.value.noteId))
    return restart(current.value.id, current.value.noteId)
  const restored = views.value.find((card) => card.id === operation.cardId)
  if (restored) restart(restored.id, restored.noteId)
  else if (!current.value) selectNext()
}
defineExpose({
  restart,
  undoLast,
  canUndo,
  reconcileUndo,
  addCurrent,
  current,
  canUndoPractice,
  locked: computed(() => props.busy || props.editing || questionState.busy || grading.value),
})
function addCurrent() {
  if (!current.value || props.busy || props.editing || questionState.busy || grading.value) return
  menuOpen.value = false
  emit('add', current.value)
}
function deleteCurrent() {
  if (!current.value || props.busy || props.editing || questionState.busy || grading.value) return
  menuOpen.value = false
  emit('delete', current.value)
}
function editCurrent() {
  if (!current.value || props.busy || props.editing || questionState.busy || grading.value) return
  menuOpen.value = false
  emit('edit', current.value)
}
watch(queue, (cards) => {
  if (!current.value && cards.length) {
    currentId.value = cards[0]?.id
    revealed.value = false
  }
})
async function grade(value: Grade) {
  if (
    !current.value ||
    !revealed.value ||
    props.busy ||
    props.editing ||
    grading.value ||
    questionState.busy ||
    !questionState.allowedGrades.includes(value)
  )
    return
  const id = current.value.id
  const complete = questionState.complete
  grading.value = true
  try {
    const saved = practice.value
      ? !questionState.practiceId ||
        (await props.finishPractice(questionState.practiceId, id, questionState.assessment))
      : await props.submit(id, value, questionState.assessment, questionState.practiceId)
    if (saved) {
      await complete?.()
      const effects = practice.value ? undefined : props.library.reviews.at(-1)?.effects
      const context = props.library.reviews.at(-1)?.id
      if (effects?.siblings.length)
        notify(
          msg('同笔记的 {count} 张关联卡片已自动暂缓至明天。', { count: effects.siblings.length }),
          'info',
          context,
        )
      if (effects?.markedLeech)
        notify('这张卡已标记为顽固卡，可在卡片列表中筛选并改写问题。', 'warning', context)
      if (props.study)
        studied.value.push({
          id,
          grade: value,
          reviewId: practice.value ? undefined : props.library.reviews.at(-1)?.id,
          operationId: props.lastOperationId,
        })
      completed.value++
      if (props.mixedCardId) emit('step', true)
      selectNext()
    }
  } finally {
    grading.value = false
  }
}
async function undoLast() {
  if (!canUndo.value || props.busy || props.editing || questionState.busy || grading.value) return
  const id = practice.value ? studied.value.at(-1)?.id : props.library.reviews.at(-1)?.cardId
  if (practice.value || (await props.undo())) {
    if (props.study) studied.value.pop()
    completed.value = Math.max(0, completed.value - 1)
    selectNext()
    if (queue.value.some((card) => card.id === id)) currentId.value = id
  }
}
async function changeCurrent(action: 'suspend' | 'bury') {
  if (props.busy || props.editing || grading.value || questionState.busy || !current.value) return
  menuOpen.value = false
  grading.value = true
  try {
    if (await props.change([current.value.id], action)) {
      if (props.mixedCardId) emit('step', false)
      selectNext()
    }
  } finally {
    grading.value = false
  }
}
function keydown(event: KeyboardEvent) {
  // Keys pressed while an IME composition is open are meant for the IME (e.g. typing "e"
  // in pinyin) and must not reveal answers or grade cards.
  if (shortcutBlocked(event)) return
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key === 'Delete'
  ) {
    event.preventDefault()
    deleteCurrent()
    return
  }
  if (
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    props.busy ||
    questionState.busy ||
    grading.value
  )
    return
  if (props.editing) return
  if (event.key.toLowerCase() === 'a' && current.value) {
    event.preventDefault()
    addCurrent()
    return
  }
  if (event.key.toLowerCase() === 'e' && current.value) {
    event.preventDefault()
    editCurrent()
    return
  }
  if (!practice.value && current.value && ['b', 's'].includes(event.key.toLowerCase())) {
    event.preventDefault()
    void changeCurrent(event.key.toLowerCase() === 'b' ? 'bury' : 'suspend')
    return
  }
  if (event.code === 'Space' && current.value && !questionState.busy) {
    if ((event.target as HTMLElement)?.closest('button, summary')) return
    event.preventDefault()
    revealed.value = true
  }
  const value = Number(event.key)
  if (!automatic.value && [1, 2, 3, 4].includes(value) && revealed.value) void grade(value as Grade)
  if (event.key === 'Escape') {
    event.preventDefault()
    if (menuOpen.value) menuOpen.value = false
    else emit('close')
  }
}
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  selectNext()
  window.addEventListener('keydown', keydown)
  timer = setInterval(() => {
    clock.value = new Date()
  }, 10_000)
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', keydown)
  emit('activity', false)
})
</script>

<template>
  <section class="review-space">
    <header v-if="!mixedCardId" class="review-header">
      <UiButton
        variant="ghost"
        class="text-button"
        :disabled="busy || questionState.busy || grading"
        @click="emit('close')"
      >
        <ArrowLeft :size="17" /> {{ study ? t('结束专项练习') : t('结束复习') }}
      </UiButton>
      <span class="muted">{{
        t('已复习 {p0} 次 · 当前待学 {p1} 张', { p0: completed, p1: queue.length })
      }}</span>
    </header>
    <p v-if="study" class="study-banner">
      {{
        t('{p0} 每张卡片本轮练习一次，已暂停或今日暂缓的卡片会跳过。', {
          p0: practice
            ? t('只练习：不保存评分，也不改变复习进度。')
            : t('更新进度：评分会更新复习时间并计入今日学习，不受每日上限限制。'),
        })
      }}
    </p>
    <UProgress
      v-if="!mixedCardId"
      class="mt-5"
      :model-value="
        Math.min(100, (completed / Math.max(startedWith, completed + queue.length, 1)) * 100)
      "
      :aria-label="t('复习')"
    />

    <div class="review-tools">
      <UDropdownMenu
        v-if="current"
        v-model:open="menuOpen"
        :items="menuItems"
        :content="{
          align: 'start',
          onEscapeKeyDown: (event: KeyboardEvent) => event.stopPropagation(),
        }"
      >
        <UiButton
          variant="ghost"
          icon
          class="review-menu"
          :aria-label="t('更多操作')"
          :disabled="actionsLocked"
        >
          <Ellipsis :size="22" />
        </UiButton>
      </UDropdownMenu>
      <UiButton
        variant="ghost"
        v-if="!mixedCardId"
        class="text-button"
        :disabled="busy || questionState.busy || grading || !canUndo"
        @click="undoLast"
      >
        {{ t('撤销上次评分') }}
      </UiButton>
      <template v-if="current && !practice"
        ><UiButton
          variant="ghost"
          class="text-button"
          :disabled="busy || questionState.busy || grading"
          @click="changeCurrent('bury')"
        >
          {{ t('今天暂缓') }}</UiButton
        ><UiButton
          variant="ghost"
          class="text-button"
          :disabled="busy || questionState.busy || grading"
          @click="changeCurrent('suspend')"
        >
          {{ t('暂停此卡') }}
        </UiButton></template
      >
    </div>
    <template v-if="current && plugin">
      <div class="review-context">
        <span class="pill">{{ deck?.name }}</span
        ><span>{{ current.schedule.state === 0 ? t('新卡片') : t('复习卡片') }}</span>
        <span v-if="current.leech" class="status-chip leech">{{ t('顽固卡 · 多次遗忘') }}</span>
      </div>
      <component
        v-for="panel in enabledReviewPanels"
        :is="panel.reviewPanel"
        :key="panel.id"
        :card="current"
        :reviews="library.reviews"
        :revealed="revealed"
      />
      <article
        :key="`${current.id}:${revision}`"
        class="flashcard"
        :class="{ 'plugin-card': current.type === 'plugin' }"
        aria-live="polite"
      >
        <span class="eyebrow">{{ t('问题') }}</span>
        <component
          :is="plugin.showQuestion"
          :key="`${current.id}:${revision}`"
          :card="current"
          :media="library.media"
          :get-media="getMedia"
          :state="questionState"
          :revealed="revealed"
          :workspace-scope="workspaceScope"
          :practices="cardHistory.practices"
          :attempts="cardHistory.attempts"
          :get-attempt="getAttempt"
          :save-attempt="saveAttempt"
        />
        <div
          v-if="revealed"
          class="card-answer"
          :class="{ 'long-content': current.back.length > 300 }"
        >
          <span class="eyebrow">{{ t('答案') }}</span>
          <component
            :is="plugin.showAnswer"
            :card="current"
            :media="library.media"
            :get-media="getMedia"
            :state="questionState"
            :revealed="revealed"
          />
        </div>
        <div v-if="revealed && currentSource" class="review-source">
          <UiButton variant="ghost" type="button" class="text-button" @click="sourceOpen = true">
            {{ t('查看原文') }} · {{ currentSource.title }}</UiButton
          ><SourceContext
            v-if="sourceOpen"
            :source="currentSource"
            :origin="currentOrigin"
            :sources="library.sources"
            :excerpt="current.excerpt"
            :read="getSource"
            :get-media="getMedia"
            @close="sourceOpen = false"
          />
        </div>
        <div v-if="current.tags.length" class="tag-list">
          <span v-for="tag in current.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </article>
      <div v-if="!revealed" class="reveal-action">
        <UiButton
          variant="primary"
          class="button primary"
          :disabled="questionState.busy"
          @click="revealed = true"
        >
          {{ t(current.type === 'plugin' ? '结束作答并查看答案' : '显示答案')
          }}<CornerDownLeft :size="17" /></UiButton
        ><span class="muted">{{ t('或按空格键') }}</span>
      </div>
      <div v-else class="grade-area">
        <p>{{ t('根据回答情况评分') }}</p>
        <template v-if="automatic">
          <p v-if="!questionState.suggestedGrade">
            {{ t('尚无判题结果。可以继续作答，或将本次记为“重来”。') }}
          </p>
          <UiButton
            variant="primary"
            class="button primary"
            :disabled="
              busy ||
              questionState.busy ||
              !questionState.allowedGrades.includes(questionState.suggestedGrade ?? 1)
            "
            @click="grade(questionState.suggestedGrade ?? 1)"
          >
            {{ t('保存评分：{grade}', { grade: t(suggestedName || '重来') }) }}
          </UiButton>
        </template>
        <div v-else class="grade-buttons">
          <UiButton
            variant="rating"
            :tone="item.class"
            v-for="item in grades"
            :key="item.value"
            :class="['grade-button', item.class]"
            :disabled="
              busy ||
              questionState.busy ||
              grading ||
              !questionState.allowedGrades.includes(item.value)
            "
            @click="grade(item.value)"
          >
            <span class="grade-title"
              >{{ t(item.label) }} <kbd>{{ item.value }}</kbd></span
            >
            <small>{{ t(item.hint) }}</small>
            <strong>{{
              practice
                ? t('不改进度')
                : preview && intervalLabel(preview[item.value].card.due, clock)
            }}</strong>
          </UiButton>
        </div>
      </div>
    </template>
    <div v-else class="review-done">
      <div class="done-icon"><Check :size="32" /></div>
      <h1>
        {{
          study
            ? t('本轮练习结束')
            : limited
              ? t('已达到今日上限')
              : completed
                ? t('本轮复习结束')
                : t('暂无待复习卡片')
        }}
      </h1>
      <p v-if="limited">
        {{
          t('还有 {p0} 张卡片因每日上限未加入队列。可明天继续，或调整卡组设置。', { p0: limited })
        }}
      </p>
      <p v-if="study">
        {{
          t('已练习 {p0} 张，其中 {p1} 张选择了重来。{p2}', {
            p0: completed,
            p1: studied.filter((entry) => entry.grade === 1).length,
            p2: practice ? t('学习进度保持不变。') : t('已更新复习时间。'),
          })
        }}
      </p>
      <p v-else>
        {{
          t('本轮完成 {p0} 次复习。{p1}', {
            p0: completed,
            p1: nextCard
              ? t('下一张卡片将在约 {p0} 后到期。', {
                  p0: intervalLabel(new Date(nextCard.schedule.due), clock),
                })
              : '',
          })
        }}
      </p>
      <UiButton variant="primary" class="button primary" @click="emit('close')">
        {{ t('返回') }}<ArrowLeft :size="16" />
      </UiButton>
      <UiButton variant="ghost" v-if="!study" class="text-button" @click="selectNext">
        <RotateCcw :size="15" />{{ t('检查到期卡片') }}
      </UiButton>
    </div>
  </section>
</template>
<style scoped>
.review-menu {
  margin-right: auto;
}
kbd {
  margin-left: auto;
  font: inherit;
  font-size: var(--font-size-meta);
  color: #65785f;
  white-space: nowrap;
}
</style>
