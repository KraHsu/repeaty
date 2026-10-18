<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  Ellipsis,
  Layers,
  LayoutGrid,
  Leaf,
  Pencil,
  Plus,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from '@lucide/vue'
import AppModal from './components/AppModal.vue'
import ReviewSession from './components/ReviewSession.vue'
import NoteEditor from './components/NoteEditor.vue'
import CollectionPanel from './components/CollectionPanel.vue'
import ImportNotes from './components/ImportNotes.vue'
import { parseBackup, type BackupData } from './core/backups'
import type { BatchEdit } from './core/batch'
import type { CardAction } from './core/scheduler'
import { useOffline } from './composables/useOffline'
import { useLibrary } from './composables/useLibrary'
import {
  colors,
  cardViews,
  type CardView,
  type NoteInput,
  type MediaUpload,
  MAX_BACKUP_BYTES,
  type Deck,
  type DeckInput,
  type Grade,
  type Library,
  type SearchFilter,
  type StudySession,
} from './core/model'
import { blockedByLimit, dayKey, dueCards, weekActivity } from './core/scheduler'

const workspace = useLibrary()
const { library, ready, busy, loadError, backups, backupError } = workspace
const offline = useOffline()
const cards = computed(() => cardViews(library.value))
const tab = ref<'overview' | 'cards' | 'data'>('overview')
const selectedDeck = ref('')
const searchQuery = ref('')
const filterState = ref<SearchFilter['state']>('all')
const now = ref(new Date())
const review = ref<{ deckId?: string; study?: StudySession } | null>(null)
const notice = ref<{ text: string; error: boolean } | null>(null)
const modal = ref<'deck' | 'card' | 'confirm' | 'import' | 'bulkImport' | 'snapshot' | null>(null)
const editingId = ref<string>()
const deckForm = reactive<DeckInput>({
  name: '',
  description: '',
  color: 'sage',
  newLimit: 20,
  reviewLimit: 200,
  burySiblings: true,
  leechThreshold: 8,
  desiredRetention: 0.9,
})
const retentionPercent = computed({
  get: () => Math.round(deckForm.desiredRetention * 100),
  set: (value: number) => {
    deckForm.desiredRetention = value / 100
  },
})
const editingNote = computed(() => library.value.notes.find((note) => note.id === editingId.value))
const pendingBackup = ref<BackupData>()
const pendingSnapshot = ref<Library>()
const confirmation = ref<{ title: string; message: string; action: () => Promise<void> }>()
const upload = ref<HTMLInputElement>()
const due = computed(() => dueCards(library.value, now.value))
const limited = computed(() => blockedByLimit(library.value, now.value))
const newCount = computed(() => due.value.filter((card) => card.schedule.state === 0).length)
const todayReviews = computed(() =>
  library.value.reviews.filter((entry) => entry.studyDay === dayKey(now.value)),
)
const activity = computed(() => weekActivity(library.value, now.value))
const maxActivity = computed(() => Math.max(4, ...activity.value.map((day) => day.count)))
const currentDeck = computed(() =>
  library.value.decks.find((deck) => deck.id === selectedDeck.value),
)
const pageTitle = computed(
  () =>
    ({ overview: '学习空间', cards: currentDeck.value?.name ?? '全部卡片', data: '数据与备份' })[
      tab.value
    ],
)

let ticker: ReturnType<typeof setInterval>
let backupTicker: ReturnType<typeof setInterval>
onMounted(() => {
  void workspace.init()
  backupTicker = setInterval(() => {
    void workspace.backupNow()
  }, 60_000)
  ticker = setInterval(() => {
    now.value = new Date()
  }, 10_000)
})
onUnmounted(() => {
  clearInterval(ticker)
  clearInterval(backupTicker)
  void workspace.close()
})

function navigate(next: typeof tab.value) {
  tab.value = next
  review.value = null
  selectedDeck.value = ''
  searchQuery.value = ''
  filterState.value = 'all'
}
function openDeck(deck: Deck) {
  navigate('cards')
  selectedDeck.value = deck.id
}
function editDeck(deck?: Deck) {
  notice.value = null
  editingId.value = deck?.id
  Object.assign(deckForm, {
    name: deck?.name ?? '',
    description: deck?.description ?? '',
    color: deck?.color ?? 'sage',
    newLimit: deck?.newLimit ?? 20,
    reviewLimit: deck?.reviewLimit ?? 200,
    burySiblings: deck?.burySiblings ?? true,
    leechThreshold: deck?.leechThreshold ?? 8,
    desiredRetention: deck?.desiredRetention ?? 0.9,
  })
  modal.value = 'deck'
}
function editCard(card?: CardView) {
  notice.value = null
  if (!library.value.decks.length) {
    editDeck()
    return
  }
  editingId.value = card?.noteId
  modal.value = 'card'
}
function openImport() {
  notice.value = null
  if (!library.value.decks.length) {
    editDeck()
    return
  }
  modal.value = 'bulkImport'
}
async function run(action: () => Promise<void>, message?: string) {
  try {
    await action()
    now.value = new Date()
    notice.value = message ? { text: message, error: false } : null
    return true
  } catch (error) {
    notice.value = {
      text: error instanceof Error ? error.message : '操作失败，请重试。',
      error: true,
    }
    return false
  }
}
async function saveDeck() {
  const isNew = !editingId.value
  if (await run(() => workspace.saveDeck({ ...deckForm }, editingId.value), '卡组已保存')) {
    modal.value = null
    if (isNew) {
      navigate('cards')
      selectedDeck.value = library.value.decks.at(-1)?.id ?? ''
    }
  }
}
async function saveCard(input: NoteInput, assets: MediaUpload[], allowRemove: boolean) {
  return run(
    () => workspace.saveNote(input, editingId.value, assets, allowRemove),
    '笔记与卡片已保存',
  )
}
async function saveSearch(filter: SearchFilter, name: string, id?: string) {
  return run(() => workspace.saveSearch(filter, name, id), '常用筛选已保存')
}
async function deleteSearch(id: string) {
  return run(() => workspace.deleteSearch(id), '常用筛选已删除')
}
function startStudy(study: StudySession) {
  now.value = new Date()
  notice.value = null
  review.value = { study }
}
async function importNotes(notes: NoteInput[], skip: boolean) {
  if (await run(() => workspace.importNotes(notes, skip), '笔记导入完成')) modal.value = null
}
async function changeCards(ids: string[], action: CardAction) {
  return run(() => workspace.changeCards(new Set(ids), action))
}
async function batchEdit(ids: string[], edit: BatchEdit) {
  return run(() => workspace.editNotes(new Set(ids), edit), '笔记已批量更新')
}
async function undoReview() {
  return run(workspace.undo, '已撤销上次评分')
}
function confirmDeleteDeck(deck: Deck) {
  notice.value = null
  const count = cards.value.filter((card) => card.deckId === deck.id).length
  confirmation.value = {
    title: '删除卡组',
    message: `确定删除「${deck.name}」吗？其中的 ${count} 张卡片及对应复习记录也会被删除。会先自动保存快照。`,
    action: async () => {
      await workspace.deleteDeck(deck.id)
      selectedDeck.value = ''
    },
  }
  modal.value = 'confirm'
}
function confirmDeleteNotes(ids: string[]) {
  notice.value = null
  const selected = new Set(ids)
  const count = library.value.cards.filter((card) => selected.has(card.noteId)).length
  confirmation.value = {
    title: '删除笔记',
    message: `确定删除 ${selected.size} 条笔记及其 ${count} 张关联卡片和复习记录吗？会先自动保存快照。`,
    action: () => workspace.deleteNotes(selected),
  }
  modal.value = 'confirm'
}
async function confirmAction() {
  if (confirmation.value && (await run(confirmation.value.action, '已删除'))) modal.value = null
}
function startReview(deckId?: string) {
  now.value = new Date()
  notice.value = null
  review.value = { deckId }
}
async function submitReview(id: string, grade: Grade) {
  return run(() => workspace.review(id, grade, Boolean(review.value?.study?.reschedule)))
}
function deckDue(id: string) {
  return due.value.filter((card) => card.deckId === id).length
}
function deckCards(id: string) {
  return cards.value.filter((card) => card.deckId === id).length
}
async function exportData() {
  await run(async () => {
    const text = await workspace.exportData()
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `repeaty-backup-${now.value.toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, '包含媒体的完整备份已生成')
}
async function openSnapshot(id: string) {
  await run(async () => {
    pendingSnapshot.value = await workspace.getBackup(id)
    modal.value = 'snapshot'
  })
}
async function restoreSnapshot() {
  const data = pendingSnapshot.value
  if (data && (await run(() => workspace.restoreSnapshot(data), '快照已恢复'))) {
    modal.value = null
    selectedDeck.value = ''
    pendingSnapshot.value = undefined
  }
}
async function importData(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  notice.value = null
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 100 MB。')
    pendingBackup.value = parseBackup(await file.text())
    modal.value = 'import'
  } catch (error) {
    notice.value = { text: (error as Error).message, error: true }
  } finally {
    input.value = ''
  }
}
async function restoreBackup() {
  const data = pendingBackup.value
  if (data && (await run(() => workspace.restore(data), '备份已恢复'))) {
    modal.value = null
    pendingBackup.value = undefined
    selectedDeck.value = ''
  }
}
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <a href="#" class="brand" aria-label="Repeaty 首页" @click.prevent="navigate('overview')"
        ><span class="brand-mark"><Repeat2 :size="24" :stroke-width="2.4" /></span>repeaty<span
          class="brand-dot"
          >.</span
        ></a
      >
      <span class="sidebar-label">一点一点，记得更久</span>
      <nav class="main-nav" aria-label="主导航">
        <button
          :class="{ active: tab === 'overview' && !review }"
          :aria-current="tab === 'overview' && !review ? 'page' : undefined"
          @click="navigate('overview')"
        >
          <LayoutGrid :size="19" /> 学习空间
        </button>
        <button
          :class="{ active: tab === 'cards' && !review }"
          :aria-current="tab === 'cards' && !review ? 'page' : undefined"
          @click="navigate('cards')"
        >
          <Layers :size="19" /> 全部卡片 <span class="nav-count">{{ library.cards.length }}</span>
        </button>
        <button
          :class="{ active: tab === 'data' && !review }"
          :aria-current="tab === 'data' && !review ? 'page' : undefined"
          @click="navigate('data')"
        >
          <Database :size="19" /> 数据与备份
        </button>
      </nav>
      <div class="sidebar-decks">
        <div class="sidebar-section-title">
          我的卡组
          <button
            class="icon-button"
            aria-label="新建卡组"
            :disabled="!ready || busy"
            @click="editDeck()"
          >
            <Plus :size="16" />
          </button>
        </div>
        <button
          v-for="deck in library.decks"
          :key="deck.id"
          class="sidebar-deck"
          :class="{ selected: selectedDeck === deck.id }"
          @click="openDeck(deck)"
        >
          <span :class="['color-dot', deck.color]" /><span class="truncate">{{ deck.name }}</span
          ><span>{{ deckCards(deck.id) }}</span>
        </button>
        <p v-if="!library.decks.length" class="sidebar-empty">好奇心，从第一张卡片开始。</p>
      </div>
      <div class="sidebar-bottom">
        <div class="local-status"><span /> 本地学习空间</div>
        <p>让知识留下来。</p>
        <span class="version">REPEATY CORE · 0.3.0</span>
      </div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div class="breadcrumb">
          我的空间 <ChevronRight :size="14" /><strong>{{ review ? '专注复习' : pageTitle }}</strong>
        </div>
        <span class="today-date">{{
          new Intl.DateTimeFormat('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          }).format(now)
        }}</span>
      </header>
      <div
        v-if="notice"
        :class="['notice', { error: notice.error }]"
        :role="notice.error ? 'alert' : 'status'"
      >
        <span>{{ notice.text }}</span
        ><button class="icon-button" aria-label="关闭提示" @click="notice = null">
          <X :size="16" />
        </button>
      </div>

      <section v-if="loadError" class="empty-state">
        <Database :size="36" />
        <h1>本地存储暂不可用</h1>
        <p role="alert">{{ loadError }}</p>
      </section>
      <section v-else-if="!ready" class="empty-state" role="status">
        <Repeat2 :size="32" />
        <p>正在打开你的学习空间…</p>
      </section>
      <ReviewSession
        v-else-if="review"
        :library="library"
        :deck-id="review.deckId"
        :study="review.study"
        :busy="busy"
        :submit="submitReview"
        :undo="undoReview"
        :change="changeCards"
        :get-media="workspace.getMedia"
        @close="review = null"
      />

      <div v-else-if="tab === 'overview'" class="page dashboard">
        <header class="page-heading">
          <div>
            <div class="eyebrow">YOUR DAILY PRACTICE</div>
            <h1>每一次回想，都算数<span class="heading-dot">.</span></h1>
            <p>把好奇变成卡片，把知识留在记忆里。</p>
          </div>
          <button class="button secondary" :disabled="busy" @click="editCard()">
            <Plus :size="17" /> 添加卡片
          </button>
        </header>
        <div class="dashboard-top">
          <section class="daily-card">
            <div class="daily-content">
              <span class="daily-label"><span class="tiny-sun">✳</span> 今日学习</span>
              <h2>
                {{
                  due.length
                    ? '给记忆，一点新的力量。'
                    : library.cards.length
                      ? '让记忆，慢慢沉淀。'
                      : '今天，想记住什么？'
                }}
              </h2>
              <p v-if="due.length">
                {{ due.length - newCount }} 张到期卡片，{{
                  newCount
                }}
                张新卡片。<br />一个小小的开始，就是进步。
              </p>
              <p v-else-if="limited">
                今日额度已完成，还有
                {{ limited }} 张卡片等待下一天。<br />也可以在卡组设置中调整额度。
              </p>
              <p v-else-if="library.cards.length">
                当前没有可学习的卡片。<br />稍作休息，或添加一点新知识。
              </p>
              <p v-else>从一个问题开始。<br />下一次回想，会比这一次更清晰。</p>
              <button
                class="button dark"
                :disabled="busy"
                @click="library.cards.length ? startReview() : editCard()"
              >
                {{
                  due.length ? '开始复习' : library.cards.length ? '查看复习安排' : '创建第一张卡片'
                }}
                <ArrowRight :size="17" />
              </button>
            </div>
            <div class="card-art" aria-hidden="true">
              <div class="art-card art-back" />
              <div class="art-card art-middle" />
              <div class="art-card art-front">
                <span>little by little</span><Leaf :size="49" :stroke-width="1.25" /><strong
                  >a little more<br />stays with you.</strong
                >
                <div class="art-line" />
              </div>
              <span class="art-star">✳</span>
            </div>
          </section>
          <section class="activity-card">
            <div class="section-mini-heading">
              <span>最近 7 天</span><span class="subtle">复习次数</span>
            </div>
            <div class="activity-value">
              {{ activity.reduce((sum, day) => sum + day.count, 0) }}<span>次回想</span
              ><span class="activity-icon"><BookOpen :size="20" /></span>
            </div>
            <div class="activity-chart" aria-label="最近七天复习次数">
              <div
                v-for="(day, i) in activity"
                :key="day.key"
                class="chart-column"
                :title="`${day.label}：${day.count} 次`"
              >
                <div class="bar-track">
                  <div
                    :class="['chart-bar', { today: i === 6 }]"
                    :style="{ height: `${Math.max(5, (day.count / maxActivity) * 100)}%` }"
                  />
                  <span class="sr-only">{{ day.count }} 次</span>
                </div>
                <span>{{ i === 6 ? '今天' : day.label.slice(-1) }}</span>
              </div>
            </div>
          </section>
        </div>

        <div class="stats-strip">
          <div>
            <span class="stat-icon sage"><Layers :size="19" /></span>
            <div>
              <strong>{{ library.cards.length }}</strong
              ><span>卡片总数</span>
            </div>
          </div>
          <div>
            <span class="stat-icon sand"><Repeat2 :size="19" /></span>
            <div>
              <strong>{{ due.length - newCount }}</strong
              ><span>今日可复习</span>
            </div>
          </div>
          <div>
            <span class="stat-icon lavender"><Sparkles :size="19" /></span>
            <div>
              <strong>{{ newCount }}</strong
              ><span>今日可学新卡</span>
            </div>
          </div>
          <div>
            <span class="stat-icon blue"><Check :size="19" /></span>
            <div>
              <strong>{{ todayReviews.length }}</strong
              ><span>今日复习次数</span>
            </div>
          </div>
        </div>

        <section class="decks-section">
          <div class="section-heading">
            <h2>
              我的卡组 <span>{{ library.decks.length }}</span>
            </h2>
            <button class="text-button" :disabled="busy" @click="editDeck()">
              <Plus :size="17" /> 创建卡组
            </button>
          </div>
          <div v-if="library.decks.length" class="deck-grid">
            <article v-for="deck in library.decks" :key="deck.id" class="deck-card">
              <div class="deck-card-top">
                <button
                  :class="['deck-icon', deck.color]"
                  :aria-label="`打开卡组 ${deck.name}`"
                  @click="openDeck(deck)"
                >
                  <Layers :size="22" /></button
                ><button
                  class="icon-button"
                  :aria-label="`编辑卡组 ${deck.name}`"
                  @click="editDeck(deck)"
                >
                  <Ellipsis :size="21" />
                </button>
              </div>
              <button class="deck-title" @click="openDeck(deck)">{{ deck.name }}</button>
              <p>{{ deck.description || '让每一个值得记住的想法，都有自己的位置。' }}</p>
              <div class="deck-card-bottom">
                <span
                  >{{ deckCards(deck.id) }} 张卡片 <span class="divider-dot">·</span>
                  <span :class="{ 'green-text': deckDue(deck.id) }"
                    >{{ deckDue(deck.id) }} 张待学</span
                  ></span
                ><button
                  class="icon-button deck-review"
                  :aria-label="`复习卡组 ${deck.name}`"
                  @click="startReview(deck.id)"
                >
                  <ArrowRight :size="18" />
                </button>
              </div>
            </article>
            <button class="add-deck-tile" @click="editDeck()">
              <Plus :size="24" /><span>新的好奇，新的卡组</span>
            </button>
          </div>
          <div v-else class="welcome-card">
            <div class="welcome-icon"><Layers :size="27" /></div>
            <div>
              <h3>为你的好奇心，留个位置</h3>
              <p>创建第一个卡组，或用 5 张示例卡片体验一次完整复习。</p>
            </div>
            <div class="welcome-actions">
              <button
                class="button secondary"
                :disabled="busy"
                @click="run(workspace.addSample, '示例卡组已添加')"
              >
                体验示例</button
              ><button class="button primary" @click="editDeck()">
                <Plus :size="16" /> 创建卡组
              </button>
            </div>
          </div>
        </section>
        <footer class="learning-tip">
          <CircleHelp :size="17" />
          <p>小提示：先尝试回想，再翻看答案。主动提取，比反复阅读更有帮助。</p>
          <span>KEEP IT SMALL. KEEP IT GOING.</span>
        </footer>
      </div>

      <div v-else-if="tab === 'cards'" class="page">
        <header class="page-heading">
          <div>
            <div class="eyebrow">YOUR KNOWLEDGE, IN CARDS</div>
            <h1>{{ currentDeck?.name ?? '全部卡片' }}</h1>
            <p>{{ currentDeck?.description || '收集值得记住的知识，一张卡片，一个想法。' }}</p>
          </div>
          <div class="heading-actions">
            <button
              v-if="currentDeck"
              class="icon-button"
              aria-label="编辑当前卡组"
              @click="editDeck(currentDeck)"
            >
              <Pencil :size="18" /></button
            ><button
              v-if="currentDeck"
              class="icon-button danger-text"
              aria-label="删除当前卡组"
              @click="confirmDeleteDeck(currentDeck)"
            >
              <Trash2 :size="18" />
            </button>
            <button class="button secondary" @click="openImport">
              <ArrowUpFromLine :size="16" />批量导入
            </button>
            <button class="button primary" @click="editCard()"><Plus :size="17" /> 添加卡片</button>
          </div>
        </header>
        <CollectionPanel
          v-model:deck-id="selectedDeck"
          v-model:query="searchQuery"
          v-model:state="filterState"
          :library="library"
          :now="now"
          :busy="busy"
          :change="changeCards"
          :batch-edit="batchEdit"
          :save-search="saveSearch"
          :delete-search="deleteSearch"
          @study="startStudy"
          @edit="editCard"
          @delete="confirmDeleteNotes"
          @review="startReview(selectedDeck || undefined)"
        />
      </div>

      <div v-else class="page data-page">
        <header class="page-heading">
          <div>
            <div class="eyebrow">A SPACE THAT'S YOURS</div>
            <h1>知识是你的，数据也是。</h1>
            <p>把学习进度好好保存，随时带走。</p>
          </div>
        </header>
        <section class="storage-banner">
          <ShieldCheck :size="29" />
          <div>
            <h2>保存在当前浏览器</h2>
            <p>
              卡片和复习进度保存在当前网站的本地存储中。清除网站数据、更换浏览器或网址后，不会自动保留这些内容，请定期导出备份。
            </p>
          </div>
        </section>
        <div class="backup-grid">
          <section class="backup-card">
            <span class="stat-icon sage"><ArrowDownToLine :size="22" /></span>
            <h2>导出备份</h2>
            <p>将卡组、笔记、卡片、复习进度和图片音频保存为一个完整 JSON 文件。</p>
            <div class="backup-meta">
              {{ library.decks.length }} 个卡组 · {{ library.cards.length }} 张卡片 ·
              {{ library.reviews.length }} 次复习
            </div>
            <button class="button primary" @click="exportData">
              <ArrowDownToLine :size="16" /> 导出 JSON
            </button>
          </section>
          <section class="backup-card">
            <span class="stat-icon lavender"><ArrowUpFromLine :size="22" /></span>
            <h2>恢复备份</h2>
            <p>从 Repeaty 导出的 JSON 文件恢复学习空间，确认后会替换当前数据。</p>
            <div class="backup-meta">JSON 格式 · 最大 100 MB · 兼容旧版备份</div>
            <input
              ref="upload"
              class="sr-only"
              type="file"
              accept=".json,application/json"
              aria-label="导入备份文件"
              @change="importData"
            /><button class="button secondary" @click="upload?.click()">
              <ArrowUpFromLine :size="16" /> 选择备份文件
            </button>
          </section>
        </div>
        <section class="snapshot-section">
          <div class="section-heading">
            <h2>自动快照</h2>
            <button
              class="button secondary"
              :disabled="busy || !library.notes.length"
              @click="run(() => workspace.backupNow(true), '快照已保存；未变化的数据不会重复备份')"
            >
              立即创建快照
            </button>
          </div>
          <p class="form-note">
            打开应用及使用期间每 30 分钟保存变化；删除、编辑、批量修改和恢复前额外保存。保留最近 10
            份，并保留其引用的媒体。快照也在本机，清除网站数据会一并删除。
          </p>
          <p v-if="backupError" role="alert" class="import-warning">{{ backupError }}</p>
          <ul v-if="backups.length" class="snapshot-list">
            <li v-for="backup in backups" :key="backup.id">
              <div>
                <strong>{{ backup.reason }}</strong
                ><span
                  >{{ new Date(backup.createdAt).toLocaleString('zh-CN') }} ·
                  {{ backup.notes }} 条笔记 · {{ backup.cards }} 张卡片</span
                >
              </div>
              <button class="button secondary" :disabled="busy" @click="openSnapshot(backup.id)">
                恢复此快照
              </button>
            </li>
          </ul>
          <p v-else class="form-note">还没有快照。添加内容后可以立即创建，或等待自动保存。</p>
        </section>
        <section class="storage-banner">
          <ShieldCheck :size="24" />
          <div>
            <h2>{{ offline.status.value }}</h2>
            <p>
              生产构建首次联网打开并显示「离线已就绪」后，可断网重新打开、编辑和复习；图片和音频也保存在本地。开发模式不启用离线缓存。
            </p>
            <button
              v-if="offline.updateReady.value"
              class="button secondary"
              :disabled="busy"
              @click="offline.applyUpdate"
            >
              新版本已就绪，刷新更新
            </button>
          </div>
        </section>
        <div class="about-core">
          <Repeat2 :size="21" />
          <div>
            <h3>Repeaty Core</h3>
            <p>制作卡片，主动回忆，按时复习。让学习回到这几件简单的事。</p>
          </div>
          <span class="pill">v0.3.0</span>
        </div>
      </div>
    </main>

    <AppModal
      :error="notice?.error ? notice.text : undefined"
      v-if="modal === 'deck'"
      :title="editingId ? '编辑卡组' : '创建卡组'"
      :busy="busy"
      @close="modal = null"
      ><form class="editor-form" @submit.prevent="saveDeck">
        <label for="deck-name">卡组名称</label
        ><input
          id="deck-name"
          v-model.trim="deckForm.name"
          autofocus
          required
          maxlength="80"
          placeholder="例如：英语词汇、计算机基础…"
        /><label for="deck-description">描述 <span class="optional">可选</span></label
        ><textarea
          id="deck-description"
          v-model.trim="deckForm.description"
          maxlength="300"
          rows="3"
          placeholder="这个卡组里，装着哪些值得记住的知识？"
        />
        <div class="limit-fields">
          <label for="new-limit"
            >每日新卡上限<input
              id="new-limit"
              v-model.number="deckForm.newLimit"
              type="number"
              min="0"
              max="9999"
              required /></label
          ><label for="review-limit"
            >每日复习上限<input
              id="review-limit"
              v-model.number="deckForm.reviewLimit"
              type="number"
              min="0"
              max="9999"
              required
          /></label>
        </div>
        <p class="form-note">
          0 表示不引入该类卡片。当天已开始的学习 / 重学步骤不受额度限制，按本机日历日重置。
        </p>
        <label class="check-line"
          ><input
            v-model="deckForm.burySiblings"
            type="checkbox"
          />评分后自动暂缓同笔记的其他卡片至明天</label
        >
        <div class="limit-fields">
          <label for="leech-threshold"
            >顽固卡遗忘阈值<input
              id="leech-threshold"
              v-model.number="deckForm.leechThreshold"
              type="number"
              min="0"
              max="100"
              required
          /></label>
          <label for="retention"
            >目标记忆保留率（%）<input
              id="retention"
              v-model.number="retentionPercent"
              type="number"
              min="70"
              max="97"
              step="1"
              required
          /></label>
        </div>
        <p class="form-note">
          正式复习遗忘达到阈值后自动标记顽固卡，0 关闭标记。保留率默认
          90%，越高复习越频繁；修改仅影响之后的评分，不立即重排已有卡片。
        </p>
        <fieldset class="color-picker">
          <legend>卡组颜色</legend>
          <label
            v-for="color in colors"
            :key="color"
            :class="['color-option', color, { chosen: deckForm.color === color }]"
            ><input
              v-model="deckForm.color"
              type="radio"
              name="color"
              :value="color"
              :aria-label="
                {
                  sage: '鼠尾草绿',
                  sand: '暖沙色',
                  lavender: '薰衣草紫',
                  blue: '雾蓝色',
                  rose: '蔷薇粉',
                }[color]
              " /><Check v-if="deckForm.color === color" :size="17"
          /></label>
        </fieldset>
        <div class="form-actions">
          <button type="button" class="button secondary" :disabled="busy" @click="modal = null">
            取消</button
          ><button class="button primary" :disabled="busy">
            {{ busy ? '保存中…' : '保存卡组' }}
          </button>
        </div>
      </form></AppModal
    >
    <AppModal
      :error="notice?.error ? notice.text : undefined"
      v-if="modal === 'card'"
      :title="editingId ? '编辑卡片' : '添加卡片'"
      :busy="busy"
      @close="modal = null"
      ><NoteEditor
        :library="library"
        :note="editingNote"
        :deck-id="selectedDeck || undefined"
        :busy="busy"
        :get-media="workspace.getMedia"
        :submit="saveCard"
        @close="modal = null"
    /></AppModal>
    <AppModal
      v-if="modal === 'bulkImport'"
      title="批量导入笔记"
      :busy="busy"
      :error="notice?.error ? notice.text : undefined"
      @close="modal = null"
      ><ImportNotes
        :library="library"
        :deck-id="selectedDeck"
        :busy="busy"
        @import="importNotes"
        @close="modal = null"
    /></AppModal>
    <AppModal
      v-if="modal === 'snapshot' && pendingSnapshot"
      title="恢复自动快照？"
      :busy="busy"
      :error="notice?.error ? notice.text : undefined"
      @close="modal = null"
      ><p class="confirmation-text">
        此快照包含 {{ pendingSnapshot.notes.length }} 条笔记、{{ pendingSnapshot.cards.length }}
        张卡片。恢复会替换当前数据，操作前会为当前数据另存快照。
      </p>
      <div class="form-actions">
        <button class="button secondary" :disabled="busy" @click="modal = null">取消</button
        ><button class="button primary" :disabled="busy" @click="restoreSnapshot">
          确认恢复快照
        </button>
      </div></AppModal
    >
    <AppModal
      :error="notice?.error ? notice.text : undefined"
      v-if="modal === 'confirm' && confirmation"
      :title="confirmation.title"
      :busy="busy"
      @close="modal = null"
      ><p class="confirmation-text">{{ confirmation.message }}</p>
      <div class="form-actions">
        <button class="button secondary" :disabled="busy" @click="modal = null">取消</button
        ><button class="button danger" :disabled="busy" @click="confirmAction">确认删除</button>
      </div></AppModal
    >
    <AppModal
      :error="notice?.error ? notice.text : undefined"
      v-if="modal === 'import' && pendingBackup"
      title="恢复这个备份？"
      :busy="busy"
      @close="modal = null"
      ><p class="confirmation-text">
        文件校验通过，包含 {{ pendingBackup.library.decks.length }} 个卡组、{{
          pendingBackup.library.cards.length
        }}
        张卡片和 {{ pendingBackup.library.reviews.length }} 次复习记录。
      </p>
      <p class="import-warning">
        恢复会替换当前所有卡组、卡片和复习进度。建议先导出当前数据作为备份。
      </p>
      <div class="form-actions">
        <button class="button secondary" :disabled="busy" @click="modal = null">取消</button
        ><button class="button primary" :disabled="busy" @click="restoreBackup">替换并恢复</button>
      </div></AppModal
    >
  </div>
</template>
