<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { materials, SettingField, UiNotice, type NoteInput } from '@repeaty/plugin-api'
import RegionEditor from './RegionEditor.vue'
import { parseData, visualNote, type VisualData } from './model'
import { regionLocators } from './workflow'
const props = defineProps<{ modelValue: NoteInput }>()
const emit = defineEmits<{ 'update:modelValue': [value: NoteInput] }>()
const data = computed(() => {
    const parsed = parseData(props.modelValue.plugin?.data)
    return parsed?.kind === 'image' && props.modelValue.backMedia[0]
      ? { ...parsed, mediaId: props.modelValue.backMedia[0] }
      : parsed
  }),
  blob = ref<Blob>(),
  error = ref('')
let generation = 0
watch(
  [
    () => props.modelValue.excerpt?.sourceId,
    () => props.modelValue.excerpt?.mediaId,
    () => (data.value?.kind === 'image' ? data.value.mediaId : ''),
  ],
  async () => {
    const current = ++generation
    blob.value = undefined
    error.value = ''
    if (data.value?.kind !== 'image') return
    const excerpt = props.modelValue.excerpt
    if (!excerpt) {
      error.value = '图片来源不可用，无法显示原图。已有区域和历史保持不变。'
      return
    }
    try {
      const value = await materials.original(
        excerpt.sourceId,
        excerpt.locator?.versionId ?? excerpt.mediaId,
      )
      if (current === generation) blob.value = value
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)
function update(value: VisualData) {
  if (!parseData(value)) return
  const original = props.modelValue,
    locator = original.excerpt?.locator
  const locators = locator
    ? regionLocators(value, locator, locator.kind === 'formula' ? locator : undefined)
    : undefined
  emit('update:modelValue', {
    ...original,
    plugin: visualNote(original, value, locators).plugin,
  })
}
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <SettingField
    label="题目提示"
    :model-value="modelValue.front"
    :maxlength="500"
    layout="stack"
    @update:model-value="emit('update:modelValue', { ...modelValue, front: String($event) })"
  />
  <UiNotice v-if="error" tone="warning">{{ error }}</UiNotice>
  <RegionEditor v-if="data" :model-value="data" :blob="blob" @update:model-value="update" />
  <UiNotice v-else tone="error">无法识别遮挡数据，原有题目和学习记录没有被修改。</UiNotice>
</template>
