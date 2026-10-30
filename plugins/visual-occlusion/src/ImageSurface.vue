<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { UiButton, UiNotice } from '@repeaty/plugin-api'
import { inspectImage, type ImageInfo } from './image'
import {
  displayRect,
  imagePoint,
  moveRect,
  rectFromPoints,
  validRect,
  type Rect,
  type Region,
  type Rotation,
} from './model'
const props = withDefaults(
  defineProps<{
    blob?: Blob
    regions?: Region[]
    selected?: string
    rotation?: Rotation
    editable?: boolean
    hidden?: string[]
    answer?: string
    label?: string
  }>(),
  { regions: () => [], rotation: 0, hidden: () => [] },
)
const emit = defineEmits<{
  add: [rect: Rect]
  change: [region: Region]
  select: [id: string]
  ready: [info: ImageInfo]
  'update:rotation': [value: Rotation]
}>()
const viewport = ref<HTMLElement>(),
  surface = ref<HTMLElement>(),
  source = ref(''),
  info = ref<ImageInfo>(),
  error = ref(''),
  width = ref(640),
  zoom = ref(1),
  draft = ref<Rect>()
let generation = 0,
  objectUrl: string | undefined,
  observer: ResizeObserver | undefined,
  resizeFrame = 0
type Drag = {
  pointer: number
  start: { x: number; y: number }
  rect?: Region
  mode: 'draw' | 'move' | 'resize'
}
let drag: Drag | undefined
const rotated = computed(() => props.rotation === 90 || props.rotation === 270)
const dimensions = computed(() => ({
  width: rotated.value ? (info.value?.height ?? 1) : (info.value?.width ?? 1),
  height: rotated.value ? (info.value?.width ?? 1) : (info.value?.height ?? 1),
}))
const scale = computed(() => Math.min(1, (width.value - 2) / dimensions.value.width) * zoom.value)
const stageStyle = computed(() => ({
  width: `${dimensions.value.width * scale.value}px`,
  height: `${dimensions.value.height * scale.value}px`,
}))
const imageStyle = computed(() => ({
  width: `${(info.value?.width ?? 1) * scale.value}px`,
  height: `${(info.value?.height ?? 1) * scale.value}px`,
  transform: `translate(-50%, -50%) rotate(${props.rotation}deg)`,
}))
function rectangle(rect: Rect) {
  const value = displayRect(rect, props.rotation)
  return {
    left: `${value.x * 100}%`,
    top: `${value.y * 100}%`,
    width: `${value.width * 100}%`,
    height: `${value.height * 100}%`,
  }
}
watch(
  () => props.blob,
  async (blob) => {
    const current = ++generation
    source.value = ''
    info.value = undefined
    error.value = ''
    zoom.value = 1
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
    if (!blob) return
    try {
      const next = await inspectImage(blob)
      if (current !== generation) return
      info.value = next
      objectUrl = URL.createObjectURL(blob.slice(0, blob.size, next.type))
      source.value = objectUrl
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)
function loaded(event: Event) {
  if (!info.value) return
  const image = event.target as HTMLImageElement
  if (image.src !== source.value || !image.naturalWidth) return
  info.value = { ...info.value, width: image.naturalWidth, height: image.naturalHeight }
  emit('ready', info.value)
}
function point(event: PointerEvent) {
  const box = surface.value!.getBoundingClientRect()
  return imagePoint(
    (event.clientX - box.left) / box.width,
    (event.clientY - box.top) / box.height,
    props.rotation,
  )
}
function start(event: PointerEvent, region?: Region, resize = false) {
  if (!props.editable || event.button !== 0 || !surface.value) return
  event.preventDefault()
  event.stopPropagation()
  if (region) emit('select', region.id)
  const displayed = region && resize ? displayRect(region, props.rotation) : undefined
  drag = {
    pointer: event.pointerId,
    start: displayed ? imagePoint(displayed.x, displayed.y, props.rotation) : point(event),
    rect: region ? { ...region } : undefined,
    mode: region ? (resize ? 'resize' : 'move') : 'draw',
  }
  surface.value.setPointerCapture?.(event.pointerId)
}
function moving(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return
  const next = point(event)
  if (drag.mode === 'draw') draft.value = rectFromPoints(drag.start, next)
  else if (drag.rect) {
    const rect =
      drag.mode === 'move'
        ? moveRect(drag.rect, next.x - drag.start.x, next.y - drag.start.y)
        : rectFromPoints(drag.start, next)
    if (validRect(rect)) emit('change', { ...drag.rect, ...rect })
  }
}
function finish(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return
  if (drag.mode === 'draw') {
    const rect = rectFromPoints(drag.start, point(event))
    if (
      validRect(rect) &&
      rect.width * (info.value?.width ?? 0) >= 3 &&
      rect.height * (info.value?.height ?? 0) >= 3
    )
      emit('add', rect)
  }
  drag = undefined
  draft.value = undefined
}
function cancel() {
  drag = undefined
  draft.value = undefined
}
function key(event: KeyboardEvent, region: Region) {
  if (!props.editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return
  event.preventDefault()
  const step = event.shiftKey ? 0.02 : 0.005
  const delta = imagePoint(
    0.5 + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
    0.5 + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
    props.rotation,
  )
  emit('change', { ...region, ...moveRect(region, delta.x - 0.5, delta.y - 0.5) })
}
onMounted(() => {
  if (viewport.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(([entry]) => {
      const measured = Math.max(160, entry?.contentRect.width ?? 640)
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        if (Math.abs(width.value - measured) > 0.5) width.value = measured
      })
    })
    observer.observe(viewport.value)
  }
})
onBeforeUnmount(() => {
  generation++
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  cancel()
})
</script>
<template>
  <div class="vo-image">
    <div class="vo-toolbar" aria-label="图片视图">
      <UiButton
        variant="ghost"
        :disabled="zoom <= 0.25"
        aria-label="缩小图片"
        @click="zoom = Math.max(0.25, zoom / 1.25)"
        >−</UiButton
      >
      <span class="vo-zoom">{{ Math.round(zoom * 100) }}%</span>
      <UiButton
        variant="ghost"
        :disabled="zoom >= 4"
        aria-label="放大图片"
        @click="zoom = Math.min(4, zoom * 1.25)"
        >+</UiButton
      >
      <UiButton variant="ghost" @click="zoom = 1">适合宽度</UiButton>
      <UiButton
        variant="ghost"
        @click="emit('update:rotation', ((rotation + 90) % 360) as Rotation)"
        >旋转 90°</UiButton
      >
      <span v-if="editable" class="vo-hint">拖动框选 · 拖动区域移动 · 拖动右下角调整</span>
    </div>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
    <div ref="viewport" class="vo-viewport">
      <div
        v-if="source && info"
        ref="surface"
        class="vo-stage"
        :class="{ 'vo-stage-editable': editable }"
        :style="stageStyle"
        @pointerdown="start($event)"
        @pointermove="moving"
        @pointerup="finish"
        @pointercancel="cancel"
        @lostpointercapture="cancel"
      >
        <img
          :src="source"
          :alt="label ?? '图片学习材料'"
          :style="imageStyle"
          draggable="false"
          @load="loaded"
          @error="error = '图片解码失败，请检查原件。'"
        />
        <div
          v-for="(region, index) in regions"
          :key="region.id"
          class="vo-region"
          :class="{
            'is-selected': selected === region.id,
            'is-masked': hidden.includes(region.id),
            'is-answer': answer === region.id,
          }"
          :style="rectangle(region)"
          :tabindex="editable ? 0 : undefined"
          :role="editable ? 'button' : undefined"
          :aria-label="`区域 ${index + 1}：${region.label || '未命名'}。方向键移动，Shift 加速。`"
          @pointerdown="start($event, region)"
          @focus="emit('select', region.id)"
          @keydown="key($event, region)"
        >
          <span class="vo-region-number">{{ index + 1 }}</span>
          <span
            v-if="editable && selected === region.id"
            class="vo-resize"
            @pointerdown="start($event, region, true)"
          />
        </div>
        <div v-if="draft" class="vo-region vo-draft" :style="rectangle(draft)" />
      </div>
      <p v-else-if="!error" class="vo-hint">
        {{ blob ? '正在读取图片…' : '原件暂不可用，图片和学习记录仍保存在学习库中。' }}
      </p>
    </div>
  </div>
</template>
<style scoped>
.vo-toolbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  padding: 0.5rem 0;
}
.vo-image {
  min-width: 0;
  max-width: 100%;
}
.vo-zoom {
  min-width: 3.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
}
.vo-hint {
  color: var(--ui-text-muted, #6d7d70);
  font-size: 0.8rem;
}
.vo-viewport {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  overflow: auto;
  max-height: 34rem;
  border: 1px solid var(--ui-border, #d7e2d2);
  border-radius: 10px;
  background: var(--ui-bg-muted, #f2f5ef);
  min-height: 5rem;
}
.vo-stage {
  position: relative;
  margin: auto;
  user-select: none;
  flex: none;
}
.vo-stage-editable {
  touch-action: none;
  cursor: crosshair;
}
.vo-stage img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  pointer-events: none;
}
.vo-region {
  position: absolute;
  border: 2px solid var(--ui-primary, #356b52);
  box-sizing: border-box;
  background: color-mix(in srgb, var(--ui-primary, #356b52) 8%, transparent);
}
.vo-region.is-selected {
  outline: 2px solid var(--ui-bg, #fff);
  outline-offset: 1px;
  background: color-mix(in srgb, var(--ui-primary, #356b52) 20%, transparent);
}
.vo-region[role='button'] {
  cursor: move;
}
.vo-region.is-masked {
  background: var(--ui-primary, #356b52);
}
.vo-region.is-answer {
  border-color: var(--ui-primary, #356b52);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary, #356b52) 25%, transparent);
}
.vo-region-number {
  position: absolute;
  top: 0;
  left: 0;
  background: var(--ui-primary, #356b52);
  color: var(--ui-bg, #fff);
  font: 600 11px/1.4 sans-serif;
  min-width: 1rem;
  text-align: center;
  pointer-events: none;
}
.vo-resize {
  position: absolute;
  bottom: -5px;
  right: -5px;
  width: 11px;
  height: 11px;
  background: var(--ui-primary, #356b52);
  border: 2px solid var(--ui-bg, #fff);
  cursor: nwse-resize;
}
.vo-draft {
  pointer-events: none;
  border-style: dashed;
}
</style>
