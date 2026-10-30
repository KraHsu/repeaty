<script setup lang="ts">
import { UiButton, UiInput, UiSelect, UiCheckbox, UiTextarea, UiCollapsible } from './ui'
import URadioGroup from '@nuxt/ui/components/RadioGroup.vue'
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
  type ReadingUpdate,
  type Source,
  type SourceTarget,
  type SourceBatchUpdate,
  type SourceBatchAction,
  type ReadingFeedback,
  referencedSource,
  sourceAtVersion,
} from '../core/source-data'
import { adaptiveReadingPlan } from '../core/adaptive-reading'
import { materialLocked } from '../core/material-sequence'
import { sourceExcerpt, recentSource } from '../core/sources'
import { sourceArrangement } from '../core/reading-operations'
import { sourceContextPath } from '../core/source-tree'
import SourceBatchDialog from './SourceBatchDialog.vue'
import StudyPriorityField from './StudyPriorityField.vue'
import { studyPriorityOrigin } from './study-priority-label'
import {
  createPriorityResolver,
  effectiveSourcePriority,
  sourcePriorityGroup,
} from '../core/study-priority'
import { studyDay } from '../core/study-day'
import { studySettings } from '../core/study-settings'
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
import AppPage from './AppPage.vue'
import SourceReader from './SourceReader.vue'
import SourceContentEditor from './SourceContentEditor.vue'
import SourceMetadata from './SourceMetadata.vue'
import MaterialTree from './MaterialTree.vue'
import SourceAnnotations from './SourceAnnotations.vue'
import type { MaterialWorkbenchActions } from './material-workbench-actions'
import { useReadingPanels } from '../composables/useReadingPanels'
import MaterialImport from './MaterialImport.vue'
import CollectionImport from './CollectionImport.vue'
import InboxPanel from './InboxPanel.vue'
import MaterialSections from './MaterialSections.vue'
import MaterialSearch from './MaterialSearch.vue'
import SourceLinks from './SourceLinks.vue'
import { createMaterialKnowledge } from '../composables/material-knowledge'
import type { MaterialSearchHit, CollectionHostApi } from '@repeaty/plugin-api'
import type { MaterialLocator } from '../core/material-data'
import SourceContext from './SourceContext.vue'
import SourceExcerptList from './SourceExcerptList.vue'
import { excerptsForSource, matchingExcerpts } from '../core/source-navigation'
import type { CollectionInput } from '../core/collection-input'
import type { MenuAction } from '../input/menus'

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
  getMedia?: (id: string) => Promise<Blob | undefined>
  read: (id: string, signal?: AbortSignal, mediaId?: string) => Promise<string>
  save: (input: SourceInput, scope: string) => Promise<boolean>
  updateDetails: (update: SourceDetailsUpdate) => Promise<boolean>
  saveExcerpt: (input: SaveSourceExcerptInput) => Promise<boolean>
  remove: (id: string, scope: string) => Promise<boolean>
  arrange: (update: SourceQueueUpdate) => Promise<boolean>
  saveReading: (update: ReadingUpdate) => Promise<boolean>
  workbench?: MaterialWorkbenchActions
  readProperties?: (id: string) => Promise<string>
  collection?: CollectionHostApi
  readClipboard?: () => Promise<CollectionInput>
}>()
const emit = defineEmits<{
  create: [excerpt: SourceExcerpt, format: 'plain' | 'markdown', type?: 'cloze']
  edit: [noteId: string]
  share: [excerpt: SourceExcerpt]
  clearNotice: []
  review: []
  startHandled: []
  sessionDone: [arranged: boolean]
  activity: [busy: boolean]
  settings: [category: string]
}>()
const newKnowledge = () =>
  createMaterialKnowledge({
    sources: () => props.library.sources,
    scope: () => props.scope,
    read: (id, signal, mediaId) => props.read(id, signal, mediaId),
  })
const knowledge = shallowRef(newKnowledge())
const wikiTarget = ref<string>()
watch(
  () => props.scope,
  () => {
    knowledge.value.dispose()
    knowledge.value = newKnowledge()
    wikiTarget.value = undefined
  },
  { flush: 'sync' },
)
onUnmounted(() => knowledge.value.dispose())
const scheduling = computed(() => studySettings(props.library))
const today = computed(() => studyDay(props.now, scheduling.value))
const section = ref<'library' | 'inbox' | 'connections'>('library')
const collectionImport = ref<InstanceType<typeof CollectionImport>>()
const collecting = ref(false)
const inboxCount = computed(
  () => props.library.sources.filter((source) => source.inbox?.state === 'new').length,
)
async function changeSection(value: 'library' | 'inbox' | 'connections') {
  if (value === section.value || props.busy || moving.value || inRound.value) return
  const scope = props.scope
  if (section.value === 'library') {
    if (!(await flushEditor()) || (reader.value?.ready && !(await savePosition()))) return
    if (!alive || scope !== props.scope) return
  }
  section.value = value
}
async function openCollection() {
  const scope = props.scope
  if (!(await flushEditor()) || (reader.value?.ready && !(await savePosition()))) return
  if (!alive || scope !== props.scope) return
  collectionImport.value?.show()
}
function collected(ids: readonly string[], destination: 'inbox' | 'library') {
  if (destination === 'inbox') section.value = 'inbox'
  else {
    section.value = 'library'
    resetFilters()
    view.value = 'all'
    page.value = 0
    selectedId.value = ids[0] ?? ''
  }
}
async function filed(id: string) {
  section.value = 'library'
  resetFilters()
  view.value = 'all'
  await nextTick()
  await openSource(id)
}
const editingContent = ref(false)
const contentEditor = ref<InstanceType<typeof SourceContentEditor>>()
const annotations = ref<InstanceType<typeof SourceAnnotations>>()
const filtersOpen = ref(false),
  bulkOpen = ref(false)
const panels = useReadingPanels(computed(() => props.scope))
const organizationView = panels.organizationView
const contextOpen = panels.contextOpen
function toggleBulk() {
  bulkOpen.value = !(bulkOpen.value || selection.value.size)
  if (!bulkOpen.value) selection.value = new Map()
}
function clearBulk() {
  selection.value = new Map()
  bulkOpen.value = false
}
function openWiki(target: string) {
  contextOpen.value = true
  wikiTarget.value = target
}
function addAnnotation() {
  contextOpen.value = true
  if (excerpt.value) annotations.value?.add(excerpt.value)
}
async function beginEdit() {
  if (!props.workbench || !editableText.value || props.busy || loading.value || error.value) return
  const current = source.value,
    scope = props.scope
  if (!((await annotations.value?.flush()) ?? true)) return
  if (reader.value?.ready && !(await savePosition())) return
  if (
    !alive ||
    props.scope !== scope ||
    source.value?.id !== current?.id ||
    source.value?.mediaId !== current?.mediaId
  )
    return
  editingContent.value = true
}
async function flushEditor() {
  if (!((await annotations.value?.flush()) ?? true)) return false
  return !editingContent.value || !!(await contentEditor.value?.flush())
}
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
const matchingSources = computed(() =>
  filterSources(props.library.sources, filters.value, props.library),
)
const effectivePriorityGroups = computed(() => {
  const resolver = createPriorityResolver(props.library)
  return new Map(
    props.library.sources.map((source) => {
      const priority = resolver.source(source)
      return [
        source.id,
        priority.numeric || scheduling.value.priorityMode === 'weighted'
          ? sourcePriorityGroup(priority.value)
          : (source.priority ?? 'normal'),
      ]
    }),
  )
})
const readyCount = computed(
  () =>
    props.library.sources.filter(
      (source) => sourceQueueState(source, today.value, props.library.sources) === 'ready',
    ).length,
)
const counts = computed(() =>
  Object.fromEntries(
    queueViews.map((value) => [
      value,
      matchingSources.value.filter(
        (entry) =>
          value === 'all' ||
          (!entry.document?.container &&
            sourceQueueState(entry, today.value, props.library.sources) === value),
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
    recentSource(queuedSources(props.library.sources, 'ready', today.value, {}, props.library))
      ?.id ??
    '',
)
const source = computed(() =>
  props.library.sources.find(
    (entry) =>
      entry.id === selectedId.value && (!props.session || entry.mediaId === props.session.mediaId),
  ),
)
const editableText = computed(
  () =>
    !!source.value &&
    (!source.value.document ||
      ['markdown', 'md', 'plain', 'text', 'txt'].includes(source.value.document.format)),
)
watch(
  () => source.value?.id,
  () => {
    wikiTarget.value = undefined
  },
)
async function searchSettings() {
  if (!(await flushEditor())) return
  if (reader.value?.ready && !(await savePosition())) return
  emit('settings', 'general.search')
}
const linked = computed(() =>
  props.library.notes.filter((note) => note.excerpt?.sourceId === selectedId.value),
)
const text = ref(''),
  error = ref<DisplayMessage>(''),
  loading = ref(false),
  excerpt = ref<SourceExcerpt>()
const original = computed(() => {
  const entry = props.library.sources.find((entry) => entry.id === source.value?.origin?.sourceId)
  return entry && source.value?.origin ? referencedSource(entry, source.value.origin) : undefined
})
const versionsOpen = ref(false)
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
function openVersion(mediaId: string) {
  if (source.value) ancestrySource.value = sourceAtVersion(source.value, mediaId)
  versionsOpen.value = false
}
const viewedSelection = computed<SourceExcerpt | undefined>(() => {
  const child = viewedExcerpt.value
  if (!child?.origin || child.derived || loading.value || error.value || !text.value)
    return undefined
  return {
    sourceId: child.id,
    mediaId: child.mediaId,
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
  queuedSources(props.library.sources, view.value, today.value, filters.value, props.library),
)
const pages = computed(() => Math.max(1, Math.ceil(filteredSources.value.length / pageSize)))
const filteredSourceIds = computed(() => new Set(filteredSources.value.map((item) => item.id)))
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
const roundUndo = shallowRef<{ id: string; before: ReadingRound; after: ReadingRound }[]>([])
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
      roundUndo.value = []
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
    previous = roundUndo.value.find((entry) => entry.id === undoId)
  undoing.value = true
  moving.value = true
  emit('clearNotice')
  try {
    if ((await props.undoReading()) && alive && props.scope === scope) {
      if (previous && previous.id === undoId && current === previous.after)
        showRound(reconcileReadingRound(previous.before, props.library.sources, today.value))
      roundUndo.value = roundUndo.value.filter((entry) => entry.id !== undoId)
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
  if (editingContent.value || annotations.value?.dirty || organizationView.value === 'tree') return
  if (!inRound.value && !sources.some((entry) => entry.id === selectedId.value)) {
    selectedId.value = sources[page.value * pageSize]?.id ?? sources[0]?.id ?? ''
  }
  page.value = Math.min(page.value, pages.value - 1)
})
watch([() => source.value?.id, () => source.value?.mediaId, () => props.scope], load, {
  immediate: true,
})
watch(
  () => props.scope,
  () => {
    editingContent.value = false
    section.value = 'library'
    navigationGeneration++
  },
  { flush: 'sync' },
)
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
  const id = source.value.id,
    mediaId = source.value.mediaId,
    scope = props.scope
  try {
    const result = await props.read(id, current.signal, mediaId)
    if (
      alive &&
      controller === current &&
      !current.signal.aborted &&
      props.scope === scope &&
      source.value?.id === id &&
      source.value.mediaId === mediaId
    )
      text.value = result
  } catch (issue) {
    if (!current.signal.aborted) error.value = issue as Error
  } finally {
    if (controller === current) loading.value = false
  }
}
function select(sourceId: string, start: number, end: number, locator?: MaterialLocator) {
  if (!source.value || source.value.id !== sourceId) return
  try {
    excerpt.value = sourceExcerpt(source.value, text.value, start, end)
    if (locator) excerpt.value.locator = locator
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
  if (!(await openSource(id))) return
  await nextTick()
  await readingLoad
  await nextTick()
  if (scope === props.scope && source.value?.id === id) await reader.value?.resume()
}
let navigationGeneration = 0
async function openSource(id: string) {
  if (id === selectedId.value) return true
  const generation = ++navigationGeneration,
    scope = props.scope
  if (!(await flushEditor())) return false
  if (
    !alive ||
    generation !== navigationGeneration ||
    props.scope !== scope ||
    !props.library.sources.some((item) => item.id === id)
  )
    return false
  editingContent.value = false
  selectedId.value = id
  const entry = props.library.sources.find((source) => source.id === id)
  if (entry?.reading)
    props.reading.record(
      { sourceId: id, mediaId: entry.mediaId, scope: props.scope, position: entry.reading },
      true,
    )
  return true
}
async function openSearchResult(hit: MaterialSearchHit) {
  const entry = props.library.sources.find(
    (item) => item.id === hit.sourceId && item.mediaId === hit.versionId,
  )
  if (!entry || props.busy || inRound.value) return
  const scope = props.scope
  resetFilters()
  view.value = 'all'
  page.value = Math.max(
    0,
    Math.floor(filteredSources.value.findIndex((item) => item.id === hit.sourceId) / pageSize),
  )
  if (!(await openSource(entry.id))) return
  await nextTick()
  await readingLoad
  await nextTick()
  if (
    !alive ||
    scope !== props.scope ||
    source.value?.id !== hit.sourceId ||
    source.value.mediaId !== hit.versionId
  )
    return
  if (hit.locator?.kind === 'text') {
    try {
      await reader.value?.locate({
        sourceId: hit.sourceId,
        mediaId: hit.versionId,
        start: hit.locator.start,
        end: hit.locator.end,
        locator: hit.locator,
      })
    } catch (issue) {
      if (alive && scope === props.scope) navigationError.value = issue as Error
    }
  }
}
async function openDocumentSource(id: string, locator?: MaterialLocator) {
  if (props.busy || inRound.value) return
  const entry = props.library.sources.find((source) => source.id === id)
  if (!entry || (locator && (locator.sourceId !== id || locator.versionId !== entry.mediaId)))
    return
  const scope = props.scope
  if (!(await openSource(id))) return
  if (!locator) return
  await nextTick()
  await readingLoad
  await nextTick()
  if (
    !alive ||
    scope !== props.scope ||
    source.value?.id !== id ||
    source.value.mediaId !== locator.versionId
  )
    return
  const start =
    locator.kind === 'text' || locator.kind === 'epub' || locator.kind === 'formula'
      ? (locator.start ?? 0)
      : 0
  const end =
    locator.kind === 'text' || locator.kind === 'epub' || locator.kind === 'formula'
      ? (locator.end ?? Math.min(text.value.length, start + 1))
      : Math.min(text.value.length, 1)
  try {
    await reader.value?.locate({ sourceId: id, mediaId: locator.versionId, start, end, locator })
  } catch (issue) {
    if (alive && scope === props.scope) navigationError.value = issue as Error
  }
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
  { label: '明天', date: nextReadingDay(props.now, 1, scheduling.value) },
  { label: '3 天后', date: nextReadingDay(props.now, 3, scheduling.value) },
  { label: '1 周后', date: nextReadingDay(props.now, 7, scheduling.value) },
])
let releaseReading: (() => void) | undefined
watch(
  () =>
    importing.value ||
    collecting.value ||
    deleting.value ||
    deferring.value ||
    schedulingRead.value ||
    resettingInterval.value ||
    moving.value ||
    editingContent.value ||
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
const intervalPlan = computed(
  () => source.value && nextReadingInterval(source.value, props.now, props.library),
)
const scheduleMode = ref<'fixed' | 'adaptive'>('fixed')
const readingFeedback = ref<ReadingFeedback>('good')
const adaptivePlan = computed(
  () =>
    source.value &&
    adaptiveReadingPlan(source.value, readingFeedback.value, props.now, scheduling.value),
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
    (!!reader.value?.ready || editingContent.value),
)
// Locating an excerpt only moves within the already loaded immutable text.
// Background persistence must not disable its focused keyboard control.
const canLocateExcerpt = computed(
  () =>
    !arranging.value &&
    !moving.value &&
    !loading.value &&
    !error.value &&
    !editingContent.value &&
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
    if (!(await flushEditor())) return false
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
defineExpose({
  studying: computed(() => Boolean(source.value && !error.value)),
  leaveSession,
  undoArrangement,
  locked: computed(
    () =>
      props.busy ||
      moving.value ||
      arranging.value ||
      loading.value ||
      undoing.value ||
      (!!source.value && !editingContent.value && !error.value && !reader.value?.ready),
  ),
})
function showRound(next: ReadingRound) {
  editingContent.value = false
  round.value = next
  selectedId.value = next.entries[next.cursor]?.sourceId ?? ''
  const index = filteredSources.value.findIndex((entry) => entry.id === selectedId.value)
  if (index >= 0) page.value = Math.floor(index / pageSize)
}
watch([() => props.library.sources, today, () => props.busy, moving, arranging], () => {
  if (
    !round.value ||
    props.busy ||
    moving.value ||
    arranging.value ||
    editingContent.value ||
    annotations.value?.dirty
  )
    return
  const next = reconcileReadingRound(round.value, props.library.sources, today.value)
  if (next !== round.value) showRound(next)
})
async function savePosition() {
  if (editingContent.value) return flushEditor()
  if (!((await annotations.value?.flush()) ?? true)) return false
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
    const next = startReadingRound(props.library.sources, today.value, chosen, props.library)
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
  source.value ? sourceQueueState(source.value, today.value, props.library.sources) : undefined,
)
function openDefer() {
  emit('clearNotice')
  deferDate.value = nextReadingDay(props.now, 1, scheduling.value)
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
      !(await flushEditor()) ||
      !alive ||
      props.scope !== scope ||
      source.value?.id !== current.id
    )
      return
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
            roundUndo.value = [
              ...roundUndo.value.slice(-19),
              { id: props.readingUndoId, before: started, after },
            ]
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
function changePriority(priority: string) {
  if (priority !== 'high' && priority !== 'normal' && priority !== 'low') return
  return arrange({ type: 'priority', priority })
}
async function changeStudyPriority(value: number | undefined) {
  if (
    !source.value ||
    props.busy ||
    arranging.value ||
    moving.value ||
    !props.workbench?.setPriority
  )
    return
  const target = source.value.id,
    scope = props.scope
  arranging.value = true
  emit('clearNotice')
  try {
    if (
      !(await flushEditor()) ||
      (reader.value?.ready && !(await savePosition())) ||
      !alive ||
      scope !== props.scope ||
      source.value?.id !== target
    )
      return
    if (await props.workbench.setPriority('source', target, value)) {
      if (!alive || scope !== props.scope) return
      const index = filteredSources.value.findIndex((entry) => entry.id === target)
      if (index >= 0) page.value = Math.floor(index / pageSize)
    }
  } finally {
    if (scope === props.scope) arranging.value = false
  }
}
async function locateExcerpt(id: string) {
  const entry = savedExcerpts.value.find((entry) => entry.source.id === id)
  if (!entry || !canLocateExcerpt.value) return
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
async function openImport() {
  const scope = props.scope
  if (!(await flushEditor()) || !alive || props.scope !== scope) return
  editingContent.value = false
  emit('clearNotice')
  fileGeneration++
  readingFile.value = false
  Object.assign(form, { title: '', url: '', format: 'markdown', content: '' })
  importError.value = ''
  importing.value = true
}
function openDetails() {
  const current = source.value
  if (
    !current ||
    props.busy ||
    moving.value ||
    arranging.value ||
    savingDetails.value ||
    editingContent.value
  )
    return
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
  const scope = props.scope,
    generation = fileGeneration
  if (
    (await props.save({ ...form }, scope)) &&
    alive &&
    props.scope === scope &&
    fileGeneration === generation
  ) {
    importing.value = false
    resetFilters()
    view.value = 'ready'
    page.value = 0
    selectedId.value = props.library.sources.at(-1)?.id ?? ''
  }
}
async function remove() {
  const current = source.value,
    scope = props.scope
  if (!(await flushEditor()) || !alive || props.scope !== scope || current?.id !== source.value?.id)
    return
  if (current && (await props.remove(current.id, scope)) && alive && props.scope === scope) {
    deleting.value = false
    editingContent.value = false
  }
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
const readerActions = computed<MenuAction[]>(() => [
  {
    id: 'material.excerpt',
    title: t('保存为摘录'),
    disabled: props.busy || !excerpt.value,
    run: openExcerpt,
  },
  {
    id: 'material.card',
    title: t('用摘录制卡'),
    disabled: props.busy || !excerpt.value || !props.library.decks.length,
    run: () => {
      if (excerpt.value && source.value) emit('create', excerpt.value, source.value.format)
    },
  },
  ...(props.canShare
    ? [
        {
          id: 'material.share',
          title: t('通过 MCP 制卡'),
          disabled: props.busy || !excerpt.value || !props.library.decks.length,
          run: () => {
            if (excerpt.value) emit('share', excerpt.value)
          },
        },
      ]
    : []),
  ...(props.workbench
    ? [
        {
          id: 'material.cloze',
          title: t('制作挖空卡'),
          disabled: props.busy || !excerpt.value || !props.library.decks.length,
          run: () => {
            if (excerpt.value && source.value)
              emit('create', excerpt.value, source.value.format, 'cloze')
          },
        },
        {
          id: 'material.annotation',
          title: t('添加批注'),
          disabled: props.busy || !excerpt.value,
          run: addAnnotation,
        },
      ]
    : []),
])
</script>

<template>
  <AppPage
    class="sources-page"
    :title="session ? undefined : t('学习材料')"
    :description="t('保存原文，选取摘录制作卡片。')"
  >
    <template #actions>
      <MaterialImport
        v-if="!session && !collection"
        :scope="scope"
        :busy="busy || moving || inRound || editingContent || !!annotations?.dirty"
        @imported="
          (ids) => {
            resetFilters()
            view = 'all'
            page = 0
            selectedId = ids[0] ?? ''
          }
        "
      />
      <UiButton
        variant="secondary"
        type="submit"
        v-if="canUndoReading && !session"
        :title="t('撤销最近一次阅读安排（刷新后清除）')"
        :disabled="busy || moving || arranging || undoing"
        @click="undoArrangement"
      >
        {{ t('撤销阅读安排') }}
      </UiButton>
      <UiButton
        variant="secondary"
        type="submit"
        v-if="!inRound && section === 'library'"
        :disabled="busy || moving || arranging || !readyCount || (!!source && !canMove)"
        @click="beginRound()"
      >
        {{ t('开始一轮阅读') }}
      </UiButton>
      <UiButton
        v-if="collection && !session"
        variant="primary"
        :disabled="moving || inRound"
        @click="openCollection"
      >
        <Plus :size="18" />{{ t('收集材料') }}
      </UiButton>
      <UiButton
        v-else
        variant="primary"
        type="submit"
        :disabled="busy || moving || inRound"
        @click="openImport"
      >
        <Plus :size="18" />{{ t('导入材料') }}
      </UiButton>
    </template>
    <MaterialSections
      v-if="collection && !session && !inRound"
      :model-value="section"
      :inbox-count="inboxCount"
      :connections="!!$slots.connections"
      :disabled="busy || moving"
      @update:model-value="changeSection"
    />
    <InboxPanel
      v-if="collection && section === 'inbox' && !inRound"
      :api="collection"
      :scope="scope"
      :sources="library.sources"
      :busy="busy"
      :read="read"
      :get-media="getMedia"
      @collect="openCollection"
      @filed="filed"
      @create="(excerpt, format) => emit('create', excerpt, format)"
    />
    <slot v-else-if="section === 'connections' && !inRound" name="connections" />
    <div v-else-if="!library.sources.length && !workbench && !inRound" class="empty-state">
      <FileText :size="36" />
      <h2>{{ t('还没有学习材料') }}</h2>
      <p>{{ t('导入文本或 Markdown，也可以直接粘贴。原文会保存在当前学习库中。') }}</p>
    </div>
    <template v-else>
      <section v-if="session" class="reading-round" :aria-label="t('本轮阅读')">
        <p>{{ t('阅读位置会保存；可安排下次阅读，或直接继续。') }}</p>
        <UiButton
          variant="primary"
          type="submit"
          :disabled="busy || moving || arranging || loading"
          @click="finishSession"
        >
          {{ t(error ? '跳过本篇' : '完成阅读，继续学习') }}
        </UiButton>
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
          <UiButton variant="primary" type="submit" :disabled="!canMove" @click="nextSource">
            {{ t(round.cursor + 1 === round.entries.length ? '完成本轮' : '下一篇') }}
          </UiButton>
          <UiButton
            variant="ghost"
            type="submit"
            :disabled="busy || moving || arranging"
            @click="stopRound"
          >
            {{ t('结束本轮') }}
          </UiButton>
        </div>
      </section>
      <MaterialSearch
        v-if="!inRound"
        :scope="scope"
        :busy="busy"
        :knowledge="knowledge"
        @open="openSearchResult"
        @settings="searchSettings"
      />
      <div v-if="!inRound" class="source-toolbar">
        <nav class="source-queue-filters" :aria-label="t('阅读队列')">
          <UiButton
            variant="secondary"
            v-for="value in queueViews"
            :key="value"
            type="button"
            :aria-pressed="view === value"
            :disabled="busy || moving || arranging || inRound"
            @click="view = value"
          >
            {{ t(queueLabels[value]) }} <span>{{ counts[value] }}</span>
          </UiButton>
        </nav>
        <div class="source-tools">
          <UiButton
            variant="ghost"
            :aria-expanded="filtersOpen"
            :aria-pressed="hasFilters"
            @click="filtersOpen = !filtersOpen"
            >{{ t('筛选材料') }}</UiButton
          >
          <UiButton
            variant="ghost"
            :aria-expanded="bulkOpen || !!selection.size"
            @click="toggleBulk"
            >{{ t('批量选择') }}</UiButton
          >
          <UiButton
            variant="ghost"
            :aria-expanded="contextOpen"
            @click="contextOpen = !contextOpen"
            >{{ t('上下文') }}</UiButton
          >
        </div>
      </div>
      <section
        v-if="!inRound"
        v-show="filtersOpen"
        class="source-filters"
        :aria-label="t('材料筛选')"
      >
        <div class="source-filter-fields">
          <div class="source-filter-field source-search">
            <label for="source-search">{{ t('搜索材料') }}</label>
            <UiInput
              id="source-search"
              v-model="query"
              type="search"
              :placeholder="t('搜索标题')"
              :disabled="busy || moving || arranging"
            />
          </div>
          <div class="source-filter-field">
            <label for="source-kind-filter">{{ t('材料类型') }}</label>
            <UiSelect
              :items="[
                ...Object.entries(kindLabels).map(([value, label]) => ({
                  label: t(label),
                  value: value,
                })),
              ]"
              id="source-kind-filter"
              v-model="kind"
              :disabled="busy || moving || arranging"
            ></UiSelect>
          </div>
          <div class="source-filter-field">
            <label for="source-priority-filter">{{ t('优先级筛选') }}</label>
            <UiSelect
              :items="[
                { label: t('全部优先级'), value: 'all' },
                ...Object.entries(priorityBadges).map(([value, label]) => ({
                  label: t(label),
                  value: value,
                })),
              ]"
              id="source-priority-filter"
              v-model="priority"
              :disabled="busy || moving || arranging"
            ></UiSelect>
          </div>
        </div>
        <div class="source-filter-footer">
          <div class="source-actions">
            <UiButton
              variant="secondary"
              type="submit"
              :disabled="
                busy || moving || arranging || !filteredReadyCount || (!!source && !canMove)
              "
              aria-describedby="source-filter-count"
              @click="beginRound(filters)"
            >
              {{ t('阅读筛选结果') }}
            </UiButton>
            <UiButton
              variant="ghost"
              type="submit"
              v-if="hasFilters"
              :disabled="busy || moving || arranging"
              @click="resetFilters"
            >
              {{ t('清除筛选') }}
            </UiButton>
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
        v-if="!inRound && filteredSources.length && (bulkOpen || selection.size)"
        class="source-selection-toolbar"
        :aria-label="t('批量选择材料')"
      >
        <p role="status">{{ t('已选 {count} 篇材料', { count: selection.size }) }}</p>
        <div class="source-actions">
          <UiButton
            variant="ghost"
            type="submit"
            :disabled="busy || moving || arranging"
            @click="selectSources(visibleSources)"
          >
            {{ t('选择本页') }}
          </UiButton>
          <UiButton
            variant="ghost"
            type="submit"
            :disabled="busy || moving || arranging"
            @click="selectSources(filteredSources)"
          >
            {{ t('选择全部筛选结果（{count}）', { count: filteredSources.length }) }}
          </UiButton>
          <UiButton
            variant="ghost"
            type="submit"
            v-if="selection.size"
            :disabled="busy || moving || arranging"
            @click="clearBulk"
          >
            {{ t('取消选择') }}
          </UiButton>
          <UiButton
            variant="secondary"
            type="submit"
            :disabled="busy || moving || arranging || !selection.size"
            @click="openBatch"
          >
            {{ t('批量安排') }}
          </UiButton>
        </div>
      </section>
      <div
        class="sources-layout"
        :class="{ 'round-layout': inRound, 'has-context': contextOpen && source && !roundEnded }"
        :style="panels.style.value"
      >
        <aside v-if="!inRound" class="source-list">
          <div v-if="workbench" class="source-list-switch" :aria-label="t('材料浏览方式')">
            <UiButton
              variant="ghost"
              :aria-pressed="organizationView === 'list'"
              @click="organizationView = 'list'"
              >{{ t('列表') }}</UiButton
            >
            <UiButton
              variant="ghost"
              :aria-pressed="organizationView === 'tree'"
              @click="organizationView = 'tree'"
              >{{ t('目录') }}</UiButton
            >
          </div>
          <MaterialTree
            v-if="organizationView === 'tree' && workbench"
            :visible-source-ids="filteredSourceIds"
            :scope="scope"
            :library="library"
            :selected-id="selectedId"
            :busy="busy || moving"
            :actions="workbench"
            @open="openSource"
          />
          <template v-else>
            <p v-if="!visibleSources.length" class="form-note">{{ t('没有找到材料。') }}</p>
            <div
              v-for="entry in visibleSources"
              :key="entry.id"
              class="source-list-item"
              :class="{ selected: entry.id === selectedId }"
            >
              <label class="source-selection">
                <UiCheckbox
                  :model-value="selection.has(entry.id)"
                  :disabled="busy || moving || arranging"
                  :aria-label="t('选择材料「{title}」', { title: entry.title })"
                  @update:model-value="toggleSelection(entry)"
                />
                <span>{{ t('选择') }}</span>
              </label>
              <UiButton
                variant="ghost"
                class="source-list-title"
                :aria-pressed="entry.id === selectedId"
                :disabled="busy || moving || inRound"
                @click="openSource(entry.id)"
              >
                <strong>{{ entry.title }}</strong></UiButton
              ><span
                >{{
                  entry.document?.format.toUpperCase() ??
                  (entry.format === 'markdown' ? 'Markdown' : t('纯文本'))
                }}
                · {{ new Date(entry.createdAt).toLocaleDateString(locale) }}</span
              >
              <span v-if="entry.kind === 'excerpt'" class="source-kind-badge">{{ t('摘录') }}</span>
              <span class="source-queue-state">{{
                entry.document?.container
                  ? t('文档目录')
                  : entry.studySequence?.completed
                    ? t('本章已完成')
                    : materialLocked(entry, library.sources)
                      ? t('待前章完成')
                      : sourceQueueState(entry, today, library.sources) === 'archived'
                        ? t('已归档')
                        : entry.queue
                          ? t('安排于 {date}', { date: readingDate(entry.queue.availableOn) })
                          : t('待阅读')
              }}</span>
              <span
                v-if="effectivePriorityGroups.get(entry.id) !== 'normal'"
                class="source-priority-badge"
              >
                {{ t(priorityBadges[effectivePriorityGroups.get(entry.id) ?? 'normal']) }}
              </span>
              <template v-if="entry.reading">
                <span>{{
                  t('上次阅读 {date}', {
                    date: new Date(entry.reading.updatedAt).toLocaleString(locale),
                  })
                }}</span>
                <UiButton
                  variant="ghost"
                  type="submit"
                  class="source-continue"
                  :disabled="busy || moving || inRound"
                  @click="resume(entry.id)"
                >
                  {{ t('继续阅读') }}
                </UiButton>
              </template>
            </div>
            <nav v-if="pages > 1" class="source-list-pages" :aria-label="t('材料列表分页')">
              <UiButton variant="ghost" type="button" :disabled="page === 0" @click="page--">
                {{ t('上一页') }}</UiButton
              ><span>{{ page + 1 }} / {{ pages }}</span
              ><UiButton
                variant="ghost"
                type="button"
                :disabled="page + 1 >= pages"
                @click="page++"
              >
                {{ t('下一页') }}
              </UiButton>
            </nav>
          </template>
        </aside>
        <div
          v-if="!inRound"
          class="reading-splitter reading-splitter-left"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          :aria-label="t('调整材料列表宽度')"
          :aria-valuenow="panels.left.value"
          aria-valuemin="180"
          aria-valuemax="320"
          @pointerdown="panels.start($event, 'left')"
          @pointermove="panels.move"
          @pointerup="panels.end"
          @pointercancel="panels.cancel"
          @lostpointercapture="panels.cancel"
          @keydown="panels.keyboard($event, 'left')"
        />
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
            <UiButton
              variant="primary"
              type="submit"
              :disabled="busy || moving || !(roundFilter ? filteredReadyCount : readyCount)"
              @click="beginRound(roundFilter)"
            >
              {{ t('再读一轮') }}
            </UiButton>
            <UiButton
              variant="secondary"
              type="submit"
              :disabled="busy || moving"
              @click="stopRound"
            >
              {{ t('返回材料') }}
            </UiButton>
            <UiButton
              variant="secondary"
              type="submit"
              :disabled="busy || moving"
              @click="emit('review')"
            >
              {{ t('去复习卡片') }}
            </UiButton>
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
                  <UiButton
                    variant="ghost"
                    type="submit"
                    v-else
                    :disabled="busy || moving"
                    @click="ancestrySource = entry.source"
                  >
                    {{ entry.source.title }}
                  </UiButton>
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
              <UiButton
                v-if="inRound"
                variant="ghost"
                :aria-expanded="contextOpen"
                @click="contextOpen = !contextOpen"
                >{{ t('上下文') }}</UiButton
              >
              <UiButton
                v-if="workbench && !session && !editingContent && editableText"
                variant="primary"
                :disabled="busy || moving || loading || !!error"
                @click="beginEdit"
                >{{ t('编辑正文') }}</UiButton
              >
              <UiButton
                variant="secondary"
                type="submit"
                :disabled="
                  busy || moving || arranging || exporting || savingDetails || editingContent
                "
                @click="openDetails"
              >
                {{ t('编辑材料信息') }}
              </UiButton>
              <UiButton
                variant="secondary"
                type="submit"
                v-if="source.versions?.length"
                :disabled="busy || moving"
                @click="versionsOpen = true"
              >
                {{ t('历史版本') }}
              </UiButton>
              <UiButton
                variant="secondary"
                type="submit"
                :disabled="loading || !!error || exporting"
                @click="download"
              >
                {{ t('导出原文') }}</UiButton
              ><UiButton
                variant="danger"
                type="submit"
                :disabled="(busy && !reading.savingId.value) || exporting || moving"
                @click="openDelete"
              >
                {{ t('删除材料') }}
              </UiButton>
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
            <StudyPriorityField
              v-if="workbench?.setPriority"
              id="source-study-priority"
              :model-value="
                source.studyPriority ??
                (source.priority ? { high: 1, normal: 5, low: 9 }[source.priority] : undefined)
              "
              :inherited-value="
                effectiveSourcePriority(
                  { ...source, studyPriority: undefined, priority: undefined },
                  library,
                ).value
              "
              :inherited-from="
                studyPriorityOrigin(
                  library,
                  effectiveSourcePriority(
                    { ...source, studyPriority: undefined, priority: undefined },
                    library,
                  ),
                )
              "
              :disabled="busy || arranging"
              @update:model-value="changeStudyPriority"
            />
            <div v-else class="source-priority-control">
              <label for="source-reading-priority">{{ t('阅读优先级') }}</label>
              <UiSelect
                :items="[
                  ...Object.entries(priorityLabels).map(([value, label]) => ({
                    label: t(label),
                    value: value,
                  })),
                ]"
                id="source-reading-priority"
                :model-value="source.priority ?? 'normal'"
                :disabled="busy || arranging || moving"
                aria-describedby="source-priority-help"
                @update:model-value="changePriority"
              ></UiSelect>
            </div>
            <div class="source-actions">
              <UiButton
                variant="primary"
                type="submit"
                v-if="queueState !== 'archived'"
                :disabled="!canMove"
                @click="openReadSchedule"
              >
                {{ t('读过，安排下次') }}
              </UiButton>
              <UiButton
                variant="secondary"
                type="submit"
                v-if="queueState !== 'ready'"
                :disabled="busy || arranging || moving"
                @click="arrange({ type: 'restore' })"
              >
                {{ t('加入待阅读') }}
              </UiButton>
              <UiButton
                variant="secondary"
                type="submit"
                v-if="queueState !== 'archived'"
                :disabled="busy || arranging || moving"
                @click="openDefer"
              >
                {{ t('稍后阅读') }}
              </UiButton>
              <UiButton
                variant="ghost"
                type="submit"
                v-if="queueState !== 'archived'"
                :disabled="busy || arranging || moving"
                @click="arrange({ type: 'archive' })"
              >
                {{ t('归档材料') }}
              </UiButton>
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
            <UiButton
              variant="ghost"
              type="submit"
              :disabled="busy || arranging || moving"
              @click="openIntervalReset"
            >
              {{ t('重置间隔') }}
            </UiButton>
          </div>
          <SourceContentEditor
            v-if="editingContent && workbench"
            ref="contentEditor"
            :source="source"
            :text="text"
            :scope="scope"
            :busy="busy"
            :prepare="workbench.prepareEditor"
            :write-draft="workbench.writeDraft"
            :discard-draft="workbench.discardDraft"
            :save="workbench.editContent"
            @close="editingContent = false"
            @saved="editingContent = false"
          />
          <p v-else-if="loading" role="status">{{ t('正在读取原文…') }}</p>
          <template v-else-if="error"
            ><p class="import-warning" role="alert">{{ t(error) }}</p>
            <UiButton variant="secondary" type="submit" @click="load">
              {{ t('重试') }}
            </UiButton></template
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
                <UiButton
                  variant="ghost"
                  type="submit"
                  v-if="readingError"
                  :disabled="busy"
                  @click="reading.flush()"
                >
                  {{ t('重试保存位置') }}
                </UiButton>
                <UiButton
                  variant="ghost"
                  type="submit"
                  :disabled="busy || !reader?.ready"
                  @click="remember"
                >
                  {{ t('保存阅读位置') }}
                </UiButton>
                <UiButton
                  variant="ghost"
                  type="submit"
                  :disabled="busy || !reader?.ready"
                  @click="reader?.restart()"
                >
                  {{ t('从头阅读') }}
                </UiButton>
              </div>
            </div>
            <SourceReader
              :actions="readerActions"
              :hold-reading="reading.holdForAction"
              :editable="!!workbench && !session"
              :busy="busy"
              @change-text="workbench?.editContent($event)"
              :get-media="getMedia"
              :key="source.id + ':' + source.mediaId"
              ref="reader"
              :source="source"
              :sources="library.sources"
              :initial-selection="
                source.origin?.locator?.kind === 'image' &&
                source.document?.format === 'image' &&
                !source.derived
                  ? {
                      locator: {
                        ...source.origin.locator,
                        sourceId: source.id,
                        versionId: source.mediaId,
                      },
                      text,
                      projection: { start: 0, end: text.length },
                    }
                  : undefined
              "
              :text="text"
              :scope="scope"
              :original-name="
                library.media.find((item) => item.id === source?.document?.originalMediaId)?.name
              "
              @select="select"
              @position="reading.record($event)"
              @wiki="openWiki"
              @wiki-preview="openWiki"
              @open="openDocumentSource"
            />
            <div v-if="source.kind === 'excerpt'" class="source-excerpt-tools">
              <p v-if="!original" class="form-note">{{ t('原文已删除，摘录内容仍保留。') }}</p>
              <div class="source-actions">
                <UiButton
                  variant="secondary"
                  type="submit"
                  v-if="original"
                  :disabled="busy"
                  @click="originOpen = true"
                >
                  {{ t('查看出处') }}
                </UiButton>
                <UiButton
                  variant="primary"
                  type="submit"
                  :disabled="busy || !library.decks.length"
                  @click="createFromWholeExcerpt"
                >
                  {{ t('用此摘录制卡') }}
                </UiButton>
              </div>
            </div>
            <p v-if="duplicates.length" class="source-duplicate" role="status">
              <span>{{ t('这段原文已有 {count} 份摘录。', { count: duplicates.length }) }}</span>
              <UiButton
                variant="ghost"
                type="button"
                :disabled="busy || moving"
                @click="excerptList?.showMatches()"
              >
                {{ t('查看已有摘录') }}
              </UiButton>
            </p>
            <div class="source-excerpt-action">
              <span>{{
                excerpt
                  ? t('已选 {count} 个字符', { count: excerpt.quote.length })
                  : t('尚未选取摘录')
              }}</span>
              <UiButton
                variant="secondary"
                type="submit"
                :disabled="busy || !excerpt"
                @click="openExcerpt"
              >
                {{ t('保存为摘录') }}
              </UiButton>
              <UiButton
                variant="primary"
                type="submit"
                :disabled="busy || !excerpt || !library.decks.length"
                @click="excerpt && emit('create', excerpt, source.format)"
              >
                {{ t('用摘录制卡') }}
              </UiButton>
              <UiButton
                variant="secondary"
                type="submit"
                v-if="canShare"
                :disabled="busy || !excerpt || !library.decks.length"
                @click="excerpt && emit('share', excerpt)"
              >
                {{ t('通过 MCP 制卡') }}
              </UiButton>
              <UiButton
                v-if="workbench"
                variant="secondary"
                :disabled="busy || !excerpt || !library.decks.length"
                @click="excerpt && emit('create', excerpt, source.format, 'cloze')"
                >{{ t('制作挖空卡') }}</UiButton
              >
              <UiButton
                v-if="workbench"
                variant="ghost"
                :disabled="busy || !excerpt"
                @click="addAnnotation"
                >{{ t('添加批注') }}</UiButton
              >
            </div>
            <p v-if="!library.decks.length" class="form-note">
              {{ t('请先新建一个卡组，再用摘录制卡。') }}
            </p>
          </template>
          <p v-if="navigationError" class="import-warning" role="alert">{{ t(navigationError) }}</p>
        </section>
        <section v-else class="empty-state source-queue-empty">
          <FileText :size="32" />
          <h2>
            {{
              t(
                !library.sources.length
                  ? '还没有学习材料'
                  : hasFilters
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
                !library.sources.length
                  ? '导入文本或 Markdown，也可以直接粘贴。原文会保存在当前学习库中。'
                  : hasFilters
                    ? '更换关键词或调整筛选条件。'
                    : view === 'ready'
                      ? '切换到稍后阅读或已归档查看材料。'
                      : '当前列表为空。',
              )
            }}
          </p>
        </section>
        <div
          v-if="source && !roundEnded"
          class="reading-splitter reading-splitter-right"
          v-show="contextOpen"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          :aria-label="t('调整上下文宽度')"
          :aria-valuenow="panels.right.value"
          aria-valuemin="180"
          aria-valuemax="380"
          @pointerdown="panels.start($event, 'right')"
          @pointermove="panels.move"
          @pointerup="panels.end"
          @pointercancel="panels.cancel"
          @lostpointercapture="panels.cancel"
          @keydown="panels.keyboard($event, 'right')"
        />
        <aside
          v-if="source && !roundEnded"
          class="source-context-panel"
          v-show="contextOpen"
          :aria-label="t('材料上下文')"
        >
          <SourceLinks
            :source="source"
            :knowledge="knowledge"
            :target="wikiTarget"
            :busy="busy || inRound"
            @open="openSearchResult"
            @close-preview="wikiTarget = undefined"
          />
          <SourceMetadata :source="source" :scope="scope" :read-properties="readProperties" />
          <SourceAnnotations
            v-if="workbench"
            ref="annotations"
            :source="source"
            :scope="scope"
            :busy="busy"
            :actions="workbench"
            :read="read"
            :get-media="getMedia"
          />
          <UiCollapsible :unmount-on-hide="false" v-if="linked.length" class="source-linked">
            <template #default="{ open }"
              ><UiButton type="button" variant="ghost" :aria-expanded="open">
                {{ t('关联笔记（{count}）', { count: linked.length }) }}
              </UiButton></template
            ><template #content>
              <ul>
                <li v-for="note in linked" :key="note.id">
                  <UiButton variant="ghost" type="submit" @click="emit('edit', note.id)">
                    {{ note.front.slice(0, 120) }}
                  </UiButton>
                </li>
              </ul>
            </template>
          </UiCollapsible>
          <SourceExcerptList
            v-if="savedExcerpts.length"
            :key="source.id + ':' + source.mediaId"
            ref="excerptList"
            :entries="savedExcerpts"
            :text="loading || error ? '' : text"
            :selection="excerpt"
            :today="today"
            :busy="busy || moving || arranging"
            :can-locate="canLocateExcerpt"
            @locate="locateExcerpt"
            @open="openExcerptSource"
          />
        </aside>
      </div>
    </template>
    <CollectionImport
      v-if="collection && !session"
      ref="collectionImport"
      :api="collection"
      :scope="scope"
      :busy="busy || moving || inRound"
      :read-clipboard="readClipboard"
      @collected="collected"
      @activity="collecting = $event"
    />
    <SourceBatchDialog
      :settings="scheduling"
      v-if="batchDraft"
      :titles="batchDraft.entries.map((entry) => entry.title)"
      :now="now"
      :busy="busy || savingBatch"
      :error="actionError"
      :save="saveBatch"
      @close="batchDraft = undefined"
    />
    <SourceContext
      :get-media="getMedia"
      v-if="ancestrySource"
      :source="ancestrySource"
      :sources="library.sources"
      :read="read"
      @close="ancestrySource = undefined"
    />
    <SourceContext
      :get-media="getMedia"
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
      :get-media="getMedia"
      v-if="originOpen && original && source?.origin"
      :source="original"
      :excerpt="source.derived ? undefined : { ...source.origin, quote: text }"
      :sources="library.sources"
      :read="read"
      @close="originOpen = false"
    />
    <AppModal v-if="versionsOpen && source" :title="t('历史版本')" @close="versionsOpen = false">
      <p>{{ t('旧版正文和阅读位置保留。查看旧版不会改变当前阅读进度。') }}</p>
      <ul class="source-version-list">
        <li v-for="(version, index) in source.versions" :key="version.mediaId">
          <UiButton variant="secondary" type="submit" @click="openVersion(version.mediaId)">
            {{
              t('版本 {number} · {date}', {
                number: index + 1,
                date: new Date(version.acceptedAt).toLocaleString(locale),
              })
            }}</UiButton
          ><span v-if="version.reading" class="form-note">{{
            t('阅读位置：{offset}', { offset: version.reading.offset })
          }}</span>
        </li>
      </ul>
    </AppModal>
    <AppModal
      v-if="detailsDraft"
      :title="t('编辑材料信息')"
      :busy="busy || savingDetails"
      :error="actionError"
      @close="detailsDraft = undefined"
    >
      <form class="editor-form source-details-form" @submit.prevent="saveDetails">
        <label for="source-details-title">{{ t('材料标题') }}</label>
        <UiInput
          id="source-details-title"
          v-model="detailsDraft.details.title"
          required
          maxlength="160"
          :disabled="busy || savingDetails"
        />
        <label for="source-details-url">{{ t('来源链接（可选）') }}</label>
        <UiInput
          id="source-details-url"
          :model-value="detailsDraft?.details.url ?? ''"
          @update:model-value="
            (value: string) => {
              if (detailsDraft) detailsDraft.details.url = value
            }
          "
          type="url"
          maxlength="2048"
          placeholder="https://"
          :disabled="busy || savingDetails"
        />
        <p class="form-note">{{ t('操作前会保存快照，可在「数据与备份」中恢复。') }}</p>
        <div class="form-actions">
          <UiButton
            variant="secondary"
            type="button"
            :disabled="busy || savingDetails"
            @click="detailsDraft = undefined"
          >
            {{ t('取消') }}
          </UiButton>
          <UiButton variant="primary" type="submit" :disabled="busy || savingDetails">
            {{ t('保存材料信息') }}
          </UiButton>
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
        <UiInput
          id="excerpt-title"
          v-model="excerptTitle"
          required
          maxlength="160"
          :disabled="busy || savingExcerpt"
        />
        <label for="excerpt-body">{{ t('选中的原文') }}</label>
        <UiTextarea
          id="excerpt-body"
          :model-value="excerptDraft.input.excerpt.quote"
          readonly
          rows="8"
        />
        <p class="form-note">{{ t('摘录会加入待阅读列表，可单独阅读和制卡。') }}</p>
        <div class="form-actions">
          <UiButton
            variant="secondary"
            type="button"
            :disabled="busy || savingExcerpt"
            @click="excerptDraft = undefined"
          >
            {{ t('取消') }}
          </UiButton>
          <UiButton variant="primary" type="submit" :disabled="busy || savingExcerpt">
            {{ t('保存摘录') }}
          </UiButton>
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
        <UiSelect
          :items="[
            { label: t('固定递增'), value: 'fixed' },
            { label: t('自适应'), value: 'adaptive' },
          ]"
          id="reading-schedule-mode"
          v-model="scheduleMode"
          :disabled="busy || arranging"
        ></UiSelect>
        <fieldset
          v-if="scheduleMode === 'adaptive'"
          class="reading-feedback"
          :disabled="busy || arranging"
        >
          <legend>{{ t('这次理解如何？') }}</legend>
          <URadioGroup
            v-model="readingFeedback"
            name="reading-feedback"
            :disabled="busy || arranging"
            :items="[
              { value: 'again', label: t('需要再读') },
              { value: 'good', label: t('基本理解') },
              { value: 'easy', label: t('已经熟悉') },
            ]"
          />
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
          <UiButton
            variant="secondary"
            type="button"
            :disabled="busy || arranging"
            @click="schedulingRead = false"
          >
            {{ t('取消') }}
          </UiButton>
          <UiButton variant="primary" type="submit" :disabled="busy || arranging || !canMove">
            {{ t('保存阅读安排') }}
          </UiButton>
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
          <UiButton
            variant="secondary"
            type="button"
            :disabled="busy || arranging"
            @click="resettingInterval = false"
          >
            {{ t('取消') }}
          </UiButton>
          <UiButton variant="primary" type="submit" :disabled="busy || arranging">
            {{ t('重置间隔') }}
          </UiButton>
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
            <UiButton
              variant="secondary"
              v-for="option in deferOptions"
              :key="option.label"
              type="button"
              class="source-defer-option"
              :aria-pressed="deferDate === option.date"
              @click="deferDate = option.date"
            >
              <span>{{ t(option.label) }}</span>
              <time :datetime="option.date">{{ readingDate(option.date) }}</time>
            </UiButton>
          </div>
        </fieldset>
        <label for="source-reading-date">{{ t('下次阅读日期') }}</label>
        <UiInput
          id="source-reading-date"
          v-model="deferDate"
          type="date"
          required
          :min="nextReadingDay(now, 1, scheduling)"
          max="9999-12-31"
          :disabled="busy || arranging"
        />
        <p class="form-note">{{ t('按本机日期安排，到这一天会自动加入待阅读列表。') }}</p>
        <div class="form-actions">
          <UiButton
            variant="secondary"
            type="button"
            :disabled="busy || arranging"
            @click="deferring = false"
          >
            {{ t('取消') }}
          </UiButton>
          <UiButton variant="primary" type="submit" :disabled="busy || arranging">
            {{ t('保存阅读安排') }}
          </UiButton>
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
        /><UiButton
          variant="secondary"
          type="button"
          class="attachment-button"
          :disabled="busy || readingFile"
          @click="fileInput?.click()"
        >
          <Upload :size="18" />{{ t('选择材料文件') }}</UiButton
        ><label for="source-title">{{ t('材料标题') }}</label
        ><UiInput
          id="source-title"
          v-model="form.title"
          required
          maxlength="160"
          :disabled="busy || readingFile"
        /><label for="source-url">{{ t('来源链接（可选）') }}</label
        ><UiInput
          id="source-url"
          v-model="form.url"
          type="url"
          maxlength="2048"
          placeholder="https://"
          :disabled="busy || readingFile"
        /><label for="source-format">{{ t('内容格式') }}</label
        ><UiSelect
          :items="[
            { label: 'Markdown', value: 'markdown' },
            { label: t('纯文本'), value: 'plain' },
          ]"
          id="source-format"
          v-model="form.format"
          :disabled="busy || readingFile"
        ></UiSelect
        ><label for="source-content">{{ t('粘贴正文') }}</label
        ><UiTextarea
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
          <UiButton variant="secondary" type="button" :disabled="busy" @click="closeImport">
            {{ t('取消') }}</UiButton
          ><UiButton variant="primary" type="submit" :disabled="busy || readingFile">
            {{ t('保存材料') }}
          </UiButton>
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
          <UiButton variant="secondary" type="submit" :disabled="busy" @click="deleting = false">
            {{ t('取消') }}</UiButton
          ><UiButton variant="danger" type="submit" :disabled="busy" @click="remove">
            {{ t('确认删除') }}
          </UiButton>
        </div>
      </div></AppModal
    >
  </AppPage>
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
  min-height: var(--ui-control-height);
  font-size: var(--font-size-body);
}
#reading-schedule-mode {
  margin: 0.5rem 0 1rem;
}
.source-selection-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
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
  font-size: var(--font-size-meta);
}
.source-ancestry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  margin-bottom: 0.6rem;
  font-size: var(--font-size-meta);
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
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--ui-bg-muted);
}

.source-kind-badge {
  display: inline-block;
  justify-self: start;
  margin-bottom: 0.4rem;
  padding: 0.2rem 0.5rem;
  border-radius: 5px;
  color: var(--green);
  background: var(--sage);
  font-size: var(--font-size-meta);
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
  --ui-textarea-min-height: 10rem;
  max-height: 35vh;
  white-space: pre-wrap;
  line-height: var(--line-height-ui);
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
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--sage);
}
.reading-round strong {
  font-size: var(--font-size-body);
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
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
}
.source-filter-fields {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
}
.source-filter-field {
  display: grid;
  min-width: 0;
  gap: 0.5rem;
}
.source-filter-fields label {
  font-size: var(--font-size-body);
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
.source-toolbar,
.source-tools,
.source-queue-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.source-toolbar {
  justify-content: space-between;
  margin-bottom: 1.25rem;
}
.source-toolbar [aria-pressed='true'] {
  background: var(--sage);
  border-color: var(--green);
}
.source-queue-filters span {
  color: var(--muted);
  font-size: var(--font-size-meta);
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
  font-size: var(--font-size-body);
}
.source-priority-control :deep([role='combobox']) {
  min-width: 6rem;
  width: auto;
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
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}
.source-interval-date {
  font-size: var(--font-size-meta);
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
  font-size: var(--font-size-meta);
}
.source-interval-steps li[aria-current='step'] {
  border-color: var(--green);
  background: var(--sage);
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
.source-defer-option.ui-button {
  display: grid;
  gap: 0.4rem;
  padding: 0.85rem 0.5rem;
  font-size: var(--font-size-body);
}
.source-defer-option time {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
@media (max-width: 480px) {
  .source-defer-options > div {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-defer-option.ui-button {
    display: flex;
    justify-content: space-between;
    padding: 0.85rem 0.75rem;
  }
}
.sources-layout {
  display: grid;
  grid-template-columns: var(--reading-list-width) 12px minmax(0, 1fr);
  gap: 0;
  align-items: start;
}
.sources-layout.has-context {
  grid-template-columns: var(--reading-list-width) 12px minmax(0, 1fr) 12px var(
      --reading-context-width
    );
}
.sources-layout.round-layout {
  grid-template-columns: minmax(0, 1fr);
}
.sources-layout.round-layout.has-context {
  grid-template-columns: minmax(0, 1fr) 12px var(--reading-context-width);
}
.source-context-panel {
  display: grid;
  gap: 1.5rem;
  min-width: 0;
  padding: 0.75rem;
  max-height: 80vh;
  overflow: auto;
  position: sticky;
  top: 1rem;
}
.source-list-switch {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.5rem;
}
.source-list-switch [aria-pressed='true'] {
  background: var(--sage);
}
.reading-splitter {
  align-self: stretch;
  min-height: 10rem;
  position: relative;
  touch-action: none;
  cursor: col-resize;
}
.reading-splitter::after {
  content: '';
  position: absolute;
  inset: 0 5px;
  background: transparent;
  border-radius: 2px;
  transition: background-color 150ms;
}
.reading-splitter:hover::after,
.reading-splitter:focus-visible::after {
  background: var(--green);
}
.reading-splitter:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}
.source-list {
  display: grid;
  gap: 0.75rem;
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
  gap: 0.625rem;
  padding: 1.25rem;
  color: inherit;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow-wrap: anywhere;
  transition:
    border-color 160ms,
    background-color 160ms;
}
.source-list-item:hover {
  border-color: color-mix(in srgb, var(--green) 50%, var(--ui-border));
  background: var(--ui-bg-muted);
}
.source-list-item.selected {
  border-color: var(--green);
  background: var(--sage);
}
.source-list-title {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 0;
  cursor: pointer;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  line-height: 1.65;
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
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.source-list-item .source-priority-badge {
  justify-self: start;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--green);
  background: var(--ui-bg-muted);
}
.source-reader {
  min-width: 0;
  padding: 2rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  display: grid;
  gap: 1.5rem;
}
.source-reader-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--line);
}
.source-reader-heading > div {
  min-width: 0;
}
.source-reader h2 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  line-height: 1.5;
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
  background: var(--ui-bg);
  box-shadow: 0 -4px 12px color-mix(in srgb, var(--ui-text) 4%, transparent);
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
  line-height: var(--line-height-ui);
}
@media (max-width: 1100px) {
  .sources-layout,
  .sources-layout.has-context,
  .sources-layout.round-layout.has-context {
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
  }
  .reading-splitter {
    display: none;
  }
  .source-context-panel {
    position: static;
    max-height: none;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  }
  .source-list {
    max-height: min(22rem, 45vh);
  }
  .source-reader {
    padding: 1.5rem;
  }
  .source-text {
    min-height: 20rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .reading-splitter::after {
    transition: none;
  }
}
@media (max-width: 720px) {
  .source-filters,
  .source-reader {
    padding: 1.25rem;
  }
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
