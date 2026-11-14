<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import {
  Layers,
  Repeat2,
  Files,
  BookOpen,
  FolderOpen,
  Archive,
  Puzzle,
  Settings,
  Minus,
  Square,
  X,
  PanelLeft,
  CircleHelp,
  ArrowRight,
  Check,
  Plus,
  ChevronDown,
} from '@lucide/vue'
import { demo, navigate, commit } from './state.js'
import CardsView from './CardsView.vue'
import ReviewView from './ReviewView.vue'
import SettingsView from './SettingsView.vue'
import PluginsView from './PluginsView.vue'
import SourcesView from './SourcesView.vue'
import WorkspaceView from './WorkspaceView.vue'
import BackupView from './BackupView.vue'
import ControlsView from './ControlsView.vue'

const wideNav = ref(false)
const helpOpen = ref(false)
const createOpen = ref(false)
const deckName = ref('')
const deckError = ref('')
const stage = ref(null)
const nav = [
  { id: 'home', label: '卡组', icon: Layers },
  { id: 'cards', label: '全部卡片', icon: Files },
  { id: 'sources', label: '学习材料', icon: BookOpen },
  { id: 'workspace', label: '工作目录', icon: FolderOpen },
  { id: 'backup', label: '数据与备份', icon: Archive },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'settings', label: '设置', icon: Settings },
]
const current = computed(
  () => demo.data.decks.find((d) => d.id === demo.selectedDeck) || demo.data.decks[0],
)
const totals = computed(() =>
  demo.data.decks.reduce(
    (t, d) => ({ count: t.count + d.count, due: t.due + d.due, fresh: t.fresh + d.fresh }),
    { count: 0, due: 0, fresh: 0 },
  ),
)
const views = {
  cards: CardsView,
  review: ReviewView,
  settings: SettingsView,
  plugins: PluginsView,
  sources: SourcesView,
  workspace: WorkspaceView,
  backup: BackupView,
  controls: ControlsView,
}
function selectDeck(id) {
  demo.selectedDeck = id
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    stage.value?.animate(
      [
        { opacity: 0.65, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' },
    )
}
function createDeck() {
  const name = deckName.value.trim()
  if (!name) {
    deckError.value = '请输入卡组名称。'
    return
  }
  if (demo.data.decks.some((d) => d.name === name)) {
    deckError.value = '已有同名卡组，请换一个名称。'
    return
  }
  const id = `deck-${Date.now()}`
  if (commit((data) => data.decks.push({ id, name, count: 0, due: 0, fresh: 0 }), '卡组已创建')) {
    demo.selectedDeck = id
    createOpen.value = false
    deckName.value = ''
    deckError.value = ''
  }
}
watch(
  () => demo.view,
  async () => {
    await nextTick()
    document.querySelector('main')?.scrollTo(0, 0)
  },
)
</script>

<template>
  <div class="app-window">
    <header class="titlebar">
      <div class="window-brand">
        <Repeat2 :size="16" class="window-logo" /><strong>Repeaty</strong><span>个人学习库</span>
      </div>
      <div class="window-chrome" aria-hidden="true">
        <span><Minus :size="16" /></span><span><Square :size="14" /></span
        ><span><X :size="16" /></span>
      </div>
    </header>
    <div class="app-shell" :class="{ 'wide-nav': wideNav }">
      <aside class="nav-rail" aria-label="主导航">
        <PButton
          class="rail-toggle"
          text
          severity="secondary"
          :aria-label="wideNav ? '收起侧栏' : '展开侧栏'"
          :title="wideNav ? '收起侧栏' : '展开侧栏'"
          :aria-expanded="wideNav"
          aria-controls="primary-navigation"
          @click="wideNav = !wideNav"
          ><PanelLeft :size="20"
        /></PButton>
        <nav id="primary-navigation" class="rail-links">
          <template v-for="(item, i) in nav" :key="item.id">
            <hr v-if="i === 3" class="rail-divider" aria-label="学习与管理" />
            <button
              class="rail-link"
              :class="{
                active: demo.view === item.id || (item.id === 'home' && demo.view === 'review'),
                'bottom-start': i === 5,
              }"
              :aria-label="item.label"
              :aria-current="demo.view === item.id ? 'page' : undefined"
              :title="item.label"
              @click="navigate(item.id, item.id === 'cards' ? { cardsDeckFilter: 'all' } : {})"
            >
              <component :is="item.icon" :size="22" /><span class="nav-label">{{
                item.label
              }}</span>
            </button>
          </template>
        </nav>
        <button
          type="button"
          class="rail-link rail-help"
          aria-label="帮助"
          title="帮助"
          @click="helpOpen = true"
        >
          <CircleHelp :size="22" /><span class="nav-label">帮助</span>
        </button>
      </aside>
      <main tabindex="-1">
        <div v-if="demo.view === 'home'" class="home-view">
          <header class="page-head home-head">
            <div class="heading-inline">
              <h1>卡组</h1>
              <span class="meta muted"
                >{{ demo.data.decks.length }} 个卡组 · {{ totals.count }} 张卡片</span
              >
            </div>
            <div class="home-totals">
              <span
                >到期 <b>{{ totals.due }}</b></span
              ><i></i
              ><span
                >新卡 <b>{{ totals.fresh }}</b></span
              >
            </div>
          </header>
          <section v-if="current" class="home-stage" ref="stage" aria-label="当前卡组">
            <div class="stack-back far"></div>
            <div class="stack-back near"></div>
            <article class="focus-card">
              <div class="focus-meta"><Layers :size="18" />当前卡组</div>
              <h2>{{ current.name }}</h2>
              <p class="card-total">{{ current.count }} 张卡片</p>
              <div class="focus-counts">
                <div>
                  <strong>{{ current.due }}</strong
                  ><span>到期</span>
                </div>
                <i></i>
                <div>
                  <strong>{{ current.fresh }}</strong
                  ><span>新卡</span>
                </div>
              </div>
              <div class="focus-action">
                <PButton :disabled="current.due + current.fresh === 0" @click="navigate('review')"
                  >{{
                    current.count === 0
                      ? '暂无卡片'
                      : current.due + current.fresh === 0
                        ? '今日已完成'
                        : '复习此卡组'
                  }}<ArrowRight v-if="current.due + current.fresh > 0" :size="19"
                /></PButton>
              </div>
              <PButton
                text
                class="browse-link"
                @click="navigate('cards', { cardsDeckFilter: current.id })"
                >浏览卡片<ArrowRight :size="16"
              /></PButton>
            </article>
          </section>
          <section class="deck-queue">
            <div class="section-heading">
              <h2>
                全部卡组 <span>{{ demo.data.decks.length }}</span>
              </h2>
              <PButton text severity="secondary" @click="createOpen = true"
                ><Plus :size="18" />新建卡组</PButton
              >
            </div>
            <div class="deck-grid">
              <button
                v-for="deck in demo.data.decks"
                :key="deck.id"
                class="deck-tile"
                :class="{ selected: current?.id === deck.id }"
                :aria-pressed="current?.id === deck.id"
                @click="selectDeck(deck.id)"
              >
                <div class="deck-title">
                  <Layers :size="18" /><strong>{{ deck.name }}</strong>
                </div>
                <div class="deck-total">{{ deck.count }} 张卡片</div>
                <div class="deck-counts">
                  <span
                    >到期 <b>{{ deck.due }}</b></span
                  ><span
                    >新卡 <b>{{ deck.fresh }}</b></span
                  ><Check v-if="current?.id === deck.id" :size="16" />
                </div>
              </button>
            </div>
          </section>
          <footer class="home-footer">
            <span><FolderOpen :size="16" />个人学习库<span class="path">D:\学习\Repeaty</span></span
            ><span>今日已复习 {{ demo.data.reviewCount }} 次</span>
          </footer>
        </div>
        <component v-else :is="views[demo.view]" :key="demo.view" />
      </main>
    </div>
    <Transition name="toast"
      ><div v-if="demo.toast" class="toast-wrap">
        <PMessage :severity="demo.toast.severity" closable @close="demo.toast = null">{{
          demo.toast.message
        }}</PMessage>
      </div></Transition
    >
    <PDialog
      v-model:visible="createOpen"
      header="新建卡组"
      modal
      :style="{ width: '480px' }"
      :breakpoints="{ '600px': '92vw' }"
      ><form @submit.prevent="createDeck">
        <label class="form-label" for="deck-name">卡组名称</label
        ><PInputText
          id="deck-name"
          v-model="deckName"
          autofocus
          :invalid="!!deckError"
          maxlength="80"
          class="full-width"
        />
        <p v-if="deckError" class="error-text">{{ deckError }}</p>
        <PMessage v-if="demo.saveError" severity="error">{{ demo.saveError }}</PMessage>
        <div class="dialog-actions">
          <PButton label="取消" text severity="secondary" @click="createOpen = false" /><PButton
            type="submit"
            label="创建卡组"
          />
        </div></form
    ></PDialog>
    <PDialog
      v-model:visible="helpOpen"
      header="复习快捷键"
      modal
      :style="{ width: '480px' }"
      :breakpoints="{ '600px': '92vw' }"
      ><dl class="shortcut-list">
        <div>
          <dt>显示答案</dt>
          <dd><kbd>空格</kbd></dd>
        </div>
        <div>
          <dt>重来 / 困难 / 良好 / 简单</dt>
          <dd><kbd>1–4</kbd></dd>
        </div>
        <div>
          <dt>退出复习</dt>
          <dd><kbd>Esc</kbd></dd>
        </div>
      </dl>
      <p class="muted">先尝试回忆，再显示答案，按实际回忆情况评分。</p></PDialog
    >
  </div>
</template>
