<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { FileText, Plus, Upload } from '@lucide/vue'
import { t, locale, duration, type DisplayMessage } from '../i18n'
import type { Library } from '../core/model'
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_CHARACTERS,
  characterBoundary,
  READING_INTERVAL_DAYS,
  type SaveSourceExcerptInput,
  type SourceInput,
  type SourceDetailsUpdate,
  type SourceExcerpt,
  type SourceQueueAction,
  type SourceQueueUpdate,
  type SourcePriority,
  type ReadingUpdate,
  type Source,
  type SourceTarget,
  type SourceBatchUpdate,
  type SourceBatchAction,
  type ReadingFeedback,
} from '../core/source-data'
import { adaptiveReadingPlan } from '../core/adaptive-reading'
import { sourceExcerpt, recentSource } from '../core/sources'
import { sourceArrangement } from '../core/reading-operations'
import { sourceContextPath } from '../core/source-tree'
import SourceBatchDialog from './SourceBatchDialog.vue'
import { localDay } from '../core/model'
import {
  filterSources,
  queuedSources,
  sourceQueueState,
  nextReadingDay,
  nextReadingInterval,
  type SourceFilter,
  type SourceQueueView,
} from '../core/source-queue'
import type { ReadingProgress } from '../composables/useReadingProgress'
import {
  startReadingRound,
  advanceReadingRound,
  reconcileReadingRound,
  type ReadingRound,
} from '../core/reading-round'
import { createExportFile } from '@repeaty-platform'
import AppModal from './AppModal.vue'
import SourceReader from './SourceReader.vue'
import SourceContext from './SourceContext.vue'
import SourceExcerptList from './SourceExcerptList.vue'
import { excerptsForSource, matchingExcerpts } from '../core/source-navigation'

const props = defineProps<{
  library: Library
  busy: boolean
  scope: string
  reading: ReadingProgress
  now: Date
  canShare?: boolean
  autoStart?: boolean
  session?: { sourceId: string; mediaId: string }
  canUndoReading: boolean
  readingUndoId?: string
  arrangeBatch: (update: SourceBatchUpdate) => Promise<boolean>
  undoReading: () => Promise<boolean>
  actionError?: string
  read: (id: string, signal?: AbortSignal) => Promise<string>
  save: (input: SourceInput, scope: string) => Promise<boolean>
  updateDetails: (update: SourceDetailsUpdate) => Promise<boolean>
  saveExcerpt: (input: SaveSourceExcerptInput) => Promise<boolean>
  remove: (id: string, scope: string) => Promise<boolean>
  arrange: (update: SourceQueueUpdate) => Promise<boolean>
  saveReading: (update: ReadingUpdate) => Promise<boolean>
}>()
const emit = defineEmits<{
  create: [excerpt: SourceExcerpt, format: 'plain' | 'markdown']
  edit: [noteId: string]
  share: [excerpt: SourceExcerpt]
  clearNotice: []
  review: []
  startHandled: []
  sessionDone: [arranged: boolean]
  activity: [busy: boolean]
}>()
const today = computed(() => localDay(props.now))
const round = shallowRef<ReadingRound>()
const inRound = computed(() => !!round.value || !!props.session)
const roundFilter = shallowRef<SourceFilter>()
const roundEnded = computed(
  () => !!round.value && round.value.cursor === round.value.entries.length,
)
const view = ref<SourceQueueView>('ready')
const queueViews = ['ready', 'deferred', 'archived', 'all'] as const
const queueLabels = {
  ready: '待阅读',
  deferred: '稍后阅读',
  archived: '已归档',
  all: '全部材料',
} as const
const priorityLabels = { high: '高', normal: '普通', low: '低' } as const
const priorityBadges = { high: '高优先级', normal: '普通优先级', low: '低优先级' } as const
const kindLabels = { all: '全部类型', original: '原文', excerpt: '摘录' } as const
const query = ref(''),
  kind = ref<NonNullable<SourceFilter['kind']>>('all'),
  priority = ref<NonNullable<SourceFilter['priority']>>('all'),
  page = ref(0)
const filters = computed<SourceFilter>(() => ({
  query: query.value,
  kind: kind.value,
  priority: priority.value,
}))
const hasFilters = computed(
  () => !!query.value.trim() || kind.value !== 'all' || priority.value !== 'all',
)
const matchingSources = computed(() => filterSources(props.library.sources, filters.value))
const readyCount = computed(
  () =>
    props.library.sources.filter((source) => sourceQueueState(source, today.value) === 'ready')
      .length,
)
const counts = computed(() =>
  Object.fromEntries(
    queueViews.map((value) => [
      value,
      matchingSources.value.filter(
        (entry) => value === 'all' || sourceQueueState(entry, today.value) === value,
      ).length,
    ]),
  ),
)
const filteredReadyCount = computed(() =>
  view.value === 'ready' || view.value === 'all' ? counts.value.ready : 0,
)
const roundFilterLabel = computed(() => {
  const filter = roundFilter.value
  if (!filter) return ''
  return [
    t(kindLabels[filter.kind ?? 'all']),
    t(
      !filter.priority || filter.priority === 'all'
        ? '全部优先级'
        : priorityBadges[filter.priority],
    ),
    filter.query?.trim(),
  ]
    .filter(Boolean)
    .join(' · ')
})
function resetFilters() {
  query.value = ''
  kind.value = 'all'
  priority.value = 'all'
}
const selectedId = ref(
  props.session?.sourceId ??
    recentSource(queuedSources(props.library.sources, 'ready', today.value))?.id ??
    '',
)
const source = computed(() =>
  props.library.sources.find(
    (entry) =>
      entry.id === selectedId.value && (!props.session || entry.mediaId === props.session.mediaId),
  ),
)
const linked = computed(() =>
  props.library.notes.filter((note) => note.excerpt?.sourceId === selectedId.value),
)
const text = ref(''),
  error = ref<DisplayMessage>(''),
  loading = ref(false),
  excerpt = ref<SourceExcerpt>()
const original = computed(() =>
  props.library.sources.find((entry) => entry.id === source.value?.origin?.sourceId),
)
const savedExcerpts = computed(() => excerptsForSource(props.library, selectedId.value))
const duplicates = computed(() => matchingExcerpts(savedExcerpts.value, excerpt.value))
const excerptList = ref<InstanceType<typeof SourceExcerptList>>()
const viewingExcerptId = ref('')
const viewedExcerpt = computed(
  () => savedExcerpts.value.find((entry) => entry.source.id === viewingExcerptId.value)?.source,
)
const ancestry = computed(() =>
  source.value ? sourceContextPath(props.library.sources, source.value).reverse() : [],
)
const ancestrySource = shallowRef<Source>()
const viewedSelection = computed<SourceExcerpt | undefined>(() => {
  const child = viewedExcerpt.value
  if (!child?.origin || loading.value || error.value || !text.value) return undefined
  return {
    sourceId: child.id,
    start: 0,
    end: child.characters,
    quote: text.value.slice(child.origin.start, child.origin.end),
  }
})
const navigationError = ref<DisplayMessage>('')
const originOpen = ref(false)
const excerptDraft = shallowRef<{ input: SaveSourceExcerptInput; token?: number }>()
const excerptTitle = ref(''),
  savingExcerpt = ref(false)
const detailsDraft = ref<Omit<SourceDetailsUpdate, 'position'>>()
const savingDetails = ref(false)
const importing = ref(false),
  deleting = ref(false),
  exporting = ref(false),
  readingFile = ref(false),
  importError = ref<DisplayMessage>('')
const pageSize = 20
const filteredSources = computed(() =>
  queuedSources(props.library.sources, view.value, today.value, filters.value),
)
const pages = computed(() => Math.max(1, Math.ceil(filteredSources.value.length / pageSize)))
const visibleSources = computed(() =>
  filteredSources.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
)
watch([query, kind, priority, view], () => {
  page.value = 0
})
type Selection = SourceTarget & { title: string }
const selection = shallowRef(new Map<string, Selection>())
const batchDraft = shallowRef<{ entries: Selection[]; scope: string }>()
const savingBatch = ref(false)
const undoing = ref(false)
const roundUndo = shallowRef<{ id: string; before: ReadingRound; after: ReadingRound }>()
function selectSources(entries: Source[]) {
  const next = new Map(selection.value)
  for (const source of entries)
    next.set(source.id, {
      id: source.id,
      mediaId: source.mediaId,
      title: source.title,
      before: sourceArrangement(source),
    })
  selection.value = next
}
function toggleSelection(source: Source) {
  if (!selection.value.has(source.id)) return selectSources([source])
  const next = new Map(selection.value)
  next.delete(source.id)
  selection.value = next
}
watch([query, kind, priority, view], () => {
  selection.value = new Map()
})
function openBatch() {
  if (props.busy || moving.value || arranging.value || !selection.value.size || round.value) return
  emit('clearNotice')
  batchDraft.value = { entries: [...selection.value.values()], scope: props.scope }
}
async function saveBatch(action: SourceBatchAction) {
  const draft = batchDraft.value
  if (!draft || props.busy || savingBatch.value) return
  const current = source.value,
    target =
      current &&
      draft.entries.find((entry) => entry.id === current.id && entry.mediaId === current.mediaId),
    pending = current && props.reading.pending.get(current.id)
  const reading =
    target && reader.value?.ready && !loading.value && !error.value
      ? reader.value.capture()
      : undefined
  savingBatch.value = true
  emit('clearNotice')
  try {
    const saved = await props.arrangeBatch({
      targets: draft.entries,
      action,
      scope: draft.scope,
      reading,
    })
    if (saved && alive && props.scope === draft.scope && batchDraft.value === draft) {
      if (reading) props.reading.acknowledge(reading.sourceId, pending?.token)
      batchDraft.value = undefined
      selection.value = new Map()
      roundUndo.value = undefined
    }
  } finally {
    savingBatch.value = false
  }
}
async function undoArrangement() {
  if (!props.canUndoReading || props.busy || moving.value || arranging.value || undoing.value)
    return
  const scope = props.scope,
    undoId = props.readingUndoId,
    current = round.value,
    previous = roundUndo.value
  undoing.value = true
  moving.value = true
  emit('clearNotice')
  try {
    if ((await props.undoReading()) && alive && props.scope === scope) {
      if (previous && previous.id === undoId && current === previous.after)
        showRound(reconcileReadingRound(previous.before, props.library.sources, today.value))
      roundUndo.value = undefined
      selection.value = new Map()
    }
  } finally {
    undoing.value = false
    moving.value = false
  }
}
const form = reactive<SourceInput>({ title: '', url: '', format: 'markdown', content: '' })
const fileInput = ref<HTMLInputElement>(),
  reader = ref<InstanceType<typeof SourceReader>>()
let controller: AbortController | undefined,
  fileGeneration = 0,
  alive = true
let readingLoad: Promise<void> = Promise.resolve()
watch(filteredSources, (sources) => {
  if (!inRound.value && !sources.some((entry) => entry.id === selectedId.value)) {
    selectedId.value = sources[page.value * pageSize]?.id ?? sources[0]?.id ?? ''
  }
  page.value = Math.min(page.value, pages.value - 1)
})
watch([() => source.value?.id, () => source.value?.mediaId], load, { immediate: true })
onUnmounted(() => {
  alive = false
  controller?.abort()
  fileGeneration++
})
function load() {
  readingLoad = readSelected()
  return readingLoad
}
async function readSelected() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  text.value = ''
  originOpen.value = false
  viewingExcerptId.value = ''
  ancestrySource.value = undefined
  navigationError.value = ''
  excerpt.value = undefined
  error.value = ''
  if (!source.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    text.value = await props.read(source.value.id, current.signal)
  } catch (issue) {
    if (!current.signal.aborted) error.value = issue as Error
  } finally {
    if (controller === current) loading.value = false
  }
}
function select(sourceId: string, start: number, end: number) {
  if (!source.value || source.value.id !== sourceId) return
  try {
    excerpt.value = sourceExcerpt(source.value, text.value, start, end)
  } catch {
    excerpt.value = undefined
  }
}
function openExcerpt() {
  if (!source.value || !excerpt.value || props.busy) return
  emit('clearNotice')
  const current = source.value,
    selected = excerpt.value,
    title = selected.quote.replace(/\s+/gu, ' ').trim()
  excerptTitle.value = title.slice(0, characterBoundary(title, 160))
  excerptDraft.value = {
    input: {
      title: excerptTitle.value,
      excerpt: { ...selected },
      mediaId: current.mediaId,
      scope: props.scope,
      position: reader.value?.ready ? reader.value.capture().position : undefined,
    },
    token: props.reading.pending.get(current.id)?.token,
  }
}
async function saveExcerpt() {
  const draft = excerptDraft.value
  if (!draft || props.busy || savingExcerpt.value) return
  savingExcerpt.value = true
  try {
    if (!(await props.saveExcerpt({ ...draft.input, title: excerptTitle.value }))) return
    if (!alive || props.scope !== draft.input.scope || excerptDraft.value !== draft) return
    props.reading.acknowledge(draft.input.excerpt.sourceId, draft.token)
    excerptDraft.value = undefined
    if (!inRound.value) {
      resetFilters()
      view.value = 'ready'
      const child = props.library.sources.at(-1)
      selectedId.value = child?.id ?? ''
      const index = filteredSources.value.findIndex((entry) => entry.id === child?.id)
      page.value = Math.max(0, Math.floor(index / pageSize))
    }
  } finally {
    savingExcerpt.value = false
  }
}
function createFromWholeExcerpt() {
  if (!source.value || source.value.kind !== 'excerpt' || !text.value || props.busy) return
  emit('create', sourceExcerpt(source.value, text.value, 0, text.value.length), source.value.format)
}
async function resume(id: string) {
  const scope = props.scope
  openSource(id)
  await nextTick()
  await readingLoad
  await nextTick()
  if (scope === props.scope && source.value?.id === id) await reader.value?.resume()
}
function openSource(id: string) {
  selectedId.value = id
  const entry = props.library.sources.find((source) => source.id === id)
  if (entry?.reading)
    props.reading.record(
      { sourceId: id, mediaId: entry.mediaId, scope: props.scope, position: entry.reading },
      true,
    )
}
function remember() {
  const update = reader.value?.capture()
  if (update) props.reading.record(update, true)
}
const readingError = computed(() => props.reading.pending.get(selectedId.value)?.error)
const pendingReading = computed(() => props.reading.pending.has(selectedId.value))
const deferring = ref(false),
  schedulingRead = ref(false),
  resettingInterval = ref(false),
  arranging = ref(false),
  moving = ref(false),
  deferDate = ref('')
const deferOptions = computed(() => [
  { label: '明天', date: nextReadingDay(props.now) },
  { label: '3 天后', date: nextReadingDay(props.now, 3) },
  { label: '1 周后', date: nextReadingDay(props.now, 7) },
])
let releaseReading: (() => void) | undefined
watch(
  () =>
    importing.value ||
    deleting.value ||
    deferring.value ||
    schedulingRead.value ||
    resettingInterval.value ||
    moving.value ||
    arranging.value ||
    !!detailsDraft.value ||
    !!excerptDraft.value ||
    !!batchDraft.value,
  (held) => {
    if (held) releaseReading ??= props.reading.hold()
    else {
      releaseReading?.()
      releaseReading = undefined
    }
  },
  { flush: 'sync' },
)
onUnmounted(() => releaseReading?.())
const intervalPlan = computed(() => source.value && nextReadingInterval(source.value, props.now))
const scheduleMode = ref<'fixed' | 'adaptive'>('fixed')
const readingFeedback = ref<ReadingFeedback>('good')
const adaptivePlan = computed(
  () => source.value && adaptiveReadingPlan(source.value, readingFeedback.value, props.now),
)
const selectedPlan = computed(() =>
  scheduleMode.value === 'adaptive' ? adaptivePlan.value : intervalPlan.value,
)
function saveReadSchedule() {
  if (scheduleMode.value === 'adaptive' && adaptivePlan.value)
    return arrange({
      type: 'read-adaptive',
      feedback: readingFeedback.value,
      ...adaptivePlan.value,
    })
  if (intervalPlan.value) return arrange({ type: 'read', ...intervalPlan.value })
}
watch([() => source.value?.id, () => source.value?.mediaId], () => {
  schedulingRead.value = false
  resettingInterval.value = false
})
const canMove = computed(
  () =>
    !props.busy &&
    !arranging.value &&
    !moving.value &&
    !loading.value &&
    !error.value &&
    !!reader.value?.ready,
)
watch(
  () =>
    props.busy ||
    loading.value ||
    arranging.value ||
    moving.value ||
    savingExcerpt.value ||
    savingDetails.value ||
    savingBatch.value ||
    undoing.value,
  (value) => emit('activity', value),
  { immediate: true, flush: 'sync' },
)
watch(
  () => props.session,
  (session) => {
    if (session) selectedId.value = session.sourceId
  },
)
async function leaveSession() {
  if (props.busy || moving.value || arranging.value || loading.value) return false
  moving.value = true
  try {
    return !source.value || !!error.value || (await savePosition())
  } finally {
    moving.value = false
  }
}
async function finishSession() {
  if (!props.session || props.busy || moving.value || arranging.value || loading.value) return
  const session = { ...props.session },
    scope = props.scope
  moving.value = true
  emit('clearNotice')
  try {
    const saved = !source.value || !!error.value || (await savePosition())
    if (
      saved &&
      alive &&
      props.scope === scope &&
      props.session?.sourceId === session.sourceId &&
      props.session.mediaId === session.mediaId
    )
      emit('sessionDone', false)
  } finally {
    moving.value = false
  }
}
defineExpose({ leaveSession })
function showRound(next: ReadingRound) {
  round.value = next
  selectedId.value = next.entries[next.cursor]?.sourceId ?? ''
  const index = filteredSources.value.findIndex((entry) => entry.id === selectedId.value)
  if (index >= 0) page.value = Math.floor(index / pageSize)
}
watch([() => props.library.sources, today, () => props.busy, moving, arranging], () => {
  if (!round.value || props.busy || moving.value || arranging.value) return
  const next = reconcileReadingRound(round.value, props.library.sources, today.value)
  if (next !== round.value) showRound(next)
})
async function savePosition() {
  const current = source.value
  if (!current || !reader.value?.ready || loading.value || error.value) return false
  const scope = props.scope,
    pending = props.reading.pending.get(current.id)
  const saved = await props.saveReading(reader.value.capture())
  if (saved && alive && scope === props.scope) props.reading.acknowledge(current.id, pending?.token)
  return saved
}
async function beginRound(filter?: SourceFilter) {
  if (
    props.busy ||
    moving.value ||
    arranging.value ||
    !(filter ? filteredReadyCount.value : readyCount.value) ||
    (source.value && !canMove.value)
  )
    return
  const scope = props.scope,
    chosen = filter && { ...filter }
  moving.value = true
  emit('clearNotice')
  try {
    if (source.value && !(await savePosition())) return
    if (!alive || props.scope !== scope) return
    const next = startReadingRound(props.library.sources, today.value, chosen)
    if (!next.entries.length) return
    if (!chosen) {
      view.value = 'ready'
      resetFilters()
    }
    page.value = 0
    roundFilter.value = chosen
    showRound(next)
  } finally {
    moving.value = false
  }
}
watch(
  [() => props.autoStart, canMove],
  () => {
    if (!props.autoStart || round.value || !readyCount.value || (source.value && !canMove.value))
      return
    emit('startHandled')
    void beginRound()
  },
  { immediate: true, flush: 'post' },
)
async function nextSource() {
  const current = round.value,
    scope = props.scope
  if (!current || roundEnded.value || !canMove.value) return
  moving.value = true
  emit('clearNotice')
  try {
    if ((await savePosition()) && alive && props.scope === scope && round.value === current)
      showRound(advanceReadingRound(current, props.library.sources, today.value))
  } finally {
    moving.value = false
  }
}
async function stopRound() {
  const current = round.value,
    scope = props.scope
  if (!current || props.busy || moving.value || arranging.value) return
  moving.value = true
  emit('clearNotice')
  try {
    if (
      source.value &&
      reader.value?.ready &&
      !loading.value &&
      !error.value &&
      !(await savePosition())
    )
      return
    if (!alive || props.scope !== scope || round.value !== current) return
    round.value = undefined
    if (!filteredSources.value.some((entry) => entry.id === selectedId.value))
      selectedId.value = recentSource(filteredSources.value)?.id ?? ''
    const index = filteredSources.value.findIndex((entry) => entry.id === selectedId.value)
    if (index >= 0) page.value = Math.floor(index / pageSize)
  } finally {
    moving.value = false
  }
}
const queueState = computed(() =>
  source.value ? sourceQueueState(source.value, today.value) : undefined,
)
function openDefer() {
  emit('clearNotice')
  deferDate.value = nextReadingDay(props.now)
  deferring.value = true
}
function openReadSchedule() {
  if (!canMove.value || queueState.value === 'archived') return
  emit('clearNotice')
  scheduleMode.value = source.value?.adaptiveReading ? 'adaptive' : 'fixed'
  readingFeedback.value = 'good'
  schedulingRead.value = true
}
function openIntervalReset() {
  emit('clearNotice')
  resettingInterval.value = true
}
async function arrange(action: SourceQueueAction) {
  const current = source.value
  if (!current || props.busy || arranging.value || moving.value) return
  const started = round.value,
    undoId = props.readingUndoId
  const pending = props.reading.pending.get(current.id)
  const position = reader.value?.ready ? reader.value.capture().position : pending?.update.position
  const scope = props.scope
  arranging.value = true
  emit('clearNotice')
  try {
    if (
      await props.arrange({
        sourceId: current.id,
        mediaId: current.mediaId,
        scope,
        action,
        position,
      })
    ) {
      props.reading.acknowledge(current.id, pending?.token)
      if (alive && props.scope === scope) {
        deferring.value = false
        schedulingRead.value = false
        resettingInterval.value = false
        if (props.session && ['defer', 'archive', 'read', 'read-adaptive'].includes(action.type)) {
          await nextTick()
          if (alive) emit('sessionDone', true)
        }
        if (
          started &&
          round.value === started &&
          (action.type === 'defer' ||
            action.type === 'archive' ||
            action.type === 'read' ||
            action.type === 'read-adaptive')
        ) {
          const after = advanceReadingRound(started, props.library.sources, today.value)
          showRound(after)
          await nextTick()
          if (props.readingUndoId && props.readingUndoId !== undoId)
            roundUndo.value = { id: props.readingUndoId, before: started, after }
        } else if (action.type === 'priority') {
          const index = filteredSources.value.findIndex((entry) => entry.id === current.id)
          if (index >= 0) page.value = Math.floor(index / pageSize)
        }
      }
    }
  } finally {
    arranging.value = false
  }
}
function changePriority(event: Event) {
  const select = event.target as HTMLSelectElement
  const priority = select.value as SourcePriority
  // Show the persisted value until the transaction succeeds, including on failure.
  select.value = source.value?.priority ?? 'normal'
  return arrange({ type: 'priority', priority })
}
async function locateExcerpt(id: string) {
  const entry = savedExcerpts.value.find((entry) => entry.source.id === id)
  if (!entry || !canMove.value) return
  emit('clearNotice')
  navigationError.value = ''
  moving.value = true
  try {
    await reader.value?.locate(entry.origin)
  } catch (issue) {
    if (alive) navigationError.value = issue as Error
  } finally {
    moving.value = false
  }
}
async function openExcerptSource(id: string) {
  const entry = savedExcerpts.value.find((entry) => entry.source.id === id),
    parent = source.value,
    scope = props.scope
  if (!entry || !parent || props.busy || moving.value || arranging.value) return
  emit('clearNotice')
  navigationError.value = ''
  if (inRound.value) {
    viewingExcerptId.value = id
    return
  }
  moving.value = true
  const current = () =>
    alive &&
    props.scope === scope &&
    !round.value &&
    source.value?.id === parent.id &&
    source.value.mediaId === parent.mediaId &&
    savedExcerpts.value.some(
      (candidate) =>
        candidate.source.id === id && candidate.source.mediaId === entry.source.mediaId,
    )
  try {
    if (!loading.value && !error.value && reader.value?.ready && !(await savePosition())) return
    if (!current()) return
    view.value = 'all'
    resetFilters()
    await nextTick()
    if (!current()) return
    await resume(id)
    if (alive && props.scope === scope && selectedId.value === id) {
      const index = filteredSources.value.findIndex((source) => source.id === id)
      page.value = Math.max(0, Math.floor(index / pageSize))
    }
  } finally {
    moving.value = false
  }
}
function readingDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(0)
  value.setFullYear(year!, month! - 1, day!)
  value.setHours(12, 0, 0, 0)
  return value.toLocaleDateString(locale.value)
}
function openImport() {
  emit('clearNotice')
  fileGeneration++
  readingFile.value = false
  Object.assign(form, { title: '', url: '', format: 'markdown', content: '' })
  importError.value = ''
  importing.value = true
}
function openDetails() {
  const current = source.value
  if (!current || props.busy || moving.value || arranging.value || savingDetails.value) return
  emit('clearNotice')
  detailsDraft.value = {
    sourceId: current.id,
    mediaId: current.mediaId,
    scope: props.scope,
    before: { title: current.title, url: current.url },
    details: { title: current.title, url: current.url },
  }
}
async function saveDetails() {
  const draft = detailsDraft.value
  if (!draft || props.busy || savingDetails.value) return
  const current = source.value,
    pending = props.reading.pending.get(draft.sourceId)
  const position =
    current?.id === draft.sourceId &&
    current.mediaId === draft.mediaId &&
    !loading.value &&
    !error.value &&
    reader.value?.ready
      ? reader.value.capture().position
      : pending?.update.mediaId === draft.mediaId
        ? pending.update.position
        : undefined
  savingDetails.value = true
  emit('clearNotice')
  try {
    const saved = await props.updateDetails({
      ...draft,
      before: { ...draft.before },
      details: { ...draft.details },
      position,
    })
    if (saved && alive && props.scope === draft.scope && detailsDraft.value === draft) {
      props.reading.acknowledge(draft.sourceId, pending?.token)
      detailsDraft.value = undefined
    }
  } finally {
    savingDetails.value = false
  }
}
function openDelete() {
  emit('clearNotice')
  deleting.value = true
}
function closeImport() {
  importing.value = false
  fileGeneration++
  readingFile.value = false
}
async function fileChanged(event: Event) {
  const target = event.target as HTMLInputElement,
    file = target.files?.[0]
  target.value = ''
  if (!file) return
  const generation = ++fileGeneration
  readingFile.value = true
  importError.value = ''
  try {
    if (file.size > MAX_SOURCE_BYTES) throw new Error('文本或 Markdown 文件不能超过 1 MB。')
    if (!/\.(txt|md|markdown)$/i.test(file.name))
      throw new Error('请选择 UTF-8 的 .txt、.md 或 .markdown 文件。')
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    } catch {
      throw new Error('无法读取文件，请使用 UTF-8 编码。')
    }
    if (generation !== fileGeneration) return
    if (content.length > MAX_SOURCE_CHARACTERS || !content.trim())
      throw new Error('正文不能为空，且不能超过 250000 个字符。')
    form.content = content
    form.title = file.name.replace(/\.(txt|md|markdown)$/i, '').slice(0, 160)
    form.format = /\.(md|markdown)$/i.test(file.name) ? 'markdown' : 'plain'
  } catch (issue) {
    if (generation === fileGeneration) importError.value = issue as Error
  } finally {
    if (generation === fileGeneration) readingFile.value = false
  }
}
async function save() {
  if (props.busy || readingFile.value) return
  if (await props.save({ ...form }, props.scope)) {
    importing.value = false
    resetFilters()
    view.value = 'ready'
    page.value = 0
    selectedId.value = props.library.sources.at(-1)?.id ?? ''
  }
}
async function remove() {
  if (source.value && (await props.remove(source.value.id, props.scope))) deleting.value = false
}
async function download() {
  if (!source.value || loading.value || exporting.value || error.value) return
  const current = source.value,
    body = text.value
  const filename = `repeaty-source-${current.id}.${current.format === 'markdown' ? 'md' : 'txt'}`
  exporting.value = true
  let writable: WritableStream<Uint8Array> | undefined
  try {
    const blob = new Blob([body], {
      type: current.format === 'markdown' ? 'text/markdown' : 'text/plain',
    })
    if (createExportFile) {
      writable = await createExportFile(filename)
      await blob.stream().pipeTo(writable)
    } else {
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  } catch (issue) {
    await writable?.abort().catch(() => {})
    if (!(issue instanceof DOMException && issue.name === 'AbortError'))
      error.value = issue as Error
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="page sources-page">
    <header v-if="!session" class="page-heading">
      <div>
        <h1>{{ t('学习材料') }}</h1>
        <p>{{ t('保存原文，选取摘录制作卡片。') }}</p>
      </div>
      <div class="source-actions">
        <button
          v-if="canUndoReading && !session"
          :title="t('撤销最近一次阅读安排（刷新后清除）')"
          class="button secondary"
          :disabled="busy || moving || arranging || undoing"
          @click="undoArrangement"
        >
          {{ t('撤销阅读安排') }}
        </button>
        <button
          v-if="!inRound"
          class="button secondary"
          :disabled="busy || moving || arranging || !readyCount || (!!source && !canMove)"
          @click="beginRound()"
        >
          {{ t('开始一轮阅读') }}
        </button>
        <button class="button primary" :disabled="busy || moving || inRound" @click="openImport">
          <Plus :size="18" />{{ t('导入材料') }}
        </button>
      </div>
    </header>
    <div v-if="!library.sources.length && !inRound" class="empty-state">
      <FileText :size="36" />
      <h2>{{ t('还没有学习材料') }}</h2>
      <p>{{ t('导入文本或 Markdown，也可以直接粘贴。原文会保存在当前学习库中。') }}</p>
    </div>
    <template v-else>
      <section v-if="session" class="reading-round" :aria-label="t('本轮阅读')">
        <p>{{ t('阅读位置会保存；可安排下次阅读，或直接继续。') }}</p>
        <button
          class="button primary"
          :disabled="busy || moving || arranging || loading"
          @click="finishSession"
        >
          {{ t(error ? '跳过本篇' : '完成阅读，继续学习') }}
        </button>
      </section>
      <section
        v-if="round && !roundEnded"
        class="reading-round"
        :aria-label="t('本轮阅读')"
        :aria-busy="moving || arranging"
      >
        <div>
          <strong>{{
            t('第 {number} 篇，共 {total} 篇', {
              number: round.cursor + 1,
              total: round.entries.length,
            })
          }}</strong>
          <p class="form-note">{{ t('本轮按开始时的顺序阅读。') }}</p>
          <p v-if="roundFilter" class="form-note reading-round-filter">{{ roundFilterLabel }}</p>
        </div>
        <div class="source-actions">
          <button class="button primary" :disabled="!canMove" @click="nextSource">
            {{ t(round.cursor + 1 === round.entries.length ? '完成本轮' : '下一篇') }}
          </button>
          <button class="text-button" :disabled="busy || moving || arranging" @click="stopRound">
            {{ t('结束本轮') }}
          </button>
        </div>
      </section>
      <nav v-if="!inRound" class="source-queue-filters" :aria-label="t('阅读队列')">
        <button
          v-for="value in queueViews"
          :key="value"
          type="button"
          :aria-pressed="view === value"
          :disabled="busy || moving || arranging || inRound"
          @click="view = value"
        >
          {{ t(queueLabels[value]) }} <span>{{ counts[value] }}</span>
        </button>
      </nav>
      <section v-if="!inRound" class="source-filters" :aria-label="t('材料筛选')">
        <div class="source-filter-fields">
          <div class="source-filter-field source-search">
            <label for="source-search">{{ t('搜索材料') }}</label>
            <input
              id="source-search"
              v-model="query"
              type="search"
              :placeholder="t('搜索标题')"
              :disabled="busy || moving || arranging"
            />
          </div>
          <div class="source-filter-field">
            <label for="source-kind-filter">{{ t('材料类型') }}</label>
            <select id="source-kind-filter" v-model="kind" :disabled="busy || moving || arranging">
              <option v-for="(label, value) in kindLabels" :key="value" :value="value">
                {{ t(label) }}
              </option>
            </select>
          </div>
          <div class="source-filter-field">
            <label for="source-priority-filter">{{ t('优先级筛选') }}</label>
            <select
              id="source-priority-filter"
              v-model="priority"
              :disabled="busy || moving || arranging"
            >
              <option value="all">{{ t('全部优先级') }}</option>
              <option v-for="(label, value) in priorityBadges" :key="value" :value="value">
                {{ t(label) }}
              </option>
            </select>
          </div>
        </div>
        <div class="source-filter-footer">
          <div class="source-actions">
            <button
              class="button secondary"
              :disabled="
                busy || moving || arranging || !filteredReadyCount || (!!source && !canMove)
              "
              aria-describedby="source-filter-count"
              @click="beginRound(filters)"
            >
              {{ t('阅读筛选结果') }}
            </button>
            <button
              v-if="hasFilters"
              class="text-button"
              :disabled="busy || moving || arranging"
              @click="resetFilters"
            >
              {{ t('清除筛选') }}
            </button>
          </div>
          <p id="source-filter-count" class="form-note" role="status">
            {{
              t('本列表 {count} 篇，其中 {ready} 篇待阅读。', {
                count: filteredSources.length,
                ready: filteredReadyCount,
              })
            }}
          </p>
        </div>
      </section>
      <section
        v-if="!inRound && filteredSources.length"
        class="source-selection-toolbar"
        :aria-label="t('批量选择材料')"
      >
        <p role="status">{{ t('已选 {count} 篇材料', { count: selection.size }) }}</p>
        <div class="source-actions">
          <button
            class="text-button"
            :disabled="busy || moving || arranging"
            @click="selectSources(visibleSources)"
          >
            {{ t('选择本页') }}
          </button>
          <button
            class="text-button"
            :disabled="busy || moving || arranging"
            @click="selectSources(filteredSources)"
          >
            {{ t('选择全部筛选结果（{count}）', { count: filteredSources.length }) }}
          </button>
          <button
            v-if="selection.size"
            class="text-button"
            :disabled="busy || moving || arranging"
            @click="selection = new Map()"
          >
            {{ t('取消选择') }}
          </button>
          <button
            class="button secondary"
            :disabled="busy || moving || arranging || !selection.size"
            @click="openBatch"
          >
            {{ t('批量安排') }}
          </button>
        </div>
      </section>
      <div class="sources-layout" :class="{ 'round-layout': inRound }">
        <aside v-if="!inRound" class="source-list">
          <p v-if="!visibleSources.length" class="form-note">{{ t('没有找到材料。') }}</p>
          <div
            v-for="entry in visibleSources"
            :key="entry.id"
            class="source-list-item"
            :class="{ selected: entry.id === selectedId }"
          >
            <label class="source-selection">
              <input
                type="checkbox"
                :checked="selection.has(entry.id)"
                :disabled="busy || moving || arranging"
                :aria-label="t('选择材料「{title}」', { title: entry.title })"
                @change="toggleSelection(entry)"
              />
              <span>{{ t('选择') }}</span>
            </label>
            <button
              class="source-list-title"
              :aria-pressed="entry.id === selectedId"
              :disabled="busy || moving || inRound"
              @click="openSource(entry.id)"
            >
              <strong>{{ entry.title }}</strong></button
            ><span
              >{{ entry.format === 'markdown' ? 'Markdown' : t('纯文本') }} ·
              {{ new Date(entry.createdAt).toLocaleDateString(locale) }}</span
            >
            <span v-if="entry.kind === 'excerpt'" class="source-kind-badge">{{ t('摘录') }}</span>
            <span class="source-queue-state">{{
              sourceQueueState(entry, today) === 'archived'
                ? t('已归档')
                : entry.queue
                  ? t('安排于 {date}', { date: readingDate(entry.queue.availableOn) })
                  : t('待阅读')
            }}</span>
            <span
              v-if="entry.priority && entry.priority !== 'normal'"
              class="source-priority-badge"
            >
              {{ t(priorityBadges[entry.priority]) }}
            </span>
            <template v-if="entry.reading">
              <span>{{
                t('上次阅读 {date}', {
                  date: new Date(entry.reading.updatedAt).toLocaleString(locale),
                })
              }}</span>
              <button
                class="text-button source-continue"
                :disabled="busy || moving || inRound"
                @click="resume(entry.id)"
              >
                {{ t('继续阅读') }}
              </button>
            </template>
          </div>
          <nav v-if="pages > 1" class="source-list-pages" :aria-label="t('材料列表分页')">
            <button type="button" class="text-button" :disabled="page === 0" @click="page--">
              {{ t('上一页') }}</button
            ><span>{{ page + 1 }} / {{ pages }}</span
            ><button
              type="button"
              class="text-button"
              :disabled="page + 1 >= pages"
              @click="page++"
            >
              {{ t('下一页') }}
            </button>
          </nav>
        </aside>
        <section
          v-if="roundEnded"
          class="empty-state source-queue-empty reading-round-complete"
          :aria-label="t('本轮阅读')"
        >
          <FileText :size="32" />
          <h2>{{ t('本轮结束') }}</h2>
          <p>{{ t('已到本轮末尾，阅读位置已保存。') }}</p>
          <p v-if="roundFilter" class="form-note reading-round-filter">{{ roundFilterLabel }}</p>
          <div class="source-actions">
            <button
              class="button primary"
              :disabled="busy || moving || !(roundFilter ? filteredReadyCount : readyCount)"
              @click="beginRound(roundFilter)"
            >
              {{ t('再读一轮') }}
            </button>
            <button class="button secondary" :disabled="busy || moving" @click="stopRound">
              {{ t('返回材料') }}
            </button>
            <button class="button secondary" :disabled="busy || moving" @click="emit('review')">
              {{ t('去复习卡片') }}
            </button>
          </div>
        </section>
        <section v-else-if="source" class="source-reader">
          <div class="source-reader-heading">
            <div>
              <span v-if="source.kind === 'excerpt'" class="source-kind-badge">{{
                t('摘录')
              }}</span>
              <nav v-if="ancestry.length > 1" class="source-ancestry" :aria-label="t('出处路径')">
                <template v-for="entry in ancestry" :key="entry.source.id">
                  <span v-if="entry.source.id === source.id" aria-current="page">{{
                    entry.source.title
                  }}</span>
                  <button
                    v-else
                    class="text-button"
                    :disabled="busy || moving"
                    @click="ancestrySource = entry.source"
                  >
                    {{ entry.source.title }}
                  </button>
                </template>
              </nav>
              <h2>{{ source.title }}</h2>
              <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{
                source.url
              }}</a>
              <p class="form-note">
                {{
                  t('保存于 {date}', { date: new Date(source.createdAt).toLocaleString(locale) })
                }}
              </p>
            </div>
            <div class="source-actions">
              <button
                class="button secondary"
                :disabled="busy || moving || arranging || exporting || savingDetails"
                @click="openDetails"
              >
                {{ t('编辑材料信息') }}
              </button>
              <button
                class="button secondary"
                :disabled="loading || !!error || exporting"
                @click="download"
              >
                {{ t('导出原文') }}</button
              ><button
                class="text-button danger"
                :disabled="(busy && !reading.savingId.value) || exporting || moving"
                @click="openDelete"
              >
                {{ t('删除材料') }}
              </button>
            </div>
          </div>
          <div class="source-reading-actions">
            <span class="form-note">{{
              queueState === 'archived'
                ? t('已归档')
                : source.queue
                  ? t('安排于 {date}', { date: readingDate(source.queue.availableOn) })
                  : t('待阅读')
            }}</span>
            <div class="source-priority-control">
              <label for="source-reading-priority">{{ t('阅读优先级') }}</label>
              <select
                id="source-reading-priority"
                :value="source.priority ?? 'normal'"
                :disabled="busy || arranging || moving"
                aria-describedby="source-priority-help"
                @change="changePriority"
              >
                <option v-for="(label, value) in priorityLabels" :key="value" :value="value">
                  {{ t(label) }}
                </option>
              </select>
            </div>
            <div class="source-actions">
              <button
                v-if="queueState !== 'archived'"
                class="button primary"
                :disabled="!canMove"
                @click="openReadSchedule"
              >
                {{ t('读过，安排下次') }}
              </button>
              <button
                v-if="queueState !== 'ready'"
                class="button secondary"
                :disabled="busy || arranging || moving"
                @click="arrange({ type: 'restore' })"
              >
                {{ t('加入待阅读') }}
              </button>
              <button
                v-if="queueState !== 'archived'"
                class="button secondary"
                :disabled="busy || arranging || moving"
                @click="openDefer"
              >
                {{ t('稍后阅读') }}
              </button>
              <button
                v-if="queueState !== 'archived'"
                class="text-button"
                :disabled="busy || arranging || moving"
                @click="arrange({ type: 'archive' })"
              >
                {{ t('归档材料') }}
              </button>
            </div>
          </div>
          <p id="source-priority-help" class="form-note source-priority-help">
            {{ t('待阅读先按优先级、再按日期排序。') }}
          </p>
          <div
            v-if="source.readingIntervalDays || source.adaptiveReading"
            class="source-interval-control"
          >
            <p class="form-note">
              {{
                t('上次间隔：{interval}', {
                  interval: duration(
                    (source.adaptiveReading?.intervalDays ?? source.readingIntervalDays)!,
                    'day',
                  ),
                })
              }}
            </p>
            <button
              class="text-button"
              :disabled="busy || arranging || moving"
              @click="openIntervalReset"
            >
              {{ t('重置间隔') }}
            </button>
          </div>
          <p v-if="loading" role="status">{{ t('正在读取原文…') }}</p>
          <template v-else-if="error"
            ><p class="import-warning" role="alert">{{ t(error) }}</p>
            <button class="button secondary" @click="load">{{ t('重试') }}</button></template
          >
          <template v-else>
            <div
              class="reading-progress"
              :data-reading-status="
                readingError
                  ? 'error'
                  : pendingReading
                    ? 'pending'
                    : source.reading
                      ? 'saved'
                      : 'empty'
              "
            >
              <p v-if="readingError" class="import-warning" role="alert">{{ t(readingError) }}</p>
              <p v-else class="form-note" role="status">
                {{
                  t(
                    pendingReading
                      ? '正在保存阅读位置…'
                      : source.reading
                        ? '阅读位置已保存'
                        : '阅读位置会自动保存。',
                  )
                }}
              </p>
              <div class="source-actions">
                <button
                  v-if="readingError"
                  class="text-button"
                  :disabled="busy"
                  @click="reading.flush()"
                >
                  {{ t('重试保存位置') }}
                </button>
                <button class="text-button" :disabled="busy || !reader?.ready" @click="remember">
                  {{ t('保存阅读位置') }}
                </button>
                <button
                  class="text-button"
                  :disabled="busy || !reader?.ready"
                  @click="reader?.restart()"
                >
                  {{ t('从头阅读') }}
                </button>
              </div>
            </div>
            <SourceReader
              :key="source.id + ':' + source.mediaId"
              ref="reader"
              :source="source"
              :text="text"
              :scope="scope"
              @select="select"
              @position="reading.record($event)"
            />
            <div v-if="source.kind === 'excerpt'" class="source-excerpt-tools">
              <p v-if="!original" class="form-note">{{ t('原文已删除，摘录内容仍保留。') }}</p>
              <div class="source-actions">
                <button
                  v-if="original"
                  class="button secondary"
                  :disabled="busy"
                  @click="originOpen = true"
                >
                  {{ t('查看出处') }}
                </button>
                <button
                  class="button primary"
                  :disabled="busy || !library.decks.length"
                  @click="createFromWholeExcerpt"
                >
                  {{ t('用此摘录制卡') }}
                </button>
              </div>
            </div>
            <p v-if="duplicates.length" class="source-duplicate" role="status">
              <span>{{ t('这段原文已有 {count} 份摘录。', { count: duplicates.length }) }}</span>
              <button
                type="button"
                class="text-button"
                :disabled="busy || moving"
                @click="excerptList?.showMatches()"
              >
                {{ t('查看已有摘录') }}
              </button>
            </p>
            <div class="source-excerpt-action">
              <span>{{
                excerpt
                  ? t('已选 {count} 个字符', { count: excerpt.quote.length })
                  : t('尚未选取摘录')
              }}</span>
              <button class="button secondary" :disabled="busy || !excerpt" @click="openExcerpt">
                {{ t('保存为摘录') }}
              </button>
              <button
                class="button primary"
                :disabled="busy || !excerpt || !library.decks.length"
                @click="excerpt && emit('create', excerpt, source.format)"
              >
                {{ t('用摘录制卡') }}
              </button>
              <button
                v-if="canShare"
                class="button secondary"
                :disabled="busy || !excerpt || !library.decks.length"
                @click="excerpt && emit('share', excerpt)"
              >
                {{ t('通过 MCP 制卡') }}
              </button>
            </div>
            <p v-if="!library.decks.length" class="form-note">
              {{ t('请先新建一个卡组，再用摘录制卡。') }}
            </p>
            <details v-if="linked.length" class="source-linked">
              <summary>{{ t('关联笔记（{count}）', { count: linked.length }) }}</summary>
              <ul>
                <li v-for="note in linked" :key="note.id">
                  <button class="text-button" @click="emit('edit', note.id)">
                    {{ note.front.slice(0, 120) }}
                  </button>
                </li>
              </ul>
            </details>
          </template>
          <p v-if="navigationError" class="import-warning" role="alert">{{ t(navigationError) }}</p>
          <SourceExcerptList
            v-if="savedExcerpts.length"
            :key="source.id + ':' + source.mediaId"
            ref="excerptList"
            :entries="savedExcerpts"
            :text="loading || error ? '' : text"
            :selection="excerpt"
            :today="today"
            :busy="busy || moving || arranging"
            :can-locate="canMove"
            @locate="locateExcerpt"
            @open="openExcerptSource"
          />
        </section>
        <section v-else class="empty-state source-queue-empty">
          <FileText :size="32" />
          <h2>
            {{
              t(
                hasFilters
                  ? '没有匹配的材料'
                  : view === 'ready'
                    ? '暂无待阅读材料'
                    : '选择一篇材料开始阅读',
              )
            }}
          </h2>
          <p>
            {{
              t(
                hasFilters
                  ? '更换关键词或调整筛选条件。'
                  : view === 'ready'
                    ? '切换到稍后阅读或已归档查看材料。'
                    : '当前列表为空。',
              )
            }}
          </p>
        </section>
      </div>
    </template>
    <SourceBatchDialog
      v-if="batchDraft"
      :titles="batchDraft.entries.map((entry) => entry.title)"
      :now="now"
      :busy="busy || savingBatch"
      :error="actionError"
      :save="saveBatch"
      @close="batchDraft = undefined"
    />
    <SourceContext
      v-if="ancestrySource"
      :source="ancestrySource"
      :sources="library.sources"
      :read="read"
      @close="ancestrySource = undefined"
    />
    <SourceContext
      v-if="viewedExcerpt"
      :key="viewedExcerpt.id"
      :source="viewedExcerpt"
      :origin="source"
      :excerpt="viewedSelection"
      :sources="library.sources"
      :read="read"
      @close="viewingExcerptId = ''"
    />
    <SourceContext
      v-if="originOpen && original && source?.origin"
      :source="original"
      :excerpt="{ ...source.origin, quote: text }"
      :sources="library.sources"
      :read="read"
      @close="originOpen = false"
    />
    <AppModal
      v-if="detailsDraft"
      :title="t('编辑材料信息')"
      :busy="busy || savingDetails"
      :error="actionError"
      @close="detailsDraft = undefined"
    >
      <form class="editor-form source-details-form" @submit.prevent="saveDetails">
        <label for="source-details-title">{{ t('材料标题') }}</label>
        <input
          id="source-details-title"
          v-model="detailsDraft.details.title"
          required
          maxlength="160"
          :disabled="busy || savingDetails"
        />
        <label for="source-details-url">{{ t('来源链接（可选）') }}</label>
        <input
          id="source-details-url"
          v-model="detailsDraft.details.url"
          type="url"
          maxlength="2048"
          placeholder="https://"
          :disabled="busy || savingDetails"
        />
        <p class="form-note">{{ t('操作前会保存快照，可在「数据与备份」中恢复。') }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="button secondary"
            :disabled="busy || savingDetails"
            @click="detailsDraft = undefined"
          >
            {{ t('取消') }}
          </button>
          <button class="button primary" :disabled="busy || savingDetails">
            {{ t('保存材料信息') }}
          </button>
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="excerptDraft"
      wide
      :title="t('保存为摘录')"
      :busy="busy || savingExcerpt"
      :error="actionError"
      @close="excerptDraft = undefined"
    >
      <form class="editor-form source-excerpt-form" @submit.prevent="saveExcerpt">
        <label for="excerpt-title">{{ t('摘录标题') }}</label>
        <input
          id="excerpt-title"
          v-model="excerptTitle"
          required
          maxlength="160"
          :disabled="busy || savingExcerpt"
        />
        <label for="excerpt-body">{{ t('选中的原文') }}</label>
        <textarea id="excerpt-body" :value="excerptDraft.input.excerpt.quote" readonly rows="8" />
        <p class="form-note">{{ t('摘录会加入待阅读列表，可单独阅读和制卡。') }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="button secondary"
            :disabled="busy || savingExcerpt"
            @click="excerptDraft = undefined"
          >
            {{ t('取消') }}
          </button>
          <button class="button primary" :disabled="busy || savingExcerpt">
            {{ t('保存摘录') }}
          </button>
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="schedulingRead && source && selectedPlan"
      :title="t('读过，安排下次')"
      :busy="busy || arranging"
      :error="actionError"
      @close="schedulingRead = false"
    >
      <form class="source-defer-form" @submit.prevent="saveReadSchedule">
        <label for="reading-schedule-mode">{{ t('间隔方式') }}</label>
        <select id="reading-schedule-mode" v-model="scheduleMode" :disabled="busy || arranging">
          <option value="fixed">{{ t('固定递增') }}</option>
          <option value="adaptive">{{ t('自适应') }}</option>
        </select>
        <fieldset
          v-if="scheduleMode === 'adaptive'"
          class="reading-feedback"
          :disabled="busy || arranging"
        >
          <legend>{{ t('这次理解如何？') }}</legend>
          <label
            v-for="(label, value) in { again: '需要再读', good: '基本理解', easy: '已经熟悉' }"
            :key="value"
          >
            <input v-model="readingFeedback" type="radio" name="reading-feedback" :value="value" />
            {{ t(label) }}
          </label>
        </fieldset>
        <p class="source-interval-summary">
          {{ t('本次间隔：{interval}', { interval: duration(selectedPlan.intervalDays, 'day') }) }}
        </p>
        <p class="source-interval-date">
          {{ t('下次阅读：{date}', { date: readingDate(selectedPlan.date) }) }}
        </p>
        <ol
          v-if="scheduleMode === 'fixed'"
          class="source-interval-steps"
          :aria-label="t('阅读间隔')"
        >
          <li
            v-for="days in READING_INTERVAL_DAYS"
            :key="days"
            :aria-current="days === selectedPlan.intervalDays ? 'step' : undefined"
          >
            {{ duration(days, 'day') }}
          </li>
        </ol>
        <p v-if="scheduleMode === 'fixed'" class="form-note">
          {{ t('每次确认后依次使用 1、3、7、14、30 天，之后保持 30 天。') }}
        </p>
        <p v-else class="form-note">
          {{ t('根据这次理解和距上次阅读的天数调整，间隔为 1–365 天。卡片仍由 FSRS 安排。') }}
        </p>
        <p class="form-note">{{ t('按本机日期安排，到这一天会自动加入待阅读列表。') }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="button secondary"
            :disabled="busy || arranging"
            @click="schedulingRead = false"
          >
            {{ t('取消') }}
          </button>
          <button class="button primary" :disabled="busy || arranging || !canMove">
            {{ t('保存阅读安排') }}
          </button>
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="resettingInterval && source"
      :title="t('重置间隔')"
      :busy="busy || arranging"
      :error="actionError"
      @close="resettingInterval = false"
    >
      <form class="source-defer-form" @submit.prevent="arrange({ type: 'reset-interval' })">
        <p>{{ t('下次从 1 天开始，已安排的阅读日期保持不变。') }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="button secondary"
            :disabled="busy || arranging"
            @click="resettingInterval = false"
          >
            {{ t('取消') }}
          </button>
          <button class="button primary" :disabled="busy || arranging">{{ t('重置间隔') }}</button>
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="deferring && source"
      :title="t('稍后阅读')"
      :busy="busy || arranging"
      :error="actionError"
      @close="deferring = false"
    >
      <form class="source-defer-form" @submit.prevent="arrange({ type: 'defer', date: deferDate })">
        <fieldset class="source-defer-options" :disabled="busy || arranging">
          <legend>{{ t('快捷安排') }}</legend>
          <div>
            <button
              v-for="option in deferOptions"
              :key="option.label"
              type="button"
              class="button secondary source-defer-option"
              :aria-pressed="deferDate === option.date"
              @click="deferDate = option.date"
            >
              <span>{{ t(option.label) }}</span>
              <time :datetime="option.date">{{ readingDate(option.date) }}</time>
            </button>
          </div>
        </fieldset>
        <label for="source-reading-date">{{ t('下次阅读日期') }}</label>
        <input
          id="source-reading-date"
          v-model="deferDate"
          type="date"
          required
          :min="nextReadingDay(now)"
          max="9999-12-31"
          :disabled="busy || arranging"
        />
        <p class="form-note">{{ t('按本机日期安排，到这一天会自动加入待阅读列表。') }}</p>
        <div class="form-actions">
          <button
            type="button"
            class="button secondary"
            :disabled="busy || arranging"
            @click="deferring = false"
          >
            {{ t('取消') }}
          </button>
          <button class="button primary" :disabled="busy || arranging">
            {{ t('保存阅读安排') }}
          </button>
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="importing"
      wide
      :title="t('导入材料')"
      :busy="busy || readingFile"
      :error="actionError"
      @close="closeImport"
    >
      <form class="editor-form source-import-form" @submit.prevent="save">
        <p class="form-note">
          {{ t('支持 UTF-8 文本和 Markdown，文件最大 1 MB，正文最多 250000 个字符。') }}
        </p>
        <input
          id="source-file"
          ref="fileInput"
          class="sr-only"
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          :disabled="busy || readingFile"
          :aria-label="t('选择材料文件')"
          @change="fileChanged"
        /><button
          type="button"
          class="button attachment-button"
          :disabled="busy || readingFile"
          @click="fileInput?.click()"
        >
          <Upload :size="18" />{{ t('选择材料文件') }}</button
        ><label for="source-title">{{ t('材料标题') }}</label
        ><input
          id="source-title"
          v-model="form.title"
          required
          maxlength="160"
          :disabled="busy || readingFile"
        /><label for="source-url">{{ t('来源链接（可选）') }}</label
        ><input
          id="source-url"
          v-model="form.url"
          type="url"
          maxlength="2048"
          placeholder="https://"
          :disabled="busy || readingFile"
        /><label for="source-format">{{ t('内容格式') }}</label
        ><select id="source-format" v-model="form.format" :disabled="busy || readingFile">
          <option value="markdown">Markdown</option>
          <option value="plain">{{ t('纯文本') }}</option></select
        ><label for="source-content">{{ t('粘贴正文') }}</label
        ><textarea
          id="source-content"
          v-model="form.content"
          required
          rows="10"
          :maxlength="MAX_SOURCE_CHARACTERS"
          :disabled="busy || readingFile"
        />
        <p v-if="readingFile" role="status">{{ t('正在读取原文…') }}</p>
        <p v-if="importError" class="import-warning" role="alert">{{ t(importError) }}</p>
        <div class="form-actions">
          <button type="button" class="button secondary" :disabled="busy" @click="closeImport">
            {{ t('取消') }}</button
          ><button class="button primary" :disabled="busy || readingFile">
            {{ t('保存材料') }}
          </button>
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="deleting && source"
      :title="t('删除材料？')"
      :busy="busy"
      :error="actionError"
      @close="deleting = false"
      ><div class="source-delete">
        <p>
          {{
            t(
              '将删除「{title}」的原文快照，并解除 {count} 条笔记的来源关联。卡片内容和复习进度保留。',
              { title: source.title, count: linked.length },
            )
          }}
        </p>
        <p
          v-if="library.sources.some((entry) => entry.origin?.sourceId === source!.id)"
          class="form-note"
        >
          {{ t('由此保存的摘录仍保留，出处关联会解除。') }}
        </p>
        <p class="form-note">{{ t('操作前会保存快照，可在「数据与备份」中恢复。') }}</p>
        <div class="form-actions">
          <button class="button secondary" :disabled="busy" @click="deleting = false">
            {{ t('取消') }}</button
          ><button class="button danger" :disabled="busy" @click="remove">
            {{ t('确认删除') }}
          </button>
        </div>
      </div></AppModal
    >
  </div>
</template>

<style scoped>
.reading-feedback {
  display: grid;
  gap: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem;
  margin: 1rem 0;
}
.reading-feedback label {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 32px;
  font-size: 1rem;
}
.source-defer-form .reading-feedback input[type='radio'] {
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  margin: 0;
  flex: 0 0 18px;
}
#reading-schedule-mode {
  width: 100%;
  min-height: 44px;
  font: inherit;
  margin: 0.5rem 0 1rem;
  padding: 0.65rem 0.75rem;
  color: inherit;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.source-selection-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 1rem;
  margin-bottom: 1rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fafbf8;
}
.source-selection-toolbar p {
  margin: 0;
}
.source-selection {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 44px;
  cursor: pointer;
  font-size: 0.875rem;
}
.source-selection input {
  width: 1.15rem;
  height: 1.15rem;
  min-height: 0;
  margin: 0;
  accent-color: #55765a;
}
.source-ancestry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  margin-bottom: 0.6rem;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.source-ancestry > * {
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: left;
}
.source-ancestry > * + *::before {
  content: '/';
  color: var(--muted);
  padding-right: 0.75rem;
}

.source-duplicate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin: 0;
  padding: 0.75rem 1rem;
  border-left: 3px solid #67886d;
  background: #f4f7ef;
}

.source-kind-badge {
  display: inline-block;
  justify-self: start;
  margin-bottom: 0.4rem;
  padding: 0.2rem 0.5rem;
  border-radius: 5px;
  color: #526149;
  background: #edf0e7;
  font-size: 0.875rem;
}
.source-excerpt-tools {
  display: grid;
  gap: 0.75rem;
}
.source-excerpt-tools p {
  margin: 0;
}
.source-excerpt-form,
.source-details-form {
  padding: 1.25rem 1.75rem;
  overflow: auto;
}
.source-excerpt-form textarea {
  min-height: 10rem;
  max-height: 35vh;
  white-space: pre-wrap;
  line-height: 1.7;
}

.reading-round {
  position: sticky;
  top: 0.75rem;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  border: 1px solid #b9cbb1;
  border-radius: 10px;
  background: #eef4e9;
}
.reading-round strong {
  font-size: 1rem;
}
.reading-round .form-note {
  margin: 0.4rem 0 0;
}
.reading-round-complete .source-actions {
  justify-content: center;
}
.reading-round-filter {
  overflow-wrap: anywhere;
}
.source-filters {
  padding: 1rem;
  margin-bottom: 1.25rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
.source-filter-fields {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.source-filter-field {
  display: grid;
  min-width: 0;
  gap: 0.5rem;
}
.source-filter-fields label {
  font-size: 1rem;
}
.source-filter-fields input,
.source-filter-fields select {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0.65rem 0.75rem;
  border: 1px solid #d4decd;
  border-radius: 8px;
  background: #fafbf8;
  color: inherit;
  font: inherit;
}
.source-filter-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  margin-top: 1rem;
}
.source-filter-footer p {
  margin: 0;
}
.source-queue-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}
.source-queue-filters button {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 44px;
  padding: 0.6rem 1rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  font-size: 1rem;
}
.source-queue-filters button[aria-pressed='true'] {
  background: #e7eee3;
  border-color: #67886d;
}
.source-queue-filters span {
  color: var(--muted);
  font-size: 0.875rem;
}
.source-reading-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.source-priority-control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 1rem;
}
.source-priority-control select {
  min-height: 44px;
  min-width: 6rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d4decd;
  border-radius: 8px;
  color: inherit;
  background: #fafbf8;
  font: inherit;
}
.source-priority-help {
  margin: 0;
}
.source-interval-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.source-interval-control p {
  margin: 0;
}
.source-interval-summary {
  font-size: 1.125rem;
  font-weight: 600;
}
.source-interval-date {
  font-size: 1rem;
}
.source-interval-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0;
  margin: 0;
  list-style: none;
}
.source-interval-steps li {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0.45rem 0.6rem;
  font-size: 0.875rem;
}
.source-interval-steps li[aria-current='step'] {
  border-color: #67886d;
  background: #e7eee3;
}
.source-queue-empty {
  padding: 2rem 1rem;
}
.source-defer-form {
  display: grid;
  gap: 1rem;
}
.source-defer-options {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.source-defer-options legend {
  padding: 0;
  margin-bottom: 0.75rem;
}
.source-defer-options > div {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}
.source-defer-option {
  display: grid;
  gap: 0.4rem;
  padding: 0.85rem 0.5rem;
  font-size: 1rem;
}
.source-defer-option time {
  color: var(--muted);
  font-size: 0.875rem;
}
.source-defer-option[aria-pressed='true'] {
  border-color: #67886d;
  background: #e7eee3;
}
@media (max-width: 480px) {
  .source-defer-options > div {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-defer-option {
    display: flex;
    justify-content: space-between;
    padding: 0.85rem 0.75rem;
  }
}
.source-defer-form input {
  min-width: 0;
  width: 100%;
  min-height: 44px;
  padding: 0.65rem;
  border: 1px solid #d4decd;
  border-radius: 8px;
  color: inherit;
  background: #fafbf8;
  font: inherit;
}
.sources-layout {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.sources-layout.round-layout {
  grid-template-columns: minmax(0, 1fr);
}
.source-list {
  display: grid;
  gap: 0.6rem;
  max-height: 70vh;
  overflow: auto;
  padding: 0.2rem;
}
.source-list-pages {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.source-list-item {
  text-align: left;
  display: grid;
  gap: 0.4rem;
  padding: 0.9rem;
  color: inherit;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow-wrap: anywhere;
}
.source-list-item.selected {
  border-color: #67886d;
  background: #eef4e9;
}
.source-list-title {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 0;
  cursor: pointer;
}
.source-continue {
  justify-self: start;
}
.reading-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--line);
}
.source-list-item span {
  font-size: 0.9rem;
  color: var(--muted);
}
.source-list-item .source-priority-badge {
  justify-self: start;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: #354d3d;
  background: #f4f7ef;
}
.source-reader {
  min-width: 0;
  padding: 1.4rem;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  display: grid;
  gap: 1rem;
}
.source-reader-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
}
.source-reader-heading > div {
  min-width: 0;
}
.source-reader h2 {
  margin: 0 0 0.5rem;
  overflow-wrap: anywhere;
}
.source-reader a {
  overflow-wrap: anywhere;
}
.source-actions {
  display: flex;
  gap: 0.8rem;
  align-items: center;
  flex-wrap: wrap;
}
.source-excerpt-action {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  align-items: center;
}
.source-linked ul {
  padding-left: 1.3rem;
  display: grid;
  gap: 0.6rem;
  overflow-wrap: anywhere;
}
.source-import-form {
  overflow: auto;
  padding: 1.25rem 1.75rem;
}
.source-import-form .form-actions {
  position: sticky;
  bottom: -1.25rem;
  margin: 0 -1.75rem -1.25rem;
  padding: 1rem 1.75rem;
  background: #fff;
  box-shadow: 0 -4px 12px #293d3308;
}
.source-import-form .attachment-button {
  justify-self: start;
}
.source-import-form input[type='file'] {
  width: 1px;
  min-height: 0;
  height: 1px;
}
.source-delete {
  padding: 1.25rem 1.75rem;
  line-height: 1.7;
}
@media (max-width: 850px) {
  .sources-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-list {
    max-height: min(22rem, 45vh);
  }
  .source-reader {
    padding: 1rem;
  }
  .source-text {
    min-height: 20rem;
  }
}
@media (max-width: 720px) {
  .source-filter-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-import-form,
  .source-excerpt-form,
  .source-details-form,
  .source-delete {
    padding: 1rem;
  }
  .source-import-form .form-actions {
    bottom: -1rem;
    margin: 0 -1rem -1rem;
    padding: 1rem;
  }
}
</style>
