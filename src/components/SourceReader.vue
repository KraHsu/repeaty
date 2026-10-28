<script setup lang="ts">
import { UiButton, UiTextarea } from './ui'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { t } from '../i18n'
import { useInlineMedia } from '../composables/useInlineMedia'
import type { Source, SourceOrigin, ReadingPosition, ReadingUpdate } from '../core/source-data'
import { sourceExcerpt } from '../core/sources'
import { renderReadingMarkdown } from '../core/content'
import {
  TextareaPosition,
  capturePreview,
  restorePreview,
  previewSourceOffset,
} from './reading-position'

const props = defineProps<{
  source: Source
  text: string
  scope: string
  getMedia?: (id: string) => Promise<Blob | undefined>
}>()
const emit = defineEmits<{
  select: [sourceId: string, start: number, end: number]
  position: [update: ReadingUpdate]
}>()
const preview = ref(props.source.reading?.view === 'preview' && props.source.format === 'markdown')
const reader = ref<{ textareaRef?: HTMLTextAreaElement }>(),
  rendered = ref<HTMLElement>()
const media = useInlineMedia(() => ({
  text: props.text,
  media: preview.value ? props.source.inlineMedia : undefined,
  read: props.getMedia,
}))
const html = computed(() => renderReadingMarkdown(props.text, media.urls.value))
let mirror: TextareaPosition | undefined, observer: ResizeObserver | undefined
const restoring = ref(true)
let alive = true
let last: ReadingPosition = props.source.reading ?? { offset: 0, fraction: 0, view: 'source' }
let restoreSequence = 0

function capture(): ReadingPosition {
  return preview.value && rendered.value
    ? capturePreview(rendered.value)
    : reader.value?.textareaRef
      ? (mirror ??= new TextareaPosition(reader.value?.textareaRef)).capture()
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
  if (reader.value?.textareaRef)
    emit(
      'select',
      props.source.id,
      reader.value?.textareaRef.selectionStart,
      reader.value?.textareaRef.selectionEnd,
    )
}
async function restore(position: ReadingPosition, focus = false) {
  const sequence = ++restoreSequence
  restoring.value = true
  await nextTick()
  if (!alive || sequence !== restoreSequence) return
  if (preview.value && rendered.value) restorePreview(rendered.value, position)
  else if (reader.value?.textareaRef)
    (mirror ??= new TextareaPosition(reader.value?.textareaRef)).restore(position.offset, focus)
  last = capture()
  if (focus)
    (preview.value ? rendered.value : reader.value?.textareaRef)?.scrollIntoView({
      block: 'nearest',
    })
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
async function locate(origin: SourceOrigin) {
  if (!alive || origin.sourceId !== props.source.id) return false
  const selection = sourceExcerpt(props.source, props.text, origin.start, origin.end)
  mirror?.dispose()
  mirror = undefined
  preview.value = false
  const sequence = restoreSequence + 1
  await restore({ offset: selection.start, fraction: 0, view: 'source' }, true)
  if (!alive || sequence !== restoreSequence || preview.value || !reader.value?.textareaRef)
    return false
  reader.value?.textareaRef.focus({ preventScroll: true })
  reader.value?.textareaRef.setSelectionRange(selection.start, selection.end)
  // Selecting a long range can scroll to its end; keep the start visible instead.
  ;(mirror ??= new TextareaPosition(reader.value?.textareaRef)).restore(selection.start)
  observeReader()
  emit('select', props.source.id, selection.start, selection.end)
  emit('position', update())
  return true
}
function observeReader() {
  observer?.disconnect()
  if (reader.value?.textareaRef) observer?.observe(reader.value?.textareaRef)
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
defineExpose({ resume, restart, locate, capture: update, ready: computed(() => !restoring.value) })
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
    <UiButton
      variant="ghost"
      type="submit"
      v-if="source.format === 'markdown'"
      :aria-pressed="preview"
      @click="toggle"
    >
      {{ t(preview ? '返回原文选取摘录' : '阅读 Markdown 预览') }}
    </UiButton>
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
  <UiTextarea
    :ui="{
      base: `source-text ${source.kind === 'excerpt' && text.length < 600 ? 'short-excerpt' : ''}`,
    }"
    v-else
    ref="reader"
    :model-value="text"
    readonly
    :aria-label="t('材料正文')"
    :aria-busy="restoring"
    @scroll.passive="scrolled"
    @select="selected"
    @keyup="selected"
    @mouseup="selected"
    @touchend="selected"
  />
  <p v-if="media.error.value" role="alert" class="form-note">
    {{ t('部分媒体无法读取，请从完整备份恢复。') }}
  </p>
</template>

<style scoped>
.source-selection-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
}
:deep(.source-text) {
  min-height: 28rem;
  width: 100%;
  min-width: 0;
  resize: vertical;
  font-size: var(--font-size-reading);
  line-height: var(--line-height-reading);
}
:deep(.source-text.short-excerpt) {
  min-height: 10rem;
}
.source-markdown-preview {
  max-height: 36rem;
  overflow: auto;
  font-size: var(--font-size-reading);
  line-height: var(--line-height-reading);
  overflow-wrap: anywhere;
  scroll-behavior: auto;
}
.source-markdown-preview :deep(.reading-block) {
  display: flow-root;
}
</style>
