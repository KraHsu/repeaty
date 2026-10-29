<script setup lang="ts">
import { UiButton, UiTextarea } from './ui'
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { MaterialSelection, MaterialReaderProps } from '@repeaty/plugin-api'
import { usePluginManager } from '../plugins/manager'
import { validateMaterialLocator, type MaterialLocator } from '../core/material-data'
import { createExportFile } from '@repeaty-platform'
import MaterialReaderView from './MaterialReaderView.vue'
import { t } from '../i18n'
import { useInlineMedia } from '../composables/useInlineMedia'
import type { Source, SourceOrigin, ReadingPosition, ReadingUpdate } from '../core/source-data'
import { sourceExcerpt } from '../core/sources'
import { renderReadingMarkdown } from '../core/content'
import { readingSelection } from './reading-selection'
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
  originalName?: string
  editable?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{
  select: [sourceId: string, start: number, end: number, locator?: MaterialLocator]
  position: [update: ReadingUpdate]
  changeText: [update: { sourceId: string; mediaId: string; scope: string; content: string }]
  wiki: [target: string]
  wikiPreview: [target: string]
}>()
const preview = ref(props.source.format === 'markdown' && props.source.reading?.view !== 'source')
const selectionError = ref('')
const plugins = usePluginManager()
const textOnly = ref(false),
  materialError = ref(''),
  originalLoading = ref(false),
  exportingOriginal = ref(false),
  commandBusy = ref(false)
const original = shallowRef<Blob>()
const currentSelection = shallowRef<MaterialSelection>()
const requestedPosition = shallowRef<ReadingPosition | undefined>(props.source.reading)
const installation = computed(() =>
  plugins.pluginRuntime.installations.find(
    (item) => item.plugin.id === props.source.document?.providerId,
  ),
)
const contributed = computed(() =>
  installation.value?.readers?.find(
    (reader) =>
      reader.id === props.source.document?.readerId &&
      reader.formats.includes(props.source.document?.format ?? ''),
  ),
)
const customReader = computed(() => !!contributed.value && !textOnly.value)
originalLoading.value = customReader.value
let originalSequence = 0
async function originalBytes() {
  const sourceId = props.source.id,
    versionId = props.source.mediaId,
    scope = props.scope
  const mediaId = props.source.document?.originalMediaId
  if (!mediaId || !props.getMedia) throw new Error('原始文件缺失，请从备份恢复。')
  const blob = await props.getMedia(mediaId)
  if (
    !alive ||
    sourceId !== props.source.id ||
    versionId !== props.source.mediaId ||
    scope !== props.scope
  )
    throw new DOMException('Aborted', 'AbortError')
  if (!blob) throw new Error('原始文件缺失，请从备份恢复。')
  return blob
}
watch(customReader, async (enabled) => {
  const sequence = ++originalSequence
  currentSelection.value = undefined
  emit('select', props.source.id, 0, 0)
  if (!enabled) {
    original.value = undefined
    originalLoading.value = false
    return
  }
  originalLoading.value = true
  try {
    const blob = await originalBytes()
    if (alive && sequence === originalSequence) original.value = blob
  } catch (issue) {
    if (alive && sequence === originalSequence) {
      materialError.value = t(issue as Error)
      textOnly.value = true
    }
  } finally {
    if (alive && sequence === originalSequence) originalLoading.value = false
  }
})
function materialSelected(value: MaterialSelection | undefined) {
  if (!customReader.value) return
  try {
    if (!value) throw new Error('empty-selection')
    const locator = validateMaterialLocator(props.source, value.locator)
    const range = locator.kind === 'text' ? locator : value.projection
    if (!range) throw new Error('missing-projection')
    const excerpt = sourceExcerpt(props.source, props.text, range.start, range.end)
    if (
      excerpt.quote !== value.text ||
      (locator.kind === 'text' && locator.quote !== excerpt.quote)
    )
      throw new Error('invalid-projection')
    currentSelection.value = {
      locator,
      text: excerpt.quote,
      projection: { start: excerpt.start, end: excerpt.end },
    }
    emit('select', props.source.id, excerpt.start, excerpt.end, locator)
  } catch {
    currentSelection.value = undefined
    emit('select', props.source.id, 0, 0)
  }
}
function materialPosition(position: NonNullable<MaterialReaderProps['position']>) {
  try {
    const locator = validateMaterialLocator(props.source, position.locator)
    if (
      !Number.isInteger(position.projectionOffset) ||
      position.projectionOffset < 0 ||
      position.projectionOffset > props.text.length
    )
      return
    last = { offset: position.projectionOffset, fraction: 0, view: 'source', locator }
    emit('position', update())
  } catch {
    /* A stale or malformed plugin location never changes the saved position. */
  }
}
const readerProps = computed<MaterialReaderProps>(() => {
  const owner = installation.value,
    contributor = contributed.value,
    scope = props.scope,
    sourceId = props.source.id,
    versionId = props.source.mediaId
  const current = () =>
    alive &&
    customReader.value &&
    installation.value === owner &&
    contributed.value === contributor &&
    scope === props.scope &&
    sourceId === props.source.id &&
    versionId === props.source.mediaId
  return {
    material: {
      id: sourceId,
      versionId,
      title: props.source.title,
      format: props.source.format,
      document: props.source.document && structuredClone(props.source.document),
      parentSourceId: props.source.parentSourceId,
    },
    text: props.text,
    original: original.value,
    selection: currentSelection.value,
    position: requestedPosition.value?.locator
      ? {
          locator: requestedPosition.value.locator,
          projectionOffset: requestedPosition.value.offset,
        }
      : undefined,
    onSelect: (value) => {
      if (current()) materialSelected(value)
    },
    onPosition: (value) => {
      if (current()) materialPosition(value)
    },
  }
})
function readerFailed() {
  materialError.value = t('插件阅读器暂时无法显示，已切换到文本副本。')
  textOnly.value = true
}
async function exportOriginal() {
  if (exportingOriginal.value) return
  exportingOriginal.value = true
  try {
    const blob = original.value ?? (await originalBytes())
    const name =
      props.originalName ?? `${props.source.title}.${props.source.document?.format ?? 'bin'}`
    if (createExportFile) await blob.stream().pipeTo(await createExportFile(name))
    else {
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  } catch (issue) {
    if (alive && !(issue instanceof DOMException && issue.name === 'AbortError'))
      materialError.value = t(issue as Error)
  } finally {
    if (alive) exportingOriginal.value = false
  }
}
async function runCommand(commandId: string) {
  const owner = installation.value
  if (!owner || commandBusy.value) return
  const api = plugins.materialApiFor(owner.plugin.id)
  if (!api) return
  commandBusy.value = true
  materialError.value = ''
  try {
    await plugins.executeMaterialCommand(owner.plugin.id, commandId, {
      expectedRevision: api.snapshot().revision,
      operationId: crypto.randomUUID(),
      sourceId: props.source.id,
      selection: currentSelection.value,
    })
  } catch (issue) {
    if (alive) materialError.value = t(issue as Error)
  } finally {
    if (alive) commandBusy.value = false
  }
}
const reader = ref<{ textareaRef?: HTMLTextAreaElement }>(),
  rendered = ref<HTMLElement>()
type ReaderMediaInput = {
  scope: string
  sourceId: string
  versionId: string
  text: string
  media?: Source['inlineMedia']
  read?: (id: string) => Promise<Blob | undefined>
}
const mediaInput = computed<ReaderMediaInput>((previous) => {
  const next = {
    scope: props.scope,
    sourceId: props.source.id,
    versionId: props.source.mediaId,
    text: props.text,
    media: preview.value ? props.source.inlineMedia : undefined,
    read: props.getMedia,
  }
  // Position/metadata saves replace Source objects, but not their accepted media.
  // Keep URLs and preview DOM stable while still isolating every source/session.
  if (
    previous &&
    previous.scope === next.scope &&
    previous.sourceId === next.sourceId &&
    previous.versionId === next.versionId &&
    previous.text === next.text &&
    previous.read === next.read &&
    previous.media?.length === next.media?.length &&
    (next.media ?? []).every((entry, index) => {
      const before = previous.media![index]!
      return (
        before.url === entry.url &&
        before.mediaId === entry.mediaId &&
        before.path === entry.path &&
        before.hash === entry.hash
      )
    })
  )
    return previous
  return { ...next, media: next.media?.map((entry) => ({ ...entry })) }
})
const media = useInlineMedia(mediaInput)
const html = computed(() =>
  renderReadingMarkdown(props.text, media.urls.value, {
    editableTasks: props.editable,
  }),
)
watch(
  [rendered, html, () => props.busy],
  () => {
    // Saving reading progress must not replace text nodes or a native selection.
    // Only task controls change availability while the existing preview stays put.
    const disabled = !props.editable || !!props.busy
    for (const task of rendered.value?.querySelectorAll<HTMLElement>('[data-reading-task]') ?? []) {
      task.setAttribute('aria-disabled', String(disabled))
      task.tabIndex = disabled ? -1 : 0
    }
  },
  { flush: 'post' },
)
let mirror: TextareaPosition | undefined, observer: ResizeObserver | undefined
const restoring = ref(true)
let alive = true
let last: ReadingPosition = props.source.reading ?? { offset: 0, fraction: 0, view: 'source' }
let restoreSequence = 0

function capture(): ReadingPosition {
  if (customReader.value) return last
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
  selectionError.value = ''
  const textarea = reader.value?.textareaRef
  currentSelection.value =
    textarea && textarea.selectionEnd > textarea.selectionStart
      ? {
          text: props.text.slice(textarea.selectionStart, textarea.selectionEnd),
          locator: {
            schemaVersion: 1,
            sourceId: props.source.id,
            versionId: props.source.mediaId,
            kind: 'text',
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
            quote: props.text.slice(textarea.selectionStart, textarea.selectionEnd),
          },
        }
      : undefined
  if (reader.value?.textareaRef)
    emit(
      'select',
      props.source.id,
      reader.value?.textareaRef.selectionStart,
      reader.value?.textareaRef.selectionEnd,
    )
}
function selectedPreview() {
  const area = rendered.value,
    selection = area?.ownerDocument.getSelection()
  if (!area || !previewCurrent() || !selection?.rangeCount || !area.contains(selection.anchorNode))
    return
  selectionError.value = ''
  const range = selection.getRangeAt(0)
  const mapped = readingSelection(area, range, props.text)
  if (!mapped) {
    currentSelection.value = undefined
    emit('select', props.source.id, 0, 0)
    if (!range.collapsed && selection.toString().trim())
      selectionError.value = t('这段内容无法精确定位，请切换原文后选择。')
    return
  }
  try {
    const excerpt = sourceExcerpt(props.source, props.text, mapped.start, mapped.end)
    const locator: MaterialLocator = {
      schemaVersion: 1,
      sourceId: props.source.id,
      versionId: props.source.mediaId,
      kind: 'text',
      ...mapped,
      quote: excerpt.quote,
    }
    currentSelection.value = { text: excerpt.quote, locator }
    emit('select', props.source.id, mapped.start, mapped.end, locator)
  } catch (issue) {
    currentSelection.value = undefined
    emit('select', props.source.id, 0, 0)
    selectionError.value = t(issue as Error)
  }
}
function previewCurrent() {
  const data = rendered.value?.dataset
  return (
    alive &&
    data?.sourceId === props.source.id &&
    data.sourceVersion === props.source.mediaId &&
    data.sourceScope === props.scope
  )
}
function previewControl(event: MouseEvent | KeyboardEvent) {
  const target = (event.target as Element | null)?.closest<HTMLElement>(
    '[data-wiki-target], [data-reading-task]',
  )
  if (!target || !previewCurrent() || !rendered.value?.contains(target)) return
  if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (target.dataset.wikiTarget) {
    emit('wiki', target.dataset.wikiTarget)
    return
  }
  if (!props.editable || props.busy) return
  const offset = Number(target.dataset.readingTask)
  if (
    !Number.isInteger(offset) ||
    props.text[offset - 1] !== '[' ||
    props.text[offset + 1] !== ']' ||
    !/[ xX]/.test(props.text[offset] ?? '')
  )
    return
  emit('changeText', {
    sourceId: props.source.id,
    mediaId: props.source.mediaId,
    scope: props.scope,
    content:
      props.text.slice(0, offset) +
      (props.text[offset] === ' ' ? 'x' : ' ') +
      props.text.slice(offset + 1),
  })
}
function previewWiki(event: MouseEvent | FocusEvent) {
  const link = (event.target as Element | null)?.closest<HTMLElement>('[data-wiki-target]')
  if (previewCurrent() && link?.dataset.wikiTarget) emit('wikiPreview', link.dataset.wikiTarget)
}
async function restore(position: ReadingPosition, focus = false) {
  const sequence = ++restoreSequence
  restoring.value = true
  await nextTick()
  if (!alive || sequence !== restoreSequence) return
  if (customReader.value) {
    last = position
    requestedPosition.value = position
  }
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
  selectionError.value = ''
  await restore(position)
  observeReader()
  if (alive) emit('position', update())
}
async function resume() {
  mirror?.dispose()
  mirror = undefined
  preview.value = props.source.format === 'markdown' && props.source.reading?.view !== 'source'
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
  // The host's text projection remains an exact, plugin-independent way back to the source.
  textOnly.value = true
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
  if (customReader.value) {
    const sequence = ++originalSequence
    originalLoading.value = true
    try {
      const blob = await originalBytes()
      if (alive && sequence === originalSequence) original.value = blob
    } catch (issue) {
      if (alive && sequence === originalSequence) {
        materialError.value = t(issue as Error)
        textOnly.value = true
      }
    } finally {
      if (alive && sequence === originalSequence) originalLoading.value = false
    }
  }
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
  originalSequence++
  observer?.disconnect()
  mirror?.dispose()
})
defineExpose({ resume, restart, locate, capture: update, ready: computed(() => !restoring.value) })
</script>

<template>
  <div class="source-selection-tools">
    <template v-if="source.document">
      <UiButton v-if="contributed" variant="ghost" @click="textOnly = !textOnly">
        {{ t(customReader ? '查看文本副本' : '使用插件阅读器') }}
      </UiButton>
      <UiButton variant="secondary" :disabled="exportingOriginal" @click="exportOriginal">{{
        t('导出原件')
      }}</UiButton>
      <span v-if="!contributed" class="form-note">{{
        t('阅读器插件未启用，显示保留的文本副本。')
      }}</span>
    </template>
    <p class="form-note">
      {{
        t(
          source.kind === 'excerpt'
            ? '选中文字，再点击「用摘录制卡」。每次最多 10000 个字符。'
            : '选中文字，保存为摘录或直接制卡。每次最多 10000 个字符。',
        )
      }}
    </p>
    <UiButton
      variant="ghost"
      type="submit"
      v-if="source.format === 'markdown' && !customReader"
      :aria-pressed="preview"
      @click="toggle"
    >
      {{ t(preview ? '查看 Markdown 原文' : '阅读 Markdown 预览') }}
    </UiButton>
  </div>
  <p v-if="materialError" class="form-note" role="alert">{{ materialError }}</p>
  <p v-if="selectionError" class="form-note" role="status">{{ selectionError }}</p>
  <p v-if="customReader && originalLoading" role="status">{{ t('正在读取原始文件…') }}</p>
  <MaterialReaderView
    v-else-if="customReader && contributed"
    :key="installation!.instanceId"
    :component="contributed.component"
    :reader-props="readerProps"
    @failed="readerFailed"
  />
  <div
    v-else-if="preview"
    ref="rendered"
    class="source-markdown-preview markdown-content card-content"
    tabindex="0"
    :aria-label="t('材料阅读预览')"
    :aria-busy="restoring"
    :data-source-id="source.id"
    :data-source-version="source.mediaId"
    :data-source-scope="scope"
    @scroll.passive="scrolled"
    @mouseup="selectedPreview"
    @keyup="selectedPreview"
    @touchend="selectedPreview"
    @click="previewControl"
    @keydown="previewControl"
    @mouseover="previewWiki"
    @focusin="previewWiki"
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
  <div
    v-if="installation?.commands?.length"
    class="source-selection-tools"
    :aria-label="t('材料命令')"
  >
    <UiButton
      v-for="command in installation.commands"
      :key="command.id"
      variant="secondary"
      :disabled="commandBusy"
      @click="runCommand(command.id)"
      >{{ command.title }}</UiButton
    >
  </div>
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
.source-markdown-preview :deep(.reading-wiki-link) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
}
.source-markdown-preview :deep(.reading-task-toggle) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5em;
  cursor: pointer;
  color: var(--color-primary);
}
.source-markdown-preview :deep(.reading-task-toggle[aria-disabled='true']) {
  cursor: default;
}
.source-markdown-preview :deep([tabindex='0']:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
  border-radius: 3px;
}
</style>
