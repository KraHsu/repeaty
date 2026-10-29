<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiButton, UiCollapsible } from '../../components/ui'
import AppPage from '../../components/AppPage.vue'
import { t } from '../../i18n'
import { ArrowRight, BookOpen, Check, ChevronDown, Ellipsis, Layers, Plus } from '@lucide/vue'
import { useApplication } from '../context'
import '../../styles/review-deck.css'

const {
  workspace,
  library,
  busy,
  modal,
  selectedDeck,
  navigate,
  startReading,
  openDeck,
  due,
  readyReading,
  readyExcerpts,
  newCount,
  todayReviews,
  activity,
  maxActivity,
  deckCards,
  deckStates,
  run,
  editDeck,
  editCard,
  startReview,
} = useApplication()

// Reuse the application's selected deck, so editing, shortcuts and returning from
// review keep the same object. Library switches already reset this scoped state.
const focusedDeck = computed(
  () =>
    library.value.decks.find((deck) => deck.id === selectedDeck.value) ?? library.value.decks[0],
)
const focusedState = computed(() => focusedDeck.value && deckStates.value.get(focusedDeck.value.id))
const focusStage = ref<HTMLElement>()
let selectionAnimation: Animation | undefined
onBeforeUnmount(() => selectionAnimation?.cancel())
watch(
  focusedDeck,
  (deck) => {
    selectedDeck.value = deck?.id ?? ''
  },
  { immediate: true },
)
function focusDeck(id: string) {
  selectedDeck.value = id
  selectionAnimation?.cancel()
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    selectionAnimation = focusStage.value?.animate(
      [
        { opacity: 0.65, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' },
    )
  }
}
function reviewFocused() {
  if (!focusedDeck.value) return
  selectedDeck.value = focusedDeck.value.id
  startReview(focusedDeck.value.id)
}
function addToFocused() {
  if (focusedDeck.value) selectedDeck.value = focusedDeck.value.id
  editCard()
}
</script>

<template>
  <AppPage class="dashboard b-deck-overview" :title="t('学习概览')">
    <template #description>
      {{ t('{p0} 个卡组 · {p1} 张卡片', { p0: library.decks.length, p1: library.cards.length }) }}
      · {{ t('{p0} 张到期卡片 · {p1} 张新卡片', { p0: due.length - newCount, p1: newCount }) }}
    </template>
    <template v-if="library.decks.length && focusedState?.total !== 0" #actions>
      <UiButton variant="secondary" :disabled="busy" @click="addToFocused">
        <Plus :size="17" />{{ t('添加卡片') }}
      </UiButton>
    </template>

    <section
      v-if="focusedDeck && focusedState"
      ref="focusStage"
      class="b-focus-stage"
      :aria-label="t('当前卡组')"
    >
      <div class="b-stack-layer b-stack-far" aria-hidden="true" />
      <div class="b-stack-layer b-stack-near" aria-hidden="true" />
      <article class="b-focus-card">
        <div class="b-focus-top">
          <span class="b-focus-label"><Layers :size="18" />{{ t('当前卡组') }}</span>
          <UiButton
            variant="ghost"
            icon
            :disabled="busy"
            :aria-label="t('编辑卡组 {p0}', { p0: focusedDeck.name })"
            :title="t('编辑当前卡组')"
            @click="editDeck(focusedDeck)"
          >
            <Ellipsis :size="21" />
          </UiButton>
        </div>
        <h2>{{ focusedDeck.name }}</h2>
        <p v-if="focusedDeck.description" class="b-focus-description">
          {{ focusedDeck.description }}
        </p>
        <p class="b-focus-total">{{ t('{p0} 张卡片', { p0: deckCards(focusedDeck.id) }) }}</p>
        <dl class="b-focus-counts" :aria-label="t('今日可学')">
          <div>
            <dd>{{ focusedState.learningReady + focusedState.reviewReady }}</dd>
            <dt>{{ t('待复习') }}</dt>
          </div>
          <div>
            <dd>{{ focusedState.newReady }}</dd>
            <dt>{{ t('新卡') }}</dt>
          </div>
        </dl>
        <div class="b-focus-state">
          <p v-if="focusedState.learningReady">
            {{ t('其中 {count} 张正在学习', { count: focusedState.learningReady }) }}
          </p>
          <p v-if="focusedState.limited">
            {{ t('另有 {count} 张已达今日额度', { count: focusedState.limited }) }}
          </p>
          <p v-else-if="!focusedState.ready && focusedState.total">{{ t('暂无待学习卡片') }}</p>
          <p v-if="!focusedState.ready && focusedState.future">
            {{ t('稍后到期 {count} 张', { count: focusedState.future }) }}
          </p>
        </div>
        <div class="b-focus-primary">
          <UiButton
            variant="primary"
            class="b-start-review min-h-12 justify-center gap-6 whitespace-nowrap"
            :disabled="busy"
            @click="focusedState.total ? reviewFocused() : addToFocused()"
          >
            {{
              focusedState.ready
                ? t('开始复习')
                : focusedState.total
                  ? t('查看复习安排')
                  : t('添加卡片')
            }}<ArrowRight :size="19" />
          </UiButton>
        </div>
        <UiButton
          variant="ghost"
          class="b-browse-deck"
          :disabled="busy"
          @click="openDeck(focusedDeck)"
        >
          {{ t('浏览卡片') }}<ArrowRight :size="16" />
        </UiButton>
      </article>
    </section>

    <section class="decks-section b-deck-queue">
      <div class="section-heading">
        <h2>
          {{ t('我的卡组') }}<span>{{ library.decks.length }}</span>
        </h2>
        <UiButton v-if="library.decks.length" variant="ghost" :disabled="busy" @click="editDeck()"
          ><Plus :size="17" />{{ t('创建卡组') }}</UiButton
        >
      </div>
      <div v-if="library.decks.length" class="deck-grid b-deck-grid">
        <UiButton
          v-for="deck in library.decks"
          :key="deck.id"
          variant="ghost"
          class="b-deck-tile items-stretch gap-0 rounded-[0.75rem] p-5 whitespace-normal"
          :class="{ selected: focusedDeck?.id === deck.id }"
          :aria-pressed="focusedDeck?.id === deck.id"
          :aria-label="t('选择卡组 {p0}', { p0: deck.name })"
          @click="focusDeck(deck.id)"
        >
          <span class="b-deck-title-row"
            ><Layers :size="18" /><strong class="deck-title">{{ deck.name }}</strong></span
          >
          <span class="b-deck-total">{{ t('{p0} 张卡片', { p0: deckCards(deck.id) }) }}</span>
          <span class="b-deck-counts"
            ><span
              >{{ t('待复习') }}
              <b>{{
                (deckStates.get(deck.id)?.learningReady ?? 0) +
                (deckStates.get(deck.id)?.reviewReady ?? 0)
              }}</b></span
            ><span
              >{{ t('新卡') }} <b>{{ deckStates.get(deck.id)?.newReady ?? 0 }}</b></span
            ><Check v-if="focusedDeck?.id === deck.id" :size="16" aria-hidden="true"
          /></span>
        </UiButton>
      </div>
      <div v-else class="welcome-card b-welcome-card">
        <div class="welcome-icon"><Layers :size="27" /></div>
        <div>
          <h3>{{ t('还没有卡组') }}</h3>
          <p>{{ t('创建自己的卡组，或添加入门卡组。') }}</p>
        </div>
        <div class="welcome-actions">
          <UiButton
            variant="secondary"
            :disabled="busy"
            @click="run(workspace.addSample, '入门卡组已添加')"
            >{{ t('添加入门卡组') }}</UiButton
          >
          <UiButton variant="primary" :disabled="busy" @click="editDeck()"
            ><Plus :size="16" />{{ t('创建卡组') }}</UiButton
          >
        </div>
      </div>
    </section>

    <section
      v-if="library.sources.length"
      class="daily-reading b-reading-band"
      :aria-label="t('今日阅读')"
    >
      <BookOpen :size="23" aria-hidden="true" />
      <div class="b-reading-copy">
        <h2>
          {{
            readyReading.length
              ? t('待阅读 {count} 篇', { count: readyReading.length })
              : t('暂无待阅读材料')
          }}
        </h2>
        <p>
          {{
            t('{originals} 篇原文 · {excerpts} 篇摘录', {
              originals: readyReading.length - readyExcerpts,
              excerpts: readyExcerpts,
            })
          }}
        </p>
      </div>
      <div class="daily-reading-actions">
        <UiButton
          variant="secondary"
          :disabled="busy || (!due.length && !readyReading.length)"
          @click="modal = 'mixed'"
          >{{ t('开始混合学习') }}</UiButton
        >
        <UiButton
          v-if="readyReading.length"
          variant="secondary"
          :disabled="busy"
          @click="startReading"
          >{{ t('开始今日阅读') }}<ArrowRight :size="17"
        /></UiButton>
        <UiButton variant="ghost" :disabled="busy" @click="navigate('sources')">{{
          t('管理学习材料')
        }}</UiButton>
      </div>
    </section>

    <footer class="b-learning-footer">
      <span>{{ t('今日已复习 {count} 次', { count: todayReviews.length }) }}</span>
      <UiCollapsible class="b-activity-details">
        <UiButton variant="ghost" class="b-activity-toggle"
          >{{ t('最近 7 天') }} ·
          {{ t('{p0} 次', { p0: activity.reduce((sum, day) => sum + day.count, 0) })
          }}<ChevronDown :size="16"
        /></UiButton>
        <template #content>
          <div class="activity-chart b-activity-chart" :aria-label="t('最近七天复习次数')">
            <div
              v-for="(day, i) in activity"
              :key="day.key"
              class="chart-column"
              :title="t('{p0}：{p1} 次', { p0: day.label, p1: day.count })"
            >
              <div class="bar-track">
                <div
                  :class="['chart-bar', { today: i === 6 }]"
                  :style="{ height: `${Math.max(5, (day.count / maxActivity) * 100)}%` }"
                />
                <span class="sr-only">{{ t('{p0} 次', { p0: day.count }) }}</span>
              </div>
              <span>{{ i === 6 ? t('今天') : day.label }}</span>
            </div>
          </div>
        </template>
      </UiCollapsible>
    </footer>
  </AppPage>
</template>
