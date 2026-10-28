<script setup lang="ts">
import { vUiButton } from '../../components/ui'
import { t } from '../../i18n'
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  Ellipsis,
  Layers,
  Leaf,
  Plus,
  Repeat2,
  Sparkles,
} from '@lucide/vue'
import DeckStatus from '../../components/DeckStatus.vue'
import { useApplication } from '../context'
const {
  workspace,
  library,
  busy,
  modal,
  navigate,
  startReading,
  openDeck,
  due,
  limited,
  readyReading,
  readyExcerpts,
  newCount,
  todayReviews,
  activity,
  maxActivity,
  deckDue,
  deckCards,
  deckStates,
  run,
  editDeck,
  editCard,
  startReview,
} = useApplication()
</script>
<template>
  <div class="page dashboard">
    <header class="page-heading">
      <div>
        <h1>{{ t('学习概览') }}</h1>
      </div>
      <button v-ui-button class="button secondary" :disabled="busy" @click="editCard()">
        <Plus :size="17" />{{ t('添加卡片') }}
      </button>
    </header>
    <div class="dashboard-top">
      <section class="daily-card">
        <div class="daily-content">
          <span class="daily-label"><span class="tiny-sun">✳</span>{{ t('今日学习') }}</span>
          <h2>
            {{
              due.length
                ? t('待学习 {count} 张', { count: due.length })
                : limited
                  ? t('已达到今日上限')
                  : library.cards.length
                    ? t('暂无待学习卡片')
                    : t('尚未添加卡片')
            }}
          </h2>
          <p v-if="due.length">
            {{
              t('{p0} 张到期卡片 · {p1} 张新卡片', {
                p0: due.length - newCount,
                p1: newCount,
              })
            }}
          </p>
          <p v-else-if="limited">
            {{ t('还有 {p0} 张卡片因每日上限未加入学习队列。', { p0: limited }) }}<br />{{
              t('可在卡组设置中调整上限。')
            }}
          </p>
          <p v-else-if="library.cards.length">
            {{ t('可添加新卡片，或稍后查看复习安排。') }}
          </p>
          <p v-else>
            {{ t('添加卡片后即可开始学习。') }}
          </p>
          <button
            v-ui-button
            class="button dark"
            :disabled="busy"
            @click="library.cards.length ? startReview() : editCard()"
          >
            {{
              due.length ? t('开始复习') : library.cards.length ? t('查看复习安排') : t('添加卡片')
            }}
            <ArrowRight :size="17" />
          </button>
        </div>
        <div class="card-art" aria-hidden="true">
          <div class="art-card art-back" />
          <div class="art-card art-middle" />
          <div class="art-card art-front">
            <Leaf :size="49" :stroke-width="1.25" />
            <div class="art-line" />
          </div>
          <span class="art-star">✳</span>
        </div>
      </section>
      <section class="activity-card">
        <div class="section-mini-heading">
          <span>{{ t('最近 7 天') }}</span
          ><span class="subtle">{{ t('复习次数') }}</span>
        </div>
        <div class="activity-value">
          {{ activity.reduce((sum, day) => sum + day.count, 0) }}<span>{{ t('次复习') }}</span
          ><span class="activity-icon"><BookOpen :size="20" /></span>
        </div>
        <div class="activity-chart" :aria-label="t('最近七天复习次数')">
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
      </section>
    </div>

    <section v-if="library.sources.length" class="daily-reading" :aria-label="t('今日阅读')">
      <div>
        <span class="daily-label">{{ t('今日阅读') }}</span>
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
        <button
          v-ui-button
          class="button secondary"
          :disabled="busy || (!due.length && !readyReading.length)"
          @click="modal = 'mixed'"
        >
          {{ t('开始混合学习') }}
        </button>
        <button
          v-ui-button
          v-if="readyReading.length"
          class="button primary"
          :disabled="busy"
          @click="startReading"
        >
          {{ t('开始今日阅读') }}<ArrowRight :size="17" />
        </button>
        <button v-ui-button class="button secondary" :disabled="busy" @click="navigate('sources')">
          {{ t('管理学习材料') }}
        </button>
      </div>
    </section>
    <div class="stats-strip">
      <div>
        <span class="stat-icon sage"><Layers :size="19" /></span>
        <div>
          <strong>{{ library.cards.length }}</strong
          ><span>{{ t('卡片总数') }}</span>
        </div>
      </div>
      <div>
        <span class="stat-icon sand"><Repeat2 :size="19" /></span>
        <div>
          <strong>{{ due.length - newCount }}</strong
          ><span>{{ t('今日可复习') }}</span>
        </div>
      </div>
      <div>
        <span class="stat-icon lavender"><Sparkles :size="19" /></span>
        <div>
          <strong>{{ newCount }}</strong
          ><span>{{ t('今日可学新卡') }}</span>
        </div>
      </div>
      <div>
        <span class="stat-icon blue"><Check :size="19" /></span>
        <div>
          <strong>{{ todayReviews.length }}</strong
          ><span>{{ t('今日复习次数') }}</span>
        </div>
      </div>
    </div>

    <section class="decks-section">
      <div class="section-heading">
        <h2>
          {{ t('我的卡组') }}<span>{{ library.decks.length }}</span>
        </h2>
        <button v-ui-button class="text-button" :disabled="busy" @click="editDeck()">
          <Plus :size="17" />{{ t('创建卡组') }}
        </button>
      </div>
      <div v-if="library.decks.length" class="deck-grid">
        <article v-for="deck in library.decks" :key="deck.id" class="deck-card">
          <div class="deck-card-top">
            <button
              v-ui-button="{ variant: 'ghost', icon: true }"
              :class="['deck-icon', deck.color]"
              :aria-label="t('打开卡组 {p0}', { p0: deck.name })"
              @click="openDeck(deck)"
            >
              <Layers :size="22" /></button
            ><button
              v-ui-button="{ variant: 'ghost', icon: true }"
              class="icon-button"
              :aria-label="t('编辑卡组 {p0}', { p0: deck.name })"
              @click="editDeck(deck)"
            >
              <Ellipsis :size="21" />
            </button>
          </div>
          <button class="deck-title" @click="openDeck(deck)">{{ deck.name }}</button>
          <p v-if="deck.description">{{ deck.description }}</p>
          <DeckStatus :status="deckStates.get(deck.id)!" compact />
          <div class="deck-card-bottom">
            <span
              >{{ t('{p0} 张卡片', { p0: deckCards(deck.id) }) }}<span class="divider-dot">·</span>
              <span :class="{ 'green-text': deckDue(deck.id) }">{{
                t('{p0} 张待学', { p0: deckDue(deck.id) })
              }}</span></span
            ><button
              v-ui-button="{ variant: 'ghost', icon: true }"
              class="icon-button deck-review"
              :aria-label="t('复习卡组 {p0}', { p0: deck.name })"
              @click="startReview(deck.id)"
            >
              <ArrowRight :size="18" />
            </button>
          </div>
        </article>
        <button v-ui-button class="add-deck-tile" @click="editDeck()">
          <Plus :size="24" /><span>{{ t('新建卡组') }}</span>
        </button>
      </div>
      <div v-else class="welcome-card">
        <div class="welcome-icon"><Layers :size="27" /></div>
        <div>
          <h3>{{ t('还没有卡组') }}</h3>
          <p>{{ t('创建自己的卡组，或添加入门卡组。') }}</p>
        </div>
        <div class="welcome-actions">
          <button
            v-ui-button
            class="button secondary"
            :disabled="busy"
            @click="run(workspace.addSample, '入门卡组已添加')"
          >
            {{ t('添加入门卡组') }}</button
          ><button v-ui-button class="button primary" @click="editDeck()">
            <Plus :size="16" />{{ t('创建卡组') }}
          </button>
        </div>
      </div>
    </section>
    <footer class="learning-tip">
      <CircleHelp :size="17" />
      <p>{{ t('复习快捷键：空格显示答案，1–4 评分，Esc 退出。') }}</p>
    </footer>
  </div>
</template>
