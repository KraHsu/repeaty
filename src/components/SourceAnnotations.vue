<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { MessageSquare, Move, Maximize2, X } from '@lucide/vue'
import { useEventListener, useWindowSize } from '@vueuse/core'
import { UiButton, UiTextarea } from './ui'
import SourceContext from './SourceContext.vue'
import { t } from '../i18n'
import { readSetting, writeSetting } from '../settings-store'
import {
  sourceAtVersion,
  type Source,
  type SourceAnnotation,
  type SourceExcerpt,
} from '../core/source-data'
import type { SourceAnnotationUpdate } from '../core/source-workbench'
import type { MaterialWorkbenchActions } from './material-workbench-actions'

const props = defineProps<{
  source: Source
  scope: string
  busy: boolean
  actions: MaterialWorkbenchActions
  read: (id: string, signal?: AbortSignal, mediaId?: string) => Promise<string>
  getMedia?: (id: string) => Promise<Blob | undefined>
}>()
const draft = shallowRef<SourceAnnotationUpdate>(),
  body = ref(''),
  saving = ref(false),
  confirmClose = ref(false)
const error = ref(''),
  deleting = ref('')
let generation = 0,
  alive = true
const preview = shallowRef<{ source: Source; excerpt: SourceExcerpt }>()
const input = ref<{ textareaRef?: HTMLTextAreaElement }>()
const { width, height } = useWindowSize()
const geometry = reactive({ x: 80, y: 100, width: 400, height: 340 })
const geometryKey = 'repeaty.annotation-panel.v1'
let opener: HTMLElement | undefined
let gesture:
  | {
      element: HTMLElement
      id: number
      kind: 'move' | 'resize'
      x: number
      y: number
      before: typeof geometry
    }
  | undefined
const dirty = computed(() => !!draft.value && body.value !== draft.value.body)
useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (dirty.value || saving.value) {
    event.preventDefault()
    event.returnValue = ''
  }
})
function clamp() {
  geometry.width = Math.min(Math.max(280, geometry.width), Math.max(240, width.value - 24))
  geometry.height = Math.min(Math.max(260, geometry.height), Math.max(220, height.value - 76))
  geometry.x = Math.max(12, Math.min(geometry.x, width.value - geometry.width - 12))
  geometry.y = Math.max(52, Math.min(geometry.y, height.value - geometry.height - 12))
}
function persist() {
  try {
    writeSetting(geometryKey, JSON.stringify(geometry))
  } catch {
    /* Saving geometry must not block annotation editing. */
  }
}
function finish(commit: boolean) {
  const previous = gesture
  if (!previous) return
  gesture = undefined
  if (!commit) Object.assign(geometry, previous.before)
  try {
    previous.element.releasePointerCapture(previous.id)
  } catch {
    /* Capture already released. */
  }
  if (commit) persist()
}
function start(event: PointerEvent, kind: 'move' | 'resize') {
  if (event.button !== 0 || !event.isPrimary || gesture) return
  const element = event.currentTarget as HTMLElement
  try {
    element.setPointerCapture(event.pointerId)
  } catch {
    return
  }
  event.preventDefault()
  element.focus({ preventScroll: true })
  gesture = {
    element,
    id: event.pointerId,
    kind,
    x: event.clientX,
    y: event.clientY,
    before: { ...geometry },
  }
}
function move(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.id) return
  const dx = event.clientX - gesture.x,
    dy = event.clientY - gesture.y
  if (gesture.kind === 'move') {
    geometry.x = gesture.before.x + dx
    geometry.y = gesture.before.y + dy
  } else {
    geometry.width = gesture.before.width + dx
    geometry.height = gesture.before.height + dy
  }
  clamp()
}
function end(event: PointerEvent) {
  if (gesture?.id === event.pointerId) finish(true)
}
function cancel(event: PointerEvent) {
  if (gesture?.id === event.pointerId) finish(false)
}
function keyboard(event: KeyboardEvent, kind: 'move' | 'resize') {
  const dx = event.key === 'ArrowLeft' ? -8 : event.key === 'ArrowRight' ? 8 : 0
  const dy = event.key === 'ArrowUp' ? -8 : event.key === 'ArrowDown' ? 8 : 0
  if (!dx && !dy) return
  event.preventDefault()
  if (kind === 'move') {
    geometry.x += dx
    geometry.y += dy
  } else {
    geometry.width += dx
    geometry.height += dy
  }
  clamp()
  persist()
}
watch(
  [() => props.scope, () => props.source.id],
  () => {
    generation++
    finish(false)
    draft.value = undefined
    preview.value = undefined
    deleting.value = ''
    confirmClose.value = false
    saving.value = false
    error.value = ''
    try {
      const stored = JSON.parse(readSetting(geometryKey) ?? '{}')
      for (const name of ['x', 'y', 'width', 'height'] as const)
        if (Number.isFinite(stored[name])) geometry[name] = stored[name]
    } catch {
      /* Use defaults. */
    }
    clamp()
  },
  { immediate: true, flush: 'sync' },
)
watch([width, height], clamp)
onUnmounted(() => {
  alive = false
  generation++
  finish(false)
})
async function open(value: SourceAnnotationUpdate) {
  if (dirty.value || saving.value) {
    confirmClose.value = true
    return
  }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  draft.value = value
  body.value = value.body
  confirmClose.value = false
  error.value = ''
  clamp()
  await nextTick()
  input.value?.textareaRef?.focus()
}
function add(excerpt: SourceExcerpt) {
  const snapshot = sourceAtVersion(props.source, excerpt.mediaId)
  if (excerpt.sourceId !== props.source.id || !snapshot) return
  void open({
    sourceId: excerpt.sourceId,
    mediaId: snapshot.mediaId,
    scope: props.scope,
    start: excerpt.start,
    end: excerpt.end,
    quote: excerpt.quote,
    body: '',
    locator: excerpt.locator,
  })
}
function edit(annotation: SourceAnnotation) {
  void open({ ...annotation, sourceId: props.source.id, scope: props.scope })
}
function show(annotation: SourceAnnotation) {
  const source = sourceAtVersion(props.source, annotation.mediaId)
  if (source)
    preview.value = {
      source,
      excerpt: {
        sourceId: source.id,
        mediaId: annotation.mediaId,
        start: annotation.start,
        end: annotation.end,
        quote: annotation.quote,
        locator: annotation.locator,
      },
    }
}
function close(force = false) {
  if (saving.value) return
  if (dirty.value && !force) {
    confirmClose.value = true
    return
  }
  finish(true)
  draft.value = undefined
  confirmClose.value = false
  void nextTick(() => opener?.isConnected && opener.focus())
}
async function save() {
  if (!draft.value || props.busy || saving.value || !body.value.trim()) return
  const opened = draft.value,
    current = generation
  const owns = () =>
    alive && generation === current && draft.value === opened && opened.scope === props.scope
  saving.value = true
  error.value = ''
  try {
    if ((await props.actions.annotate({ ...opened, body: body.value })) && owns()) {
      saving.value = false
      close(true)
    }
  } catch (issue) {
    if (owns()) error.value = t(issue as Error)
  } finally {
    if (owns()) saving.value = false
  }
}
async function remove(id: string) {
  if (props.busy || saving.value) return
  if (draft.value?.id === id && dirty.value) {
    confirmClose.value = true
    return
  }
  if (deleting.value !== id) {
    deleting.value = id
    return
  }
  const current = generation,
    sourceId = props.source.id,
    scope = props.scope
  const owns = () =>
    alive && generation === current && props.scope === scope && props.source.id === sourceId
  saving.value = true
  error.value = ''
  try {
    if ((await props.actions.removeAnnotation(sourceId, id, scope)) && owns()) {
      deleting.value = ''
      if (draft.value?.id === id) {
        saving.value = false
        close(true)
      }
    }
  } catch (issue) {
    if (owns()) error.value = t(issue as Error)
  } finally {
    if (owns()) saving.value = false
  }
}
defineExpose({
  add,
  dirty,
  flush: async () => {
    if (dirty.value) {
      confirmClose.value = true
      await nextTick()
      input.value?.textareaRef?.focus()
    }
    return !dirty.value && !saving.value
  },
})
</script>
<template>
  <section class="source-annotations" :aria-label="t('文字批注')">
    <h3>
      <MessageSquare :size="16" />{{ t('文字批注') }}
      <span>{{ source.annotations?.length ?? 0 }}</span>
    </h3>
    <p v-if="!source.annotations?.length" class="form-note">
      {{ t('选取正文中的文字，再添加批注。') }}
    </p>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    <article v-for="annotation in source.annotations" :key="annotation.id" class="annotation-item">
      <UiButton variant="ghost" class="annotation-quote" @click="show(annotation)">{{
        annotation.quote
      }}</UiButton>
      <p class="annotation-body">{{ annotation.body }}</p>
      <small v-if="annotation.mediaId !== source.mediaId">{{ t('来自历史版本') }}</small>
      <div class="annotation-actions">
        <UiButton variant="ghost" :disabled="busy || saving" @click="edit(annotation)">{{
          t('编辑')
        }}</UiButton
        ><UiButton variant="ghost" :disabled="busy || saving" @click="remove(annotation.id)">{{
          t(deleting === annotation.id ? '确认删除' : '删除')
        }}</UiButton
        ><UiButton v-if="deleting === annotation.id" variant="ghost" @click="deleting = ''">{{
          t('取消')
        }}</UiButton>
      </div>
    </article>
  </section>
  <SourceContext
    v-if="preview"
    :source="preview.source"
    :excerpt="preview.excerpt"
    :read="read"
    :get-media="getMedia"
    @close="preview = undefined"
  />
  <Teleport to="body">
    <section
      v-if="draft"
      class="annotation-floating"
      role="dialog"
      :aria-label="t('编辑批注')"
      :style="{
        left: geometry.x + 'px',
        top: geometry.y + 'px',
        width: geometry.width + 'px',
        height: geometry.height + 'px',
      }"
      @keydown.esc.stop="close()"
    >
      <header>
        <UiButton
          variant="ghost"
          class="annotation-drag"
          :aria-label="t('移动批注面板，方向键调整位置')"
          @pointerdown="start($event, 'move')"
          @pointermove="move"
          @pointerup="end"
          @pointercancel="cancel"
          @lostpointercapture="cancel"
          @keydown="keyboard($event, 'move')"
          ><Move :size="16" />{{ t('编辑批注') }}</UiButton
        >
        <UiButton variant="ghost" :aria-label="t('关闭')" :disabled="saving" @click="close()"
          ><X :size="16"
        /></UiButton>
      </header>
      <div class="annotation-edit-body">
        <blockquote>{{ draft.quote }}</blockquote>
        <UiTextarea
          ref="input"
          v-model="body"
          :aria-label="t('批注内容')"
          :disabled="busy || saving"
          :maxlength="10000"
          :rows="5"
        />
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <p v-if="confirmClose" role="alert">
          {{ t('批注尚未保存。请先保存，或放弃更改。')
          }}<UiButton variant="ghost" @click="close(true)">{{ t('放弃更改') }}</UiButton>
        </p>
      </div>
      <footer>
        <UiButton variant="primary" :disabled="busy || saving || !body.trim()" @click="save">{{
          t('保存批注')
        }}</UiButton
        ><UiButton
          variant="ghost"
          class="annotation-resize"
          :aria-label="t('调整批注面板大小，方向键调整尺寸')"
          @pointerdown="start($event, 'resize')"
          @pointermove="move"
          @pointerup="end"
          @pointercancel="cancel"
          @lostpointercapture="cancel"
          @keydown="keyboard($event, 'resize')"
          ><Maximize2 :size="16"
        /></UiButton>
      </footer>
    </section>
  </Teleport>
</template>
<style scoped>
.source-annotations h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--font-size-body);
  margin: 0 0 0.75rem;
}
.source-annotations h3 span {
  color: var(--muted);
  font-weight: 400;
}
.annotation-item {
  border-top: 1px solid var(--line);
  padding: 0.75rem 0;
}
.annotation-quote {
  display: -webkit-box !important;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden !important;
  text-align: left !important;
  white-space: normal !important;
  padding: 0 !important;
  color: var(--green) !important;
}
.annotation-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-meta);
  margin: 0.5rem 0;
}
.annotation-actions {
  display: flex;
  gap: 0.25rem;
}
.annotation-floating {
  position: fixed;
  z-index: 45;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 16px 56px #0003;
  overflow: hidden;
}
.annotation-floating header,
.annotation-floating footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  gap: 0.5rem;
  flex-shrink: 0;
}
.annotation-floating header {
  border-bottom: 1px solid var(--line);
}
.annotation-drag {
  flex: 1;
  justify-content: flex-start !important;
  cursor: move !important;
  touch-action: none;
}
.annotation-edit-body {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 1rem;
}
.annotation-edit-body blockquote {
  margin: 0 0 1rem;
  padding-left: 0.75rem;
  border-left: 2px solid var(--green);
  color: var(--muted);
  font-size: var(--font-size-meta);
  max-height: 5rem;
  overflow: auto;
  white-space: pre-wrap;
}
.annotation-resize {
  cursor: nwse-resize !important;
  touch-action: none;
}
</style>
