<script setup lang="ts">
import { version } from '../package.json'
import { t, msg, locale, setLocale, type DisplayMessage } from './i18n'

import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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
  History,
  FileText,
  Layers,
  LayoutGrid,
  Leaf,
  Pencil,
  Plus,
  Puzzle,
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
import type { SourceInput, SourceExcerpt } from './core/source-data'
import PluginPanel from './components/PluginPanel.vue'
import { remoteWorkspace, desktopEdition } from './edition'
import { ServerConnection, AccountControls, createExportFile } from '@repeaty-platform'
import { canReviewCard, listenPluginPreferences } from './plugins'
import type { BackupData } from './core/backups'
import type { BatchEdit } from './core/batch'
import type { AnkiImportPlan, AnkiSelection } from './core/anki/changes'
import type { CardAction } from './core/scheduler'
import { useOffline } from './composables/useOffline'
import { useLibrary } from './composables/useLibrary'
import {
  colors,
  cardViews,
  type CardView,
  type NoteInput,
  type MediaUpload,
  type Deck,
  type DeckInput,
  type Grade,
  type Library,
  type SearchFilter,
  type StudySession,
} from './core/model'
import { blockedByLimit, dayKey, dueCards, weekActivity } from './core/scheduler'
const SourcePanel = defineAsyncComponent(() => import('./components/SourcePanel.vue'))
const PracticeHistoryPanel = defineAsyncComponent(
  () => import('./components/PracticeHistoryPanel.vue'),
)

const workspace = useLibrary()
const { library, ready, busy, loadError, backups, backupError } = workspace
const offline = useOffline()
const cards = computed(() => cardViews(library.value))
const tab = ref<'overview' | 'cards' | 'history' | 'plugins' | 'data' | 'sources'>('overview')
const historyCardId = ref('')
watch(workspace.scope, () => {
  historyCardId.value = ''
  sourceDraft.value = undefined
  modal.value = null
  review.value = null
})
const selectedDeck = ref('')
const searchQuery = ref('')
const filterState = ref<SearchFilter['state']>('all')
const now = ref(new Date())
const review = ref<{ deckId?: string; study?: StudySession } | null>(null)
const notice = ref<{ text: DisplayMessage; error: boolean } | null>(null)
const modal = ref<'deck' | 'card' | 'confirm' | 'import' | 'bulkImport' | 'snapshot' | null>(null)
const editingId = ref<string>()
const sourceDraft = ref<Partial<NoteInput>>()
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
const confirmation = ref<{ title: string; message: DisplayMessage; action: () => Promise<void> }>()
const upload = ref<HTMLInputElement>()
const due = computed(() => dueCards(library.value, now.value, undefined, canReviewCard))
const limited = computed(() => blockedByLimit(library.value, now.value, undefined, canReviewCard))
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
    ({
      overview: t('学习概览'),
      cards: currentDeck.value?.name ?? t('全部卡片'),
      data: t('数据与备份'),
      plugins: t('插件'),
      history: t('练习历史'),
      sources: t('学习材料'),
    })[tab.value],
)

let stopPluginPreferences: (() => void) | undefined
let ticker: ReturnType<typeof setInterval>
let backupTicker: ReturnType<typeof setInterval>
onMounted(() => {
  stopPluginPreferences = listenPluginPreferences()
  void workspace.init()
  backupTicker = setInterval(() => {
    void workspace.backupNow()
  }, 60_000)
  ticker = setInterval(() => {
    now.value = new Date()
  }, 10_000)
})
onUnmounted(() => {
  stopPluginPreferences?.()
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
  historyCardId.value = ''
}
function openHistory(card?: CardView) {
  navigate('history')
  historyCardId.value = card?.id ?? ''
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
  sourceDraft.value = undefined
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
      text: error instanceof Error ? error : '操作失败，请重试。',
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
    () =>
      sourceDraft.value?.excerpt
        ? workspace.saveExcerptNote(
            input,
            sourceDraft.value.excerpt,
            workspace.scope.value,
            assets,
            allowRemove,
          )
        : workspace.saveNote(input, editingId.value, assets, allowRemove),
    '笔记与卡片已保存',
  )
}
async function saveSource(input: SourceInput, scope: string) {
  return run(() => workspace.saveSource(input, scope), '材料已保存')
}
async function deleteSource(id: string, scope: string) {
  return run(() => workspace.deleteSource(id, scope), '材料已删除')
}
function createFromExcerpt(excerpt: SourceExcerpt, format: 'plain' | 'markdown') {
  notice.value = null
  editingId.value = undefined
  sourceDraft.value = { excerpt, back: excerpt.quote, format }
  modal.value = 'card'
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
async function importAnki(
  plan: AnkiImportPlan,
  selection: AnkiSelection,
  deckId: string,
  scope: string,
) {
  return run(() => workspace.importAnki(plan, selection, deckId, scope), 'Anki 笔记导入完成')
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
    message: msg(
      '确定删除「{name}」吗？其中的 {count} 张卡片及对应复习记录也会被删除。会先自动保存快照。',
      { name: deck.name, count },
    ),
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
    message: msg('确定删除 {notes} 条笔记及其 {cards} 张关联卡片和复习记录吗？会先自动保存快照。', {
      notes: selected.size,
      cards: count,
    }),
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
async function submitReview(
  id: string,
  grade: Grade,
  assessment?: import('./plugins/data').Assessment,
  practiceId?: string,
) {
  return run(() =>
    workspace.review(id, grade, Boolean(review.value?.study?.reschedule), assessment, practiceId),
  )
}
function deckDue(id: string) {
  return due.value.filter((card) => card.deckId === id).length
}
function deckCards(id: string) {
  return cards.value.filter((card) => card.deckId === id).length
}
const transfer = ref<{ label: string; percent: number }>()
let transferController: AbortController | undefined
const filePicker = (
  window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }
).showSaveFilePicker?.bind(window)
function cancelTransfer() {
  transferController?.abort(new DOMException('Canceled', 'AbortError'))
}
async function exportData(format: 'archive' | 'json' | 'file' = 'archive') {
  if (transfer.value || busy.value) return
  const filename = `repeaty-backup-${now.value.toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'repeaty'}`
  let writable: WritableStream<Uint8Array> | undefined
  try {
    if (createExportFile) writable = await createExportFile(filename)
    else if (format === 'file' && filePicker) {
      const handle = await filePicker({
        suggestedName: filename,
        types: [{ description: 'Repeaty backup', accept: { 'application/zip': ['.repeaty'] } }],
      })
      writable = await handle.createWritable()
    }
    transferController = new AbortController()
    transfer.value = { label: '正在导出备份…', percent: 0 }
    const blob =
      format === 'json'
        ? new Blob([await workspace.exportData()], { type: 'application/json' })
        : await workspace.exportArchive({
            writable,
            signal: transferController.signal,
            progress: (percent) => {
              if (transfer.value) transfer.value.percent = percent
            },
          })
    if (blob && writable) await blob.stream().pipeTo(writable)
    else if (blob) {
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    notice.value = { text: '包含媒体的完整备份已生成', error: false }
  } catch (error) {
    await writable?.abort().catch(() => {})
    notice.value =
      error instanceof DOMException && error.name === 'AbortError'
        ? { text: '已取消备份操作', error: false }
        : { text: error as Error, error: true }
  } finally {
    transfer.value = undefined
    transferController = undefined
  }
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
    transferController = new AbortController()
    transfer.value = { label: '正在检查备份…', percent: 0 }
    const { parseBackupFile } = await import('./core/archive')
    pendingBackup.value = await parseBackupFile(file, {
      signal: transferController.signal,
      progress: (percent) => {
        if (transfer.value) transfer.value.percent = percent
      },
    })
    modal.value = 'import'
  } catch (error) {
    notice.value =
      error instanceof DOMException && error.name === 'AbortError'
        ? { text: '已取消备份操作', error: false }
        : { text: error as Error, error: true }
  } finally {
    transfer.value = undefined
    transferController = undefined
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
      <a
        href="#"
        class="brand"
        :aria-label="t('Repeaty 首页')"
        @click.prevent="navigate('overview')"
        ><span class="brand-mark"><Repeat2 :size="24" :stroke-width="2.4" /></span>repeaty<span
          class="brand-dot"
          >.</span
        ></a
      >
      <span class="sidebar-label">{{ t('间隔复习') }}</span>
      <nav class="main-nav" :aria-label="t('主导航')">
        <button
          :class="{ active: tab === 'overview' && !review }"
          :aria-current="tab === 'overview' && !review ? 'page' : undefined"
          @click="navigate('overview')"
        >
          <LayoutGrid :size="19" />{{ t('学习概览') }}
        </button>
        <button
          :class="{ active: tab === 'cards' && !review }"
          :aria-current="tab === 'cards' && !review ? 'page' : undefined"
          @click="navigate('cards')"
        >
          <Layers :size="19" />{{ t('全部卡片')
          }}<span class="nav-count">{{ library.cards.length }}</span>
        </button>
        <button
          :class="{ active: tab === 'sources' && !review }"
          :aria-current="tab === 'sources' && !review ? 'page' : undefined"
          @click="navigate('sources')"
        >
          <FileText :size="19" />{{ t('学习材料') }}
        </button>
        <button
          v-if="desktopEdition || library.practices.length"
          :class="{ active: tab === 'history' && !review }"
          :aria-current="tab === 'history' && !review ? 'page' : undefined"
          @click="openHistory()"
        >
          <History :size="19" />{{ t('练习历史') }}
        </button>
        <button
          :class="{ active: tab === 'plugins' && !review }"
          :aria-current="tab === 'plugins' && !review ? 'page' : undefined"
          @click="navigate('plugins')"
        >
          <Puzzle :size="19" />{{ t('插件') }}
        </button>
        <button
          :class="{ active: tab === 'data' && !review }"
          :aria-current="tab === 'data' && !review ? 'page' : undefined"
          @click="navigate('data')"
        >
          <Database :size="19" />{{ t('数据与备份') }}
        </button>
      </nav>
      <div class="sidebar-decks">
        <div class="sidebar-section-title">
          {{ t('我的卡组')
          }}<button
            class="icon-button"
            :aria-label="t('新建卡组')"
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
        <p v-if="!library.decks.length" class="sidebar-empty">
          {{ t('暂无卡组') }}
        </p>
      </div>
      <div class="sidebar-bottom">
        <div class="local-status">
          <span />{{ t(remoteWorkspace ? 'SQLite 存储' : '本地存储') }}
        </div>
        <p>
          {{
            t(
              remoteWorkspace
                ? '后端版'
                : desktopEdition
                  ? '桌面版 · 本地学习库'
                  : '仅限当前浏览器',
            )
          }}
        </p>
        <span class="version">Repeaty {{ version }}</span>
      </div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div class="breadcrumb">
          Repeaty<ChevronRight :size="14" /><strong>{{ review ? t('复习') : pageTitle }}</strong>
        </div>
        <div class="topbar-tools">
          <component v-if="AccountControls" :is="AccountControls" />
          <label class="language-picker"
            ><span class="sr-only">{{ t('界面语言') }}</span
            ><select
              :value="locale"
              @change="
                setLocale(($event.target as HTMLSelectElement).value === 'en' ? 'en' : 'zh-CN')
              "
            >
              <option value="en">English</option>
              <option value="zh-CN">中文（简体）</option>
            </select></label
          ><span class="today-date">{{
            new Intl.DateTimeFormat(locale, {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            }).format(now)
          }}</span>
        </div>
      </header>
      <div
        v-if="notice"
        :class="['notice', { error: notice.error }]"
        :role="notice.error ? 'alert' : 'status'"
      >
        <span>{{ t(notice.text) }}</span
        ><button class="icon-button" :aria-label="t('关闭提示')" @click="notice = null">
          <X :size="16" />
        </button>
      </div>

      <section v-if="loadError" class="empty-state">
        <Database :size="36" />
        <h1>{{ t(remoteWorkspace ? '无法连接服务' : '本地存储暂不可用') }}</h1>
        <p role="alert">{{ t(loadError) }}</p>
        <ServerConnection v-if="remoteWorkspace" :busy="busy" @connect="workspace.init()" />
      </section>
      <section v-else-if="!ready" class="empty-state" role="status">
        <Repeat2 :size="32" />
        <p>{{ t('正在加载…') }}</p>
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
        :workspace-scope="workspace.scope.value"
        :save-attempt="workspace.recordAttempt"
        :get-attempt="workspace.getAttempt"
        :get-source="workspace.getSource"
        :finish-practice="
          (id, cardId, assessment) => run(() => workspace.finishPractice(id, cardId, assessment))
        "
        @close="review = null"
      />

      <div v-else-if="tab === 'overview'" class="page dashboard">
        <header class="page-heading">
          <div>
            <h1>{{ t('学习概览') }}</h1>
          </div>
          <button class="button secondary" :disabled="busy" @click="editCard()">
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
                class="button dark"
                :disabled="busy"
                @click="library.cards.length ? startReview() : editCard()"
              >
                {{
                  due.length
                    ? t('开始复习')
                    : library.cards.length
                      ? t('查看复习安排')
                      : t('添加卡片')
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
            <button class="text-button" :disabled="busy" @click="editDeck()">
              <Plus :size="17" />{{ t('创建卡组') }}
            </button>
          </div>
          <div v-if="library.decks.length" class="deck-grid">
            <article v-for="deck in library.decks" :key="deck.id" class="deck-card">
              <div class="deck-card-top">
                <button
                  :class="['deck-icon', deck.color]"
                  :aria-label="t('打开卡组 {p0}', { p0: deck.name })"
                  @click="openDeck(deck)"
                >
                  <Layers :size="22" /></button
                ><button
                  class="icon-button"
                  :aria-label="t('编辑卡组 {p0}', { p0: deck.name })"
                  @click="editDeck(deck)"
                >
                  <Ellipsis :size="21" />
                </button>
              </div>
              <button class="deck-title" @click="openDeck(deck)">{{ deck.name }}</button>
              <p v-if="deck.description">{{ deck.description }}</p>
              <div class="deck-card-bottom">
                <span
                  >{{ t('{p0} 张卡片', { p0: deckCards(deck.id) })
                  }}<span class="divider-dot">·</span>
                  <span :class="{ 'green-text': deckDue(deck.id) }">{{
                    t('{p0} 张待学', { p0: deckDue(deck.id) })
                  }}</span></span
                ><button
                  class="icon-button deck-review"
                  :aria-label="t('复习卡组 {p0}', { p0: deck.name })"
                  @click="startReview(deck.id)"
                >
                  <ArrowRight :size="18" />
                </button>
              </div>
            </article>
            <button class="add-deck-tile" @click="editDeck()">
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
                class="button secondary"
                :disabled="busy"
                @click="run(workspace.addSample, '入门卡组已添加')"
              >
                {{ t('添加入门卡组') }}</button
              ><button class="button primary" @click="editDeck()">
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

      <div v-else-if="tab === 'cards'" class="page">
        <header class="page-heading">
          <div>
            <h1>{{ currentDeck?.name ?? t('全部卡片') }}</h1>
            <p>{{ currentDeck?.description || t('搜索、编辑卡片，或批量调整卡组和标签。') }}</p>
          </div>
          <div class="heading-actions">
            <button
              v-if="currentDeck"
              class="icon-button"
              :aria-label="t('编辑当前卡组')"
              @click="editDeck(currentDeck)"
            >
              <Pencil :size="18" /></button
            ><button
              v-if="currentDeck"
              class="icon-button danger-text"
              :aria-label="t('删除当前卡组')"
              @click="confirmDeleteDeck(currentDeck)"
            >
              <Trash2 :size="18" />
            </button>
            <button class="button secondary" @click="openImport">
              <ArrowUpFromLine :size="16" />{{ t('批量导入') }}
            </button>
            <button class="button primary" @click="editCard()">
              <Plus :size="17" />{{ t('添加卡片') }}
            </button>
          </div>
        </header>
        <CollectionPanel
          :query-cards="workspace.queryCards"
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
          @history="openHistory"
        />
      </div>

      <PracticeHistoryPanel
        v-else-if="tab === 'history'"
        :key="workspace.scope.value"
        v-model:card-id="historyCardId"
        :library="library"
        :get-attempt="workspace.getAttempt"
        @reveal="(id) => run(() => workspace.revealPracticeHistory(id, workspace.scope.value))"
      />

      <SourcePanel
        v-else-if="tab === 'sources'"
        :key="workspace.scope.value"
        :library="library"
        :busy="busy"
        :scope="workspace.scope.value"
        :read="workspace.getSource"
        :save="saveSource"
        :remove="deleteSource"
        :action-error="notice?.error ? t(notice.text) : undefined"
        @create="createFromExcerpt"
        @edit="(id) => editCard(cards.find((card) => card.noteId === id))"
        @clear-notice="notice = null"
      />

      <PluginPanel v-else-if="tab === 'plugins'" />

      <div v-else class="page data-page">
        <header class="page-heading">
          <div>
            <h1>{{ t('数据与备份') }}</h1>
            <p>
              {{
                t(
                  remoteWorkspace
                    ? '导出、恢复备份，管理服务中的数据。'
                    : '导出、恢复备份，管理本地数据。',
                )
              }}
            </p>
          </div>
        </header>
        <section class="storage-banner">
          <ShieldCheck :size="29" />
          <div>
            <h2>
              {{
                t(
                  remoteWorkspace
                    ? '保存在服务的 SQLite 数据库中'
                    : desktopEdition
                      ? '保存在本机应用中'
                      : '保存在当前浏览器',
                )
              }}
            </h2>
            <p>
              {{
                t(
                  remoteWorkspace
                    ? '卡组、卡片、复习记录和附件保存在部署的服务中。定期导出备份，或备份服务器上的 SQLite 数据库。'
                    : desktopEdition
                      ? '本地学习库保存在此设备。更换设备或卸载前，请先导出备份。'
                      : '数据仅保存在当前浏览器，不会自动同步。清除网站数据会删除卡片和复习记录。更换浏览器或网址前，请先导出备份。',
                )
              }}
            </p>
          </div>
        </section>
        <div v-if="transfer" class="transfer-status" role="status">
          <span>{{ t(transfer.label) }} {{ Math.floor(transfer.percent) }}%</span>
          <progress :value="transfer.percent" max="100" :aria-label="t(transfer.label)" />
          <button class="button secondary" @click="cancelTransfer">{{ t('取消传输') }}</button>
        </div>
        <div class="backup-grid">
          <section class="backup-card">
            <span class="stat-icon sage"><ArrowDownToLine :size="22" /></span>
            <h2>{{ t('导出备份') }}</h2>
            <p>{{ t('导出全部学习数据，包含卡组、卡片、复习记录、图片和音频。') }}</p>
            <p v-if="library.sources.length" class="form-note">
              {{ t('学习材料和原文快照也包含在完整备份中。') }}
            </p>
            <div class="backup-meta">
              {{
                t('{p0} 个卡组 · {p1} 张卡片 · {p2} 次复习', {
                  p0: library.decks.length,
                  p1: library.cards.length,
                  p2: library.reviews.length,
                })
              }}
            </div>
            <div class="backup-actions">
              <button class="button primary" :disabled="busy || !!transfer" @click="exportData()">
                <ArrowDownToLine :size="16" />{{ t('导出 .repeaty') }}
              </button>
              <button
                v-if="filePicker"
                class="button secondary"
                :disabled="busy || !!transfer"
                @click="exportData('file')"
              >
                {{ t('直接保存到文件') }}
              </button>
              <button
                class="text-button"
                :disabled="busy || !!transfer"
                @click="exportData('json')"
              >
                {{ t('导出旧版 JSON') }}
              </button>
            </div>
            <p v-if="filePicker" class="form-note">
              {{ t('大备份可直接写入文件，减少内存占用。') }}
            </p>
          </section>
          <section class="backup-card">
            <span class="stat-icon lavender"><ArrowUpFromLine :size="22" /></span>
            <h2>{{ t('恢复备份') }}</h2>
            <p>{{ t('支持 .repeaty 备份包和旧版 JSON。检查完成并确认后才会替换当前数据。') }}</p>
            <div class="backup-meta">{{ t('.repeaty 最大 2 GB · 旧版 JSON 最大 100 MB') }}</div>
            <input
              ref="upload"
              class="sr-only"
              type="file"
              accept=".repeaty,.zip,.json,application/zip,application/json"
              :aria-label="t('导入备份文件')"
              @change="importData"
            /><button
              class="button secondary"
              :disabled="busy || !!transfer"
              @click="upload?.click()"
            >
              <ArrowUpFromLine :size="16" />{{ t('选择备份文件') }}
            </button>
          </section>
        </div>
        <section class="storage-banner">
          <BookOpen :size="24" />
          <div>
            <h2>{{ t('FSRS 与 Repeaty 入门') }}</h2>
            <p>
              {{
                t(
                  '通过 24 条笔记学习评分、复习和制卡。按当前界面语言添加一份，已有卡片和进度会保留。',
                )
              }}
            </p>
            <button
              class="button secondary"
              :disabled="busy || !!transfer"
              @click="run(workspace.addSample, '入门卡组已添加')"
            >
              {{ t('添加入门卡组') }}
            </button>
          </div>
        </section>
        <section class="snapshot-section">
          <div class="section-heading">
            <h2>{{ t('自动快照') }}</h2>
            <button
              class="button secondary"
              :disabled="busy || !library.notes.length"
              @click="run(() => workspace.backupNow(true), '快照已保存；未变化的数据不会重复备份')"
            >
              {{ t('立即创建快照') }}
            </button>
          </div>
          <p class="form-note">
            {{
              t(
                remoteWorkspace
                  ? '有数据变化时每 30 分钟保存快照；编辑、删除和恢复前也会保存。服务保留最近 10 份快照及其附件。'
                  : '有数据变化时，在打开应用及使用期间每 30 分钟保存快照；编辑、删除、批量操作和恢复前也会保存。保留最近 10 份及其图片和音频。清除网站数据也会删除快照。',
              )
            }}
          </p>
          <p v-if="backupError" role="alert" class="import-warning">{{ t(backupError) }}</p>
          <ul v-if="backups.length" class="snapshot-list">
            <li v-for="backup in backups" :key="backup.id">
              <div>
                <strong>{{ t(backup.reason) }}</strong
                ><span>{{
                  t('{p0} · {p1} 条笔记 · {p2} 张卡片', {
                    p0: new Date(backup.createdAt).toLocaleString(locale),
                    p1: backup.notes,
                    p2: backup.cards,
                  })
                }}</span>
              </div>
              <button class="button secondary" :disabled="busy" @click="openSnapshot(backup.id)">
                {{ t('恢复此快照') }}
              </button>
            </li>
          </ul>
          <p v-else class="form-note">
            {{ t('暂无快照。添加卡片后可手动创建，也会自动保存。') }}
          </p>
        </section>
        <section class="storage-banner">
          <ShieldCheck :size="24" />
          <div>
            <h2>{{ t(offline.status.value) }}</h2>
            <p>
              {{
                t(
                  remoteWorkspace
                    ? '此版本需要连接服务才能读取和保存学习数据。需要离线使用时，可导出备份并导入静态版。'
                    : '首次联网加载完成后，可离线打开、制卡和复习。已保存的图片和音频也可离线使用。',
                )
              }}
            </p>
            <button
              v-if="offline.updateReady.value"
              class="button secondary"
              :disabled="busy"
              @click="offline.applyUpdate"
            >
              {{ t('刷新以更新版本') }}
            </button>
          </div>
        </section>
        <div class="about-core">
          <Repeat2 :size="21" />
          <div>
            <h3>Repeaty</h3>
            <p>
              {{
                t(
                  remoteWorkspace
                    ? '使用 FSRS 安排复习，数据保存在服务中。'
                    : '使用 FSRS 安排复习，数据保存在当前浏览器。',
                )
              }}
            </p>
          </div>
          <span class="pill">v{{ version }}</span>
        </div>
      </div>
    </main>

    <AppModal
      :error="notice?.error ? t(notice.text) : undefined"
      v-if="modal === 'deck'"
      :title="editingId ? t('编辑卡组') : t('创建卡组')"
      :busy="busy"
      @close="modal = null"
      ><form class="editor-form" @submit.prevent="saveDeck">
        <label for="deck-name">{{ t('卡组名称') }}</label
        ><input
          id="deck-name"
          v-model.trim="deckForm.name"
          autofocus
          required
          maxlength="80"
          :placeholder="t('例如：英语词汇、计算机基础…')"
        /><label for="deck-description"
          >{{ t('描述') }}<span class="optional">{{ t('可选') }}</span></label
        ><textarea
          id="deck-description"
          v-model.trim="deckForm.description"
          maxlength="300"
          rows="3"
          :placeholder="t('卡组内容或用途')"
        />
        <div class="limit-fields">
          <label for="new-limit"
            >{{ t('每日新卡上限')
            }}<input
              id="new-limit"
              v-model.number="deckForm.newLimit"
              type="number"
              min="0"
              max="9999"
              required /></label
          ><label for="review-limit"
            >{{ t('每日复习上限')
            }}<input
              id="review-limit"
              v-model.number="deckForm.reviewLimit"
              type="number"
              min="0"
              max="9999"
              required
          /></label>
        </div>
        <p class="form-note">
          {{ t('每日上限按本机日期重置。设为 0 则不安排该类卡片；学习和重学步骤不受此限制。') }}
        </p>
        <label class="check-line"
          ><input v-model="deckForm.burySiblings" type="checkbox" />{{
            t('评分后自动暂缓同笔记的其他卡片至明天')
          }}</label
        >
        <div class="limit-fields">
          <label for="leech-threshold"
            >{{ t('顽固卡遗忘阈值')
            }}<input
              id="leech-threshold"
              v-model.number="deckForm.leechThreshold"
              type="number"
              min="0"
              max="100"
              required
          /></label>
          <label for="retention"
            >{{ t('目标记忆保留率（%）')
            }}<input
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
          {{
            t(
              '复习时遗忘达到指定次数，会标记为顽固卡；设为 0 关闭。目标保留率默认 90%，越高则复习越频繁。修改仅影响后续评分。',
            )
          }}
        </p>
        <fieldset class="color-picker">
          <legend>{{ t('卡组颜色') }}</legend>
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
                  sage: t('鼠尾草绿'),
                  sand: t('暖沙色'),
                  lavender: t('薰衣草紫'),
                  blue: t('雾蓝色'),
                  rose: t('蔷薇粉'),
                }[color]
              " /><Check v-if="deckForm.color === color" :size="17"
          /></label>
        </fieldset>
        <div class="form-actions">
          <button type="button" class="button secondary" :disabled="busy" @click="modal = null">
            {{ t('取消') }}</button
          ><button class="button primary" :disabled="busy">
            {{ busy ? t('保存中…') : t('保存卡组') }}
          </button>
        </div>
      </form></AppModal
    >
    <AppModal
      :error="notice?.error ? t(notice.text) : undefined"
      v-if="modal === 'card'"
      wide
      :title="editingId ? t('编辑卡片') : t('添加卡片')"
      :busy="busy"
      @close="modal = null"
      ><NoteEditor
        :library="library"
        :note="editingNote"
        :initial="sourceDraft"
        :deck-id="selectedDeck || undefined"
        :busy="busy"
        :get-media="workspace.getMedia"
        :submit="saveCard"
        @close="modal = null"
    /></AppModal>
    <AppModal
      v-if="modal === 'bulkImport'"
      :key="workspace.scope.value"
      wide
      :title="t('批量导入笔记')"
      :busy="busy"
      :error="notice?.error ? t(notice.text) : undefined"
      @close="modal = null"
      ><ImportNotes
        :library="library"
        :deck-id="selectedDeck"
        :busy="busy"
        :import-anki="importAnki"
        :preview-anki="workspace.previewAnki"
        :get-media="workspace.getMedia"
        :workspace-scope="workspace.scope.value"
        @import="importNotes"
        @close="modal = null"
    /></AppModal>
    <AppModal
      v-if="modal === 'snapshot' && pendingSnapshot"
      :title="t('恢复此快照？')"
      :busy="busy"
      :error="notice?.error ? t(notice.text) : undefined"
      @close="modal = null"
      ><p class="confirmation-text">
        {{
          t('包含 {p0} 条笔记、{p1} 张卡片。恢复会替换当前数据。操作前会保存当前数据的快照。', {
            p0: pendingSnapshot.notes.length,
            p1: pendingSnapshot.cards.length,
          })
        }}
      </p>
      <p v-if="pendingSnapshot.sources.length" class="confirmation-text">
        {{
          t('还包含 {count} 份学习材料及其原文快照。', { count: pendingSnapshot.sources.length })
        }}
      </p>
      <div class="form-actions">
        <button class="button secondary" :disabled="busy" @click="modal = null">
          {{ t('取消') }}</button
        ><button class="button primary" :disabled="busy" @click="restoreSnapshot">
          {{ t('确认恢复快照') }}
        </button>
      </div></AppModal
    >
    <AppModal
      :error="notice?.error ? t(notice.text) : undefined"
      v-if="modal === 'confirm' && confirmation"
      :title="t(confirmation.title)"
      :busy="busy"
      @close="modal = null"
      ><p class="confirmation-text">{{ t(confirmation.message) }}</p>
      <div class="form-actions">
        <button class="button secondary" :disabled="busy" @click="modal = null">
          {{ t('取消') }}</button
        ><button class="button danger" :disabled="busy" @click="confirmAction">
          {{ t('确认删除') }}
        </button>
      </div></AppModal
    >
    <AppModal
      :error="notice?.error ? t(notice.text) : undefined"
      v-if="modal === 'import' && pendingBackup"
      :title="t('恢复此备份？')"
      :busy="busy"
      @close="modal = null"
      ><p class="confirmation-text">
        {{
          t('备份包含 {p0} 个卡组、{p1} 张卡片和 {p2} 条复习记录。', {
            p0: pendingBackup.library.decks.length,
            p1: pendingBackup.library.cards.length,
            p2: pendingBackup.library.reviews.length,
          })
        }}
      </p>
      <p v-if="pendingBackup.library.sources.length" class="confirmation-text">
        {{
          t('还包含 {count} 份学习材料及其原文快照。', {
            count: pendingBackup.library.sources.length,
          })
        }}
      </p>
      <p class="import-warning">
        {{ t('恢复会替换当前所有卡组、卡片和复习进度。建议先导出当前数据作为备份。') }}
      </p>
      <div class="form-actions">
        <button class="button secondary" :disabled="busy" @click="modal = null">
          {{ t('取消') }}</button
        ><button class="button primary" :disabled="busy" @click="restoreBackup">
          {{ t('替换并恢复') }}
        </button>
      </div></AppModal
    >
  </div>
</template>
