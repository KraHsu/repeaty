<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  AnnotationMode,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist'
import { abortable, checkCancelled, type PdfLifetime } from './engine'
import {
  displayRegion,
  PDF_LIMITS,
  type Matrix,
  type PdfProjection,
  type PdfRegion,
} from './projection'
import type { PageGeometry } from './selection'

const props = defineProps<{
  document: PDFDocumentProxy
  projection: PdfProjection['pages'][number]
  lifetime: PdfLifetime
  width: number
  zoom: number | 'fit'
  rotation: number
  highlights: readonly PdfRegion[]
  search?: { start: number; end: number }
  location?: { start: number; end: number }
}>()
const emit = defineEmits<{ ready: [page: PageGeometry]; error: [message: string] }>()
const root = ref<HTMLElement>(),
  canvas = ref<HTMLCanvasElement>(),
  layer = ref<HTMLDivElement>()
const page = shallowRef<PDFPageProxy>(),
  error = ref(''),
  near = ref(false),
  painted = ref(false)
const locations = shallowRef<{ x: number; y: number; width: number; height: number }[]>([])
let textLayer: TextLayer | undefined,
  render: RenderTask | undefined,
  observer: IntersectionObserver | undefined
let stopped = false,
  painting = 0
const viewport = computed(() => {
  if (!page.value) return
  const rotation = (page.value.rotate + props.rotation) % 360
  const base = page.value.getViewport({ scale: 1, rotation })
  const scale = props.zoom === 'fit' ? Math.max(0.1, props.width / base.width) : props.zoom
  return page.value.getViewport({ scale, rotation })
})
const highlights = computed(() => {
  if (!viewport.value || !page.value) return []
  return props.highlights
    .filter((region) => region.page === props.projection.page)
    .map((region) =>
      displayRegion(region, viewport.value!.transform as unknown as Matrix, page.value!.view),
    )
})

function publishGeometry() {
  if (root.value && viewport.value && page.value)
    emit('ready', {
      page: props.projection.page,
      element: root.value,
      transform: viewport.value.transform as unknown as Matrix,
      crop: page.value.view,
    })
}
async function paint() {
  const generation = ++painting
  const pending = render
  pending?.cancel()
  // A canvas cannot be reused before its cancelled PDF.js RenderTask has settled.
  if (pending) await pending.promise.catch(() => undefined)
  if (
    stopped ||
    generation !== painting ||
    !page.value ||
    !viewport.value ||
    !canvas.value ||
    !near.value
  )
    return
  const target = canvas.value,
    view = viewport.value
  const ratio = Math.max(
    0.1,
    Math.min(
      globalThis.devicePixelRatio || 1,
      2,
      Math.sqrt(PDF_LIMITS.canvasPixels / (view.width * view.height)),
    ),
  )
  target.width = Math.ceil(view.width * ratio)
  target.height = Math.ceil(view.height * ratio)
  try {
    const task = page.value.render({
      canvas: target,
      viewport: view,
      annotationMode: AnnotationMode.DISABLE,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    })
    render = task
    await task.promise
    if (generation === painting) painted.value = true
  } catch (reason) {
    if (
      !stopped &&
      generation === painting &&
      !(reason instanceof Error && reason.name === 'RenderingCancelledException')
    ) {
      error.value = '此页无法绘制。' + (reason instanceof Error ? reason.message : '')
      emit('error', error.value)
    }
  }
}
function releaseCanvas() {
  painting++
  const task = render
  render = undefined
  task?.cancel()
  painted.value = false
  const clear = () => {
    if (!near.value && canvas.value) {
      canvas.value.width = 0
      canvas.value.height = 0
      page.value?.cleanup()
    }
  }
  if (task) void task.promise.catch(() => undefined).then(clear)
  else clear()
}
function markSearch() {
  if (!textLayer) return
  for (const span of textLayer.textDivs) {
    span.classList.toggle(
      'pdf-search-hit',
      !!props.search &&
        Number(span.dataset.pdfStart) < props.search.end &&
        Number(span.dataset.pdfEnd) > props.search.start,
    )
  }
}
function markLocation() {
  const bounds = root.value?.getBoundingClientRect(),
    location = props.location
  const rectangles: typeof locations.value = []
  if (bounds && location && textLayer)
    for (const span of textLayer.textDivs) {
      const start = Number(span.dataset.pdfStart),
        end = Number(span.dataset.pdfEnd)
      if (!span.firstChild || end <= location.start || start >= location.end) continue
      const range = document.createRange()
      range.setStart(span.firstChild, Math.max(0, location.start - start))
      range.setEnd(span.firstChild, Math.min(end, location.end) - start)
      for (const rect of range.getClientRects())
        if (rect.width && rect.height)
          rectangles.push({
            x: rect.left - bounds.left,
            y: rect.top - bounds.top,
            width: rect.width,
            height: rect.height,
          })
    }
  locations.value = rectangles
}
function cleanup() {
  if (stopped) return
  stopped = true
  observer?.disconnect()
  textLayer?.cancel()
  near.value = false
  releaseCanvas()
  layer.value?.replaceChildren()
}
onMounted(async () => {
  props.lifetime.onCleanup(cleanup)
  try {
    page.value = await abortable(
      props.document.getPage(props.projection.page + 1),
      props.lifetime.signal,
    )
    if (stopped) return
    await nextTick()
    const content = await abortable(page.value.getTextContent(), props.lifetime.signal)
    checkCancelled(props.lifetime.signal)
    if (stopped || !layer.value || !viewport.value) return
    textLayer = new TextLayer({
      textContentSource: content,
      container: layer.value,
      viewport: viewport.value,
    })
    await textLayer.render()
    if (stopped) return
    if (textLayer.textDivs.length !== props.projection.runs.length)
      throw new Error('PDF 文字层与材料版本不一致，已停止选区操作。')
    textLayer.textDivs.forEach((span, index) => {
      const run = props.projection.runs[index]!
      if (span.textContent !== run.text) throw new Error('PDF 文字层与材料版本不一致。')
      span.dataset.pdfStart = String(props.projection.start + run.start)
      span.dataset.pdfEnd = String(props.projection.start + run.end)
    })
    markSearch()
    markLocation()
    publishGeometry()
    observer = new IntersectionObserver(
      (entries) => {
        near.value = entries.some((entry) => entry.isIntersecting)
        if (near.value) void paint()
        else releaseCanvas()
      },
      { root: root.value?.closest('[data-pdf-scroll]'), rootMargin: '250px' },
    )
    if (root.value) observer.observe(root.value)
  } catch (reason) {
    if (!stopped && !props.lifetime.signal.aborted) {
      error.value = reason instanceof Error ? reason.message : 'PDF 页面加载失败。'
      emit('error', error.value)
    }
  }
})
watch(viewport, async (view) => {
  if (!view || stopped) return
  await nextTick()
  textLayer?.update({ viewport: view })
  markLocation()
  publishGeometry()
  if (near.value) void paint()
})
watch(() => props.search, markSearch)
watch(() => props.location, markLocation)
onBeforeUnmount(cleanup)
</script>

<template>
  <section
    ref="root"
    class="pdf-page"
    :data-pdf-page="projection.page"
    :aria-label="`PDF 第 ${projection.page + 1} 页`"
    :style="{
      width: viewport ? viewport.width + 'px' : '100%',
      height: viewport ? viewport.height + 'px' : '50rem',
      '--total-scale-factor': viewport?.scale ?? 1,
    }"
  >
    <canvas ref="canvas" aria-hidden="true" :style="{ opacity: painted ? 1 : 0 }" />
    <div ref="layer" class="pdf-text-layer" />
    <div class="pdf-page-highlights" aria-hidden="true">
      <i
        v-for="(rect, index) in highlights"
        :key="index"
        :style="{
          left: rect.x + 'px',
          top: rect.y + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
        }"
      />
      <i
        v-for="(rect, index) in locations"
        :key="`text-${index}`"
        data-pdf-location
        :style="{
          left: rect.x + 'px',
          top: rect.y + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
        }"
      />
    </div>
    <p v-if="error" class="pdf-page-notice" role="alert">{{ error }}</p>
    <p v-else-if="!projection.runs.some((run) => run.text.trim())" class="pdf-page-notice">
      此页没有可提取文字，可阅读原图；尚未进行 OCR。
    </p>
  </section>
</template>

<style scoped>
.pdf-page {
  position: relative;
  flex: none;
  margin-inline: auto;
  overflow: hidden;
  background: white;
  color: #24392f;
  box-shadow: 0 2px 8px #0002;
  --scale-round-x: 1px;
  --scale-round-y: 1px;
}
canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  inset: 0;
  pointer-events: none;
}
.pdf-page-notice {
  position: absolute;
  bottom: 0;
  inset-inline: 0;
  padding: 8px 12px;
  background: #f2f5f0ed;
  font-size: 12px;
  pointer-events: none;
}
.pdf-page-highlights {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.pdf-page-highlights i {
  position: absolute;
  background: #d6b63255;
  outline: 1px solid #a98c1b80;
}
/* Minimal text-layer styling adapted from Mozilla PDF.js 6.4 (Apache-2.0).
   Scope it to this reader: the PDF viewer's global theme/UI CSS is not imported. */
.pdf-text-layer {
  color-scheme: only light;
  position: absolute;
  inset: 0;
  overflow: clip;
  line-height: 1;
  text-align: initial;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: black;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.pdf-text-layer :deep(:is(span, br)) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}
.pdf-text-layer :deep(span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.pdf-text-layer :deep(.markedContent) {
  display: contents;
}
.pdf-text-layer :deep(::selection) {
  color: transparent;
  background: #6da57788;
}
.pdf-text-layer :deep(.pdf-search-hit) {
  background: #ebcc3f70;
}
.pdf-text-layer[data-main-rotation='90'] {
  transform: rotate(90deg) translateY(-100%);
}
.pdf-text-layer[data-main-rotation='180'] {
  transform: rotate(180deg) translate(-100%, -100%);
}
.pdf-text-layer[data-main-rotation='270'] {
  transform: rotate(270deg) translateX(-100%);
}
</style>
