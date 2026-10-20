<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { t } from '../i18n'
import type { Source, ReadingPosition, ReadingUpdate } from '../core/source-data'
import { renderReadingMarkdown } from '../core/content'
import {
  TextareaPosition,
  capturePreview,
  restorePreview,
  previewSourceOffset,
} from './reading-position'

const props = defineProps<{ source: Source; text: string; scope: string }>()
const emit = defineEmits<{
  select: [sourceId: string, start: number, end: number]
  position: [update: ReadingUpdate]
}>()
const preview = ref(props.source.reading?.view === 'preview' && props.source.format === 'markdown')
const reader = ref<HTMLTextAreaElement>(),
  rendered = ref<HTMLElement>()
const html = computed(() => renderReadingMarkdown(props.text))
let mirror: TextareaPosition | undefined, observer: ResizeObserver | undefined
const restoring = ref(true)
let alive = true
let last: ReadingPosition = props.source.reading ?? { offset: 0, fraction: 0, view: 'source' }
let restoreSequence = 0

function capture(): ReadingPosition {
  return preview.value && rendered.value
    ? capturePreview(rendered.value)
    : reader.value
      ? (mirror ??= new TextareaPosition(reader.value)).capture()
      : last
}
function update(): ReadingUpdate {
  last = capture()
  return {
    sourceId: props.source.id,
    mediaId: props.source.mediaId,
    scope: props.scope,
    position: last,
  }
}
function scrolled() {
  if (!restoring.value && alive) emit('position', update())
}
function selected() {
  if (reader.value)
    emit('select', props.source.id, reader.value.selectionStart, reader.value.selectionEnd)
}
async function restore(position: ReadingPosition, focus = false) {
  const sequence = ++restoreSequence
  restoring.value = true
  await nextTick()
  if (!alive || sequence !== restoreSequence) return
  if (preview.value && rendered.value) restorePreview(rendered.value, position)
  else if (reader.value)
    (mirror ??= new TextareaPosition(reader.value)).restore(position.offset, focus)
  last = capture()
  if (focus) (preview.value ? rendered.value : reader.value)?.scrollIntoView({ block: 'nearest' })
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (alive && sequence === restoreSequence) restoring.value = false
}
async function toggle() {
  let position = capture()
  if (preview.value && rendered.value)
    position = {
      offset: previewSourceOffset(rendered.value, position, props.text),
      fraction: 0,
      view: 'source',
    }
  mirror?.dispose()
  mirror = undefined
  preview.value = !preview.value
  emit('select', props.source.id, 0, 0)
  await restore(position)
  observeReader()
  if (alive) emit('position', update())
}
async function resume() {
  mirror?.dispose()
  mirror = undefined
  preview.value = props.source.reading?.view === 'preview' && props.source.format === 'markdown'
  emit('select', props.source.id, 0, 0)
  await restore(props.source.reading ?? { offset: 0, fraction: 0, view: 'source' }, true)
  observeReader()
}
async function restart() {
  await restore({ offset: 0, fraction: 0, view: preview.value ? 'preview' : 'source' }, true)
  if (alive) emit('position', update())
}
function observeReader() {
  observer?.disconnect()
  if (reader.value) observer?.observe(reader.value)
  if (rendered.value) observer?.observe(rendered.value)
}
onMounted(async () => {
  if (props.source.reading) await document.fonts.ready
  if (!alive) return
  // Explicit resume may already have started while fonts were loading.
  if (restoreSequence === 0) await restore(last)
  observer = new ResizeObserver(() => {
    if (!restoring.value && alive) void restore(last)
  })
  observeReader()
})
onUnmounted(() => {
  alive = false
  observer?.disconnect()
  mirror?.dispose()
})
defineExpose({ resume, restart, capture: update, ready: computed(() => !restoring.value) })
</script>

<template>
  <div class="source-selection-tools">
    <p class="form-note">
      {{
        t(
          source.kind === 'excerpt'
            ? '选中原文中的文字，再点击「用摘录制卡」。每次最多 10000 个字符。'
            : '选中原文中的文字，保存为摘录或直接制卡。每次最多 10000 个字符。',
        )
      }}
    </p>
    <button
      v-if="source.format === 'markdown'"
      class="text-button"
      :aria-pressed="preview"
      @click="toggle"
    >
      {{ t(preview ? '返回原文选取摘录' : '阅读 Markdown 预览') }}
    </button>
  </div>
  <div
    v-if="preview"
    ref="rendered"
    class="source-markdown-preview markdown-content card-content"
    tabindex="0"
    :aria-label="t('材料阅读预览')"
    :aria-busy="restoring"
    @scroll.passive="scrolled"
    v-html="html"
  />
  <textarea
    v-else
    ref="reader"
    class="source-text"
    :class="{ 'short-excerpt': source.kind === 'excerpt' && text.length < 600 }"
    :value="text"
    readonly
    :aria-label="t('材料正文')"
    :aria-busy="restoring"
    @scroll.passive="scrolled"
    @select="selected"
    @keyup="selected"
    @mouseup="selected"
    @touchend="selected"
  />
</template>

<style scoped>
.source-selection-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
}
.source-text {
  width: 100%;
  min-width: 0;
  min-height: 28rem;
  resize: vertical;
  line-height: 1.8;
  font-family: inherit;
  font-size: 1rem;
  border: 1px solid #d4decd;
  border-radius: 8px;
  background: #fafbf8;
  color: #293d33;
  padding: 11px 13px;
}
.source-text.short-excerpt {
  min-height: 10rem;
}
.source-text:hover {
  border-color: #a8bca2;
}
.source-markdown-preview {
  max-height: 36rem;
  overflow: auto;
  font-size: 1rem;
  line-height: 1.8;
  overflow-wrap: anywhere;
  scroll-behavior: auto;
}
.source-markdown-preview :deep(.reading-block) {
  display: flow-root;
}
</style>
