<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { UiButton, UiNotice, type MaterialReaderProps } from '@repeaty/plugin-api'
import ImageSurface from './ImageSurface.vue'
import { cropImage } from './image'
import { type Rect, type Region, type Rotation } from './model'
const props = defineProps<MaterialReaderProps>()
const rotation = ref<Rotation>(0),
  selected = ref<Rect>(),
  cropped = ref<Blob>(),
  crop = ref(false),
  error = ref(''),
  busy = ref(false)
let generation = 0
watch(
  [() => props.workspaceScope, () => props.material.id, () => props.material.versionId],
  () => {
    generation++
    error.value = ''
    rotation.value = 0
    const locator = props.selection?.locator ?? props.position?.locator
    selected.value =
      locator?.kind === 'image'
        ? { x: locator.x, y: locator.y, width: locator.width, height: locator.height }
        : undefined
    crop.value = !!selected.value
  },
  { immediate: true },
)
watch(
  () => [props.original, selected.value, crop.value],
  async () => {
    const current = ++generation
    cropped.value = undefined
    if (!props.original || !selected.value || !crop.value) return
    try {
      const value = await cropImage(props.original, selected.value)
      if (current === generation) cropped.value = value
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)
const regions = computed<Region[]>(() =>
  selected.value && !crop.value ? [{ ...selected.value, id: 'selection', label: '选区' }] : [],
)
function select(rect: Rect) {
  selected.value = rect
  const locator = {
    schemaVersion: 1 as const,
    sourceId: props.material.id,
    versionId: props.material.versionId,
    kind: 'image' as const,
    ...rect,
  }
  props.onSelect({ locator, text: props.text, projection: { start: 0, end: props.text.length } })
  props.onPosition?.({ locator, projectionOffset: 0 })
}
async function download(region: boolean) {
  if (!props.original || busy.value) return
  busy.value = true
  error.value = ''
  const current = generation
  try {
    const blob =
      region && selected.value ? await cropImage(props.original, selected.value) : props.original
    if (current !== generation) return
    const url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = region
      ? `${props.material.title.replace(/\.[^.]+$/, '')}-选区.png`
      : props.material.title
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="vo-reader">
    <div class="vo-reader-actions">
      <UiButton v-if="selected" variant="secondary" @click="crop = !crop">{{
        crop ? '显示原图' : '仅看选区'
      }}</UiButton>
      <UiButton variant="ghost" :disabled="!original || busy" @click="download(false)"
        >保存原件</UiButton
      >
      <UiButton
        v-if="selected"
        variant="ghost"
        :disabled="!original || busy"
        @click="download(true)"
        >导出选区 PNG</UiButton
      >
      <UiButton
        v-if="material.parentSourceId && onOpen"
        variant="ghost"
        @click="onOpen(material.parentSourceId)"
        >返回来源材料</UiButton
      >
    </div>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
    <ImageSurface
      v-model:rotation="rotation"
      :blob="crop ? cropped : original"
      :regions="regions"
      selected="selection"
      :editable="!crop && !readOnly"
      :label="material.title"
      @add="select"
      @change="select"
    />
    <p class="vo-reader-hint">
      {{
        crop
          ? '正在显示保存的图片选区。'
          : '在原图上拖动框选，可添加区域批注、摘录或制作遮挡题。选区使用图片坐标，不进行 OCR。'
      }}
    </p>
  </section>
</template>
<style scoped>
.vo-reader-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.vo-reader-hint {
  font-size: 0.8rem;
  color: var(--ui-text-muted, #6d7d70);
  margin-top: 0.75rem;
}
</style>
