<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import {
  UiButton,
  UiInput,
  UiSelect,
  UiNotice,
  materials,
  resources,
  pluginData,
  type MaterialLocator,
  type MaterialReaderProps,
  type MaterialRecord,
  type MaterialSelection,
} from '@repeaty/plugin-api'
import PdfPage from './PdfPage.vue'
import { abortable, openPdf, projectPdf } from './engine'
import {
  combinePages,
  displayRegion,
  normalizeRegion,
  searchProjection,
  type PdfProjection,
} from './projection'
import { collectSelection, type PageGeometry } from './selection'
import { visiblePage } from './navigation'

const props = defineProps<MaterialReaderProps>()
const document = shallowRef<PDFDocumentProxy>(),
  projection = shallowRef<PdfProjection>()
const children = shallowRef<readonly MaterialRecord[]>([])
const scope = shallowRef<ReturnType<typeof resources.createScope>>()
const viewport = ref<HTMLElement>(),
  query = ref(''),
  currentHit = ref(0),
  currentPage = ref(1)
const pageInput = ref<string | number>('1'),
  editingPage = ref(false)
watch(currentPage, (page) => {
  if (!editingPage.value) pageInput.value = String(page)
})
const zoom = ref<string>('fit'),
  rotation = ref(0),
  width = ref(600),
  busy = ref(false),
  error = ref(''),
  selectionError = ref('')
const retry = ref(0),
  loadedPages = ref(0)
const viewNotice = ref('')
let viewKey = '',
  viewLoaded = false,
  viewWrites = Promise.resolve()
const geometries = new Map<number, PageGeometry>()
let observer: ResizeObserver | undefined, scrollTimer: ReturnType<typeof setTimeout> | undefined
let emittedSelection = '',
  restored = false,
  disposed = false
const options = [
  { value: 'fit', label: '适应宽度' },
  ...[50, 75, 100, 125, 150, 200, 300].map((value) => ({
    value: String(value / 100),
    label: `${value}%`,
  })),
]
const hits = computed(() =>
  projection.value ? searchProjection(projection.value, query.value) : [],
)
const match = computed(() => hits.value[currentHit.value])
const highlights = computed(() =>
  props.selection?.locator.kind === 'pdf' &&
  props.selection.locator.sourceId === props.material.id &&
  props.selection.locator.versionId === props.material.versionId
    ? props.selection.locator.regions
    : [],
)
const textLocation = computed(() => {
  const locator = props.selection?.locator
  return locator?.kind === 'text' &&
    validLocator(locator) &&
    Number.isInteger(locator.start) &&
    Number.isInteger(locator.end) &&
    locator.start >= 0 &&
    locator.end > locator.start &&
    props.text.slice(locator.start, locator.end) === locator.quote
    ? { start: locator.start, end: locator.end }
    : undefined
})
function validLocator(locator: MaterialLocator) {
  return locator.sourceId === props.material.id && locator.versionId === props.material.versionId
}
async function loadView(lifetime: ReturnType<typeof resources.createScope>) {
  if (props.readOnly) return
  const scopeId = props.workspaceScope
  const bytes = new TextEncoder().encode(
    JSON.stringify([props.material.document?.originalMediaId, props.material.versionId]),
  )
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const key =
    'view-' + [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('')
  try {
    const stored = await abortable(pluginData.get(key, scopeId), lifetime.signal)
    if (lifetime.signal.aborted || scope.value !== lifetime) return
    if (stored && typeof stored === 'object' && 'zoom' in stored && 'rotation' in stored) {
      if (typeof stored.zoom === 'string' && options.some((option) => option.value === stored.zoom))
        zoom.value = stored.zoom
      if ([0, 90, 180, 270].includes(Number(stored.rotation)))
        rotation.value = Number(stored.rotation)
    }
    await nextTick()
    if (lifetime.signal.aborted || scope.value !== lifetime) return
    viewKey = key
    viewLoaded = true
  } catch {
    if (!lifetime.signal.aborted) viewNotice.value = '无法读取此文档的视图设置，已使用默认视图。'
  }
}
watch([zoom, rotation], () => {
  const lifetime = scope.value
  if (!viewLoaded || !viewKey || props.readOnly || !lifetime || lifetime.signal.aborted) return
  const key = viewKey,
    scopeId = props.workspaceScope,
    value = { zoom: zoom.value, rotation: rotation.value }
  viewWrites = viewWrites
    .then(async () => {
      if (scope.value !== lifetime || lifetime.signal.aborted) return
      await pluginData.set(key, value, scopeId)
    })
    .catch(() => {
      if (!lifetime.signal.aborted) viewNotice.value = '视图设置未能保存，当前阅读不受影响。'
    })
})

function release() {
  viewLoaded = false
  viewKey = ''
  scope.value?.dispose()
  scope.value = undefined
  observer?.disconnect()
  clearTimeout(scrollTimer)
  geometries.clear()
  document.value = undefined
  projection.value = undefined
  TextLayer.cleanup()
}
watch(
  [
    () => props.material.id,
    () => props.material.versionId,
    () => props.workspaceScope,
    () => props.original,
    () => retry.value,
  ],
  async () => {
    release()
    const lifetime = resources.createScope()
    scope.value = lifetime
    busy.value = true
    error.value = ''
    selectionError.value = ''
    loadedPages.value = 0
    restored = false
    emittedSelection = ''
    viewNotice.value = ''
    zoom.value = 'fit'
    rotation.value = 0
    try {
      if (props.material.document?.container) {
        children.value = (await abortable(materials.list(), lifetime.signal))
          .filter((item) => item.parentSourceId === props.material.id)
          .sort((a, b) => Number(a.document?.data?.pageStart) - Number(b.document?.data?.pageStart))
        return
      }
      if (!props.original) throw new Error('PDF 原件不可用；仍可查看已保存的文字。')
      await loadView(lifetime)
      const opened = await openPdf(props.original, lifetime)
      const data = props.material.document?.data
      const first = Number(data?.pageStart ?? 0),
        last = Number(data?.pageEnd ?? opened.document.numPages - 1)
      if (
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 0 ||
        last < first ||
        last >= opened.document.numPages ||
        last - first >= 50
      )
        throw new Error('PDF 章节页码无效，请重新导入。')
      const pages = await projectPdf(
        opened.document,
        first,
        last,
        lifetime,
        (page) => {
          loadedPages.value = page - first + 1
        },
        () => new Promise((resolve) => setTimeout(resolve, 0)),
      )
      const content = combinePages(pages)
      if (content.text !== props.text)
        throw new Error(
          'PDF 原件与此材料版本的文字不一致，已停止选区；可查看保存的文字或重新导入原件。',
        )
      projection.value = content
      document.value = markRaw(opened.document)
      currentPage.value = first + 1
      await nextTick()
      if (viewport.value) {
        observer = new ResizeObserver((entries) => {
          width.value = Math.max(160, (entries[0]?.contentRect.width ?? 600) - 32)
        })
        observer.observe(viewport.value)
      }
    } catch (reason) {
      if (lifetime.signal.aborted || disposed) return
      error.value = reason instanceof Error ? reason.message : 'PDF 无法打开。'
      lifetime.dispose()
    } finally {
      if (scope.value === lifetime) busy.value = false
    }
  },
  { immediate: true },
)

function jump(page: number, offset = 0, horizontal?: number) {
  const geometry = geometries.get(page),
    container = viewport.value
  if (!geometry || !container) return
  const bounds = geometry.element.getBoundingClientRect(),
    outer = container.getBoundingClientRect()
  container.scrollTo({
    top: container.scrollTop + bounds.top - outer.top + offset - 16,
    left:
      horizontal === undefined
        ? container.scrollLeft
        : container.scrollLeft + bounds.left - outer.left + horizontal - 40,
    behavior: 'instant',
  })
  currentPage.value = page + 1
}
function goPage() {
  if (!projection.value) return
  const page = Math.max(
    projection.value.startPage + 1,
    Math.min(projection.value.endPage + 1, Math.trunc(Number(pageInput.value))),
  )
  currentPage.value = Number.isFinite(page) ? page : projection.value.startPage + 1
  pageInput.value = String(currentPage.value)
  jump(currentPage.value - 1)
}
function stepPage(delta: number) {
  pageInput.value = currentPage.value + delta
  goPage()
}
function finishPageEdit() {
  editingPage.value = false
  pageInput.value = String(currentPage.value)
}
function cancelLoading() {
  scope.value?.dispose()
  busy.value = false
  error.value = 'PDF 加载已取消。'
}
function ready(geometry: PageGeometry) {
  geometries.set(geometry.page, geometry)
  if (!restored && geometries.size === projection.value?.pages.length) {
    const locator = props.selection?.locator ?? props.position?.locator
    restored = true
    if (locator) locate(locator)
    else if (props.position) locateOffset(props.position.projectionOffset)
  }
}
function locateOffset(offset: number) {
  const page =
    projection.value?.pages.find((page) => page.end > offset) ?? projection.value?.pages.at(-1)
  const geometry = page && geometries.get(page.page)
  if (!page || !geometry) return
  const span = [...geometry.element.querySelectorAll<HTMLElement>('[data-pdf-start]')].find(
    (span) => Number(span.dataset.pdfEnd) > offset,
  )
  const bounds = span?.getBoundingClientRect(),
    root = geometry.element.getBoundingClientRect()
  jump(page.page, bounds ? bounds.top - root.top : 0, bounds ? bounds.left - root.left : undefined)
}
function locate(locator: MaterialLocator) {
  if (!validLocator(locator)) return
  if (locator.kind === 'text') {
    if (
      locator.start >= 0 &&
      locator.end <= props.text.length &&
      props.text.slice(locator.start, locator.end) === locator.quote
    )
      locateOffset(locator.start)
    return
  }
  if (locator.kind !== 'pdf') return
  const first = locator.regions[0],
    target = first && geometries.get(first.page)
  if (first && target) {
    const rect = displayRegion(first, target.transform, target.crop)
    jump(first.page, rect.y, rect.x)
  }
}
function select() {
  if (!projection.value || error.value || busy.value) return
  const selection = window.getSelection()
  if (
    !selection?.rangeCount ||
    selection.isCollapsed ||
    !viewport.value?.contains(selection.anchorNode) ||
    !viewport.value.contains(selection.focusNode)
  )
    return
  try {
    const result = collectSelection(
      selection.getRangeAt(0),
      props.text,
      props.material.id,
      props.material.versionId,
      [...geometries.values()].sort((a, b) => a.page - b.page),
    )
    if (!result) return
    selectionError.value = ''
    emittedSelection = JSON.stringify(result.locator)
    props.onSelect(result)
  } catch (reason) {
    selectionError.value = reason instanceof Error ? reason.message : '无法读取此选区。'
    props.onSelect(undefined)
  }
}
function scroll() {
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (!viewport.value || !projection.value) return
    const outer = viewport.value.getBoundingClientRect()
    const page = visiblePage(
      outer,
      [...geometries].map(([page, geometry]) => ({
        page,
        bounds: geometry.element.getBoundingClientRect(),
      })),
      currentPage.value - 1,
    )
    const geometry = page === undefined ? undefined : geometries.get(page)
    if (geometry && page !== undefined) {
      const rect = geometry.element.getBoundingClientRect()
      currentPage.value = page + 1
      const y = Math.max(0, Math.min(rect.height - 1, outer.top - rect.top))
      const x = Math.max(0, Math.min(rect.width - 1, outer.left - rect.left))
      const region = normalizeRegion(
        page,
        { x, y, width: Math.min(1, rect.width - x), height: Math.min(1, rect.height - y) },
        geometry.transform,
        geometry.crop,
      )
      if (!props.readOnly)
        props.onPosition?.({
          locator: {
            schemaVersion: 1,
            sourceId: props.material.id,
            versionId: props.material.versionId,
            kind: 'pdf',
            regions: [region],
          },
          projectionOffset: projection.value.pages.find((item) => item.page === page)?.start ?? 0,
        })
    }
  }, 160)
}
function search(delta = 0) {
  if (!hits.value.length) return
  currentHit.value = (currentHit.value + delta + hits.value.length) % hits.value.length
  const hit = match.value
  if (!hit) return
  jump(hit.page)
  void nextTick(() => {
    const geometry = geometries.get(hit.page)
    const span = geometry?.element.querySelector('.pdf-search-hit')
    if (span && viewport.value) {
      const outer = viewport.value.getBoundingClientRect(),
        bounds = span.getBoundingClientRect()
      const left =
        bounds.left < outer.left || bounds.right > outer.right ? bounds.left - outer.left - 40 : 0
      viewport.value.scrollBy({ top: bounds.top - outer.top - 80, left, behavior: 'instant' })
    }
  })
}
watch(query, () => {
  currentHit.value = 0
  search()
})
watch(
  () => props.selection,
  (selection: MaterialSelection | undefined) => {
    if (
      !selection ||
      JSON.stringify(selection.locator) === emittedSelection ||
      selection.locator.versionId !== props.material.versionId ||
      selection.locator.sourceId !== props.material.id
    )
      return
    locate(selection.locator)
  },
)
watch(
  () => props.position,
  (position) => {
    if (!position || !restored) return
    if (position.locator) locate(position.locator)
    else locateOffset(position.projectionOffset)
  },
)
onBeforeUnmount(() => {
  disposed = true
  release()
})
</script>

<template>
  <div class="pdf-reader">
    <template v-if="material.document?.container">
      <p class="pdf-description">
        {{ material.document.data?.pageCount }} 页 · 选择章节继续阅读。每章与同一份离线原件关联。
      </p>
      <ul class="pdf-chapters">
        <li v-for="child in children" :key="child.id">
          <UiButton variant="ghost" :disabled="!onOpen" @click="onOpen?.(child.id)">{{
            child.title
          }}</UiButton>
        </li>
      </ul>
    </template>
    <template v-else>
      <div class="pdf-toolbar" aria-label="PDF 阅读工具">
        <div class="pdf-toolbar-group">
          <UiButton
            variant="ghost"
            :disabled="!projection || currentPage <= projection.startPage + 1"
            aria-label="上一页"
            @click="stepPage(-1)"
            >←</UiButton
          >
          <form class="pdf-page-picker" @submit.prevent="goPage">
            <UiInput
              v-model="pageInput"
              type="number"
              aria-label="PDF 页码"
              :min="(projection?.startPage ?? 0) + 1"
              :max="(projection?.endPage ?? 0) + 1"
              :disabled="!projection"
              @focus="editingPage = true"
              @blur="finishPageEdit"
              @change="goPage"
            /><span>/ {{ document?.numPages ?? '—' }}</span>
          </form>
          <UiButton
            variant="ghost"
            :disabled="!projection || currentPage >= projection.endPage + 1"
            aria-label="下一页"
            @click="stepPage(1)"
            >→</UiButton
          >
        </div>
        <div class="pdf-toolbar-group">
          <UiSelect v-model="zoom" :items="options" aria-label="PDF 缩放" /><UiButton
            variant="secondary"
            :disabled="!document"
            @click="rotation = (rotation + 90) % 360"
            >旋转 {{ rotation }}°</UiButton
          >
        </div>
        <form class="pdf-search" role="search" @submit.prevent="search(1)">
          <UiInput
            v-model="query"
            type="search"
            placeholder="在此章节搜索"
            aria-label="在 PDF 章节搜索"
            :disabled="!projection"
          /><span v-if="query" class="pdf-search-count" aria-live="polite"
            >{{ hits.length ? currentHit + 1 : 0 }}/{{ hits.length
            }}{{ hits.length === 500 ? '+' : '' }}</span
          ><UiButton
            variant="ghost"
            :disabled="!hits.length"
            aria-label="上一个搜索结果"
            @click="search(-1)"
            >↑</UiButton
          ><UiButton
            variant="ghost"
            :disabled="!hits.length"
            type="submit"
            aria-label="下一个搜索结果"
            >↓</UiButton
          >
        </form>
      </div>
      <p v-if="busy" class="pdf-description" role="status">
        正在读取 PDF{{ loadedPages ? ` · ${loadedPages} 页` : '' }}…
        <UiButton variant="ghost" @click="cancelLoading">取消</UiButton>
      </p>
      <UiNotice v-if="error" tone="warning"
        ><p>{{ error }}</p>
        <UiButton variant="secondary" @click="retry++">重新打开</UiButton>
        <details>
          <summary>查看已保存文字</summary>
          <pre class="pdf-fallback">{{ text }}</pre>
        </details></UiNotice
      >
      <UiNotice v-if="selectionError" tone="warning">{{ selectionError }}</UiNotice>
      <UiNotice v-if="viewNotice" tone="warning">{{ viewNotice }}</UiNotice>
      <div
        v-if="document && projection && scope && !error"
        ref="viewport"
        class="pdf-scroll"
        data-pdf-scroll
        tabindex="0"
        aria-label="PDF 页面，可滚动并选择文字"
        @scroll.passive="scroll"
        @pointerup="select"
        @keyup="select"
      >
        <PdfPage
          v-for="page in projection.pages"
          :key="`${material.versionId}:${page.page}`"
          :document="document"
          :projection="page"
          :lifetime="scope"
          :width="width"
          :zoom="zoom === 'fit' ? 'fit' : Number(zoom)"
          :rotation="rotation"
          :highlights="highlights"
          :search="match"
          :location="textLocation"
          @ready="ready"
          @error="
            (message) => {
              selectionError = message
            }
          "
        />
      </div>
      <p v-if="projection && !error" class="pdf-description">
        {{ projection.startPage + 1 }}–{{ projection.endPage + 1 }} 页 ·
        选择原文后可摘录、制卡或挖空。{{ readOnly ? '当前为只读预览。' : '' }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.pdf-reader {
  min-width: 0;
  display: grid;
  gap: 12px;
}
.pdf-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding-block: 4px 12px;
  border-bottom: 1px solid var(--border, #d6dfd0);
}
.pdf-toolbar-group,
.pdf-page-picker,
.pdf-search {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pdf-page-picker :deep(input) {
  width: 62px;
  min-width: 0;
  text-align: center;
}
.pdf-page-picker span,
.pdf-search-count {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.pdf-search {
  flex: 1;
  min-width: 240px;
}
.pdf-search > :first-child {
  flex: 1;
  min-width: 0;
}
.pdf-scroll {
  height: min(68vh, 800px);
  min-height: 260px;
  overflow: auto;
  overscroll-behavior: contain;
  overflow-anchor: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  padding: 16px;
  background: var(--bg-subtle, #e7ece4);
  border: 1px solid var(--border, #d6dfd0);
  border-radius: 8px;
}
.pdf-description {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted, #67776c);
}
.pdf-chapters {
  list-style: none;
  padding: 0;
  margin: 0;
}
.pdf-chapters li {
  padding-block: 8px;
  border-bottom: 1px solid var(--border, #d6dfd0);
}
.pdf-fallback {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 28rem;
  overflow: auto;
}
@media (max-width: 600px) {
  .pdf-search {
    flex-basis: 100%;
  }
}
</style>
