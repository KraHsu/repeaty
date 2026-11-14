<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SettingField, UiButton, UiNotice, type SettingValue } from '@repeaty/plugin-api'
import ImageSurface from './ImageSurface.vue'
import FormulaSurface from './FormulaSurface.vue'
import {
  MAX_REGIONS,
  type VisualData,
  type Region,
  type Rect,
  type Rotation,
  type FormulaRegion,
} from './model'
const props = defineProps<{ modelValue: VisualData; blob?: Blob }>()
const emit = defineEmits<{ 'update:modelValue': [value: VisualData] }>()
const selected = ref(props.modelValue.regions[0]?.id ?? ''),
  leaves = ref<number[]>([]),
  tokens = ref<string[]>([])
const active = computed(() =>
  props.modelValue.regions.find((region) => region.id === selected.value),
)
const choices = computed(() =>
  props.modelValue.regions.map((region, index) => ({
    value: region.id,
    label: `${index + 1}. ${region.label || '未命名区域'}`,
  })),
)
const full = computed(
  () =>
    props.modelValue.regions.length + (props.modelValue.retiredRegions?.length ?? 0) >= MAX_REGIONS,
)
watch(
  () => props.modelValue,
  () => {
    if (!active.value) selected.value = props.modelValue.regions[0]?.id ?? ''
  },
)
watch(
  selected,
  () => {
    const region = active.value
    leaves.value = region && 'leaves' in region ? [...region.leaves] : []
  },
  { immediate: true },
)
function update(change: Partial<VisualData>) {
  emit('update:modelValue', { ...props.modelValue, ...change } as VisualData)
}
function add(rect: Rect) {
  if (full.value || props.modelValue.kind !== 'image') return
  const region = {
    ...rect,
    id: crypto.randomUUID(),
    label: `区域 ${props.modelValue.regions.length + 1}`,
  }
  emit('update:modelValue', { ...props.modelValue, regions: [...props.modelValue.regions, region] })
  selected.value = region.id
}
function change(region: Region | FormulaRegion) {
  update({
    regions: props.modelValue.regions.map((item) => (item.id === region.id ? region : item)),
  } as Partial<VisualData>)
}
function label(value: SettingValue) {
  if (active.value) change({ ...active.value, label: String(value).slice(0, 160) })
}
function remove() {
  if (!active.value || props.modelValue.regions.length < 2) return
  update({
    regions: props.modelValue.regions.filter((region) => region.id !== selected.value),
    retiredRegions: [...(props.modelValue.retiredRegions ?? []), active.value],
  } as Partial<VisualData>)
}
function restore(id: string) {
  const region = props.modelValue.retiredRegions?.find((region) => region.id === id)
  if (!region) return
  update({
    regions: [...props.modelValue.regions, region],
    retiredRegions: props.modelValue.retiredRegions?.filter((region) => region.id !== id),
  } as Partial<VisualData>)
  selected.value = id
}
function formulaRegion(replace: boolean) {
  if (props.modelValue.kind !== 'formula' || !leaves.value.length || (!replace && full.value))
    return
  const region = {
    id: replace && active.value ? active.value.id : crypto.randomUUID(),
    label:
      replace && active.value ? active.value.label : `区域 ${props.modelValue.regions.length + 1}`,
    leaves: [...leaves.value],
  }
  emit('update:modelValue', {
    ...props.modelValue,
    tokens: tokens.value,
    regions: replace
      ? props.modelValue.regions.map((item) => (item.id === region.id ? region : item))
      : [...props.modelValue.regions, region],
  })
  selected.value = region.id
}
function rotation(value: Rotation) {
  if (props.modelValue.kind === 'image') update({ rotation: value })
}
function coordinate(axis: keyof Rect, value: SettingValue) {
  if (!active.value || !('x' in active.value)) return
  const region = { ...active.value, [axis]: Math.max(0, Math.min(100, Number(value))) / 100 }
  region.width = Math.max(0.001, Math.min(region.width, 1 - region.x))
  region.height = Math.max(0.001, Math.min(region.height, 1 - region.y))
  region.x = Math.min(region.x, 1 - region.width)
  region.y = Math.min(region.y, 1 - region.height)
  change(region)
}
</script>
<template>
  <div class="vo-author app-section-stack">
    <ImageSurface
      v-if="modelValue.kind === 'image'"
      :blob="blob"
      :regions="modelValue.regions"
      :selected="selected"
      :rotation="modelValue.rotation"
      editable
      @add="add"
      @change="change"
      @select="selected = $event"
      @update:rotation="rotation"
      @ready="update({ width: $event.width, height: $event.height })"
    />
    <template v-else>
      <FormulaSurface
        :latex="modelValue.latex"
        editable
        :selected="leaves"
        @ready="tokens = $event"
        @select="leaves = $event"
      />
      <p class="vo-muted">
        拖选公式中的字符，或点击选择；Shift 连选，Ctrl / ⌘ 多选。每组选择生成一张独立卡片。
      </p>
      <div class="vo-actions">
        <UiButton variant="primary" :disabled="!leaves.length || full" @click="formulaRegion(false)"
          >添加遮挡区域</UiButton
        >
        <UiButton
          variant="secondary"
          :disabled="!active || !leaves.length"
          @click="formulaRegion(true)"
          >替换当前选区</UiButton
        >
        <span class="vo-muted">已选 {{ leaves.length }} 个公式元素</span>
      </div>
    </template>
    <div class="vo-fields">
      <SettingField
        type="select"
        label="遮挡区域"
        :model-value="selected"
        :options="choices"
        :disabled="!choices.length"
        layout="stack"
        @update:model-value="selected = String($event)"
      />
      <SettingField
        label="区域名称"
        :model-value="active?.label ?? ''"
        :disabled="!active"
        :maxlength="160"
        layout="stack"
        placeholder="例如：细胞核 / 分母"
        @update:model-value="label"
      />
    </div>
    <div v-if="active && 'x' in active" class="vo-coordinates">
      <SettingField
        v-for="axis in ['x', 'y', 'width', 'height'] as const"
        :key="axis"
        type="number"
        :label="{ x: '左侧', y: '顶部', width: '宽度', height: '高度' }[axis]"
        :model-value="Math.round(active[axis] * 10000) / 100"
        :min="0"
        :max="100"
        :step="0.1"
        unit="%"
        layout="stack"
        @update:model-value="coordinate(axis, $event)"
      />
    </div>
    <SettingField
      type="select"
      label="复习时其他区域"
      :model-value="modelValue.mode"
      :options="[
        { value: 'one', label: '只遮挡当前区域' },
        { value: 'all', label: '同时遮挡其他区域' },
      ]"
      layout="stack"
      @update:model-value="update({ mode: $event === 'all' ? 'all' : 'one' })"
    />
    <div class="vo-actions">
      <span class="vo-muted"
        >{{ modelValue.regions.length }} 张卡片 · 移动、重命名保留卡片 ID 和学习进度</span
      >
      <UiButton variant="ghost" :disabled="modelValue.regions.length < 2" @click="remove"
        >退役当前区域</UiButton
      >
    </div>
    <UiNotice v-if="full" tone="info"
      >每组最多保存 {{ MAX_REGIONS }} 个区域（含退役区域）。可移动或恢复已有区域。</UiNotice
    >
    <div v-if="modelValue.retiredRegions?.length" class="vo-retired app-section-divider">
      <p class="vo-muted">退役区域不再出题，恢复时沿用原卡片与完整历史。</p>
      <UiButton
        v-for="region in modelValue.retiredRegions"
        :key="region.id"
        variant="secondary"
        @click="restore(region.id)"
        >恢复 {{ region.label }}</UiButton
      >
    </div>
  </div>
</template>
<style scoped>
.vo-author {
  min-width: 0;
  --app-content-gap: 1rem;
}
.vo-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.vo-coordinates {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
}
.vo-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.vo-muted {
  font-size: 0.8rem;
  color: var(--ui-text-muted, #6d7d70);
  margin: 0;
}
.vo-retired {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.vo-retired p {
  width: 100%;
}
@media (max-width: 560px) {
  .vo-fields {
    grid-template-columns: 1fr;
  }
  .vo-coordinates {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
