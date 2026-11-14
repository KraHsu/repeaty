<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { UiNotice, type QuestionProps } from '@repeaty/plugin-api'
import { activeRegion, masked, parseData, type Rotation } from './model'
import ImageSurface from './ImageSurface.vue'
import FormulaSurface from './FormulaSurface.vue'
const props = defineProps<QuestionProps>()
const data = computed(() => {
    const parsed = parseData(props.card.plugin?.data)
    return parsed?.kind === 'image' && props.card.backMedia[0]
      ? { ...parsed, mediaId: props.card.backMedia[0] }
      : parsed
  }),
  active = computed(() => (data.value ? activeRegion(data.value, props.card.variant) : undefined))
const blob = ref<Blob>(),
  error = ref(''),
  rotation = ref<Rotation>(0),
  ready = ref(false)
let generation = 0
watch(
  [
    () => props.workspaceScope,
    () => props.card.noteId,
    () => (data.value?.kind === 'image' ? data.value.mediaId : ''),
  ],
  async () => {
    const current = ++generation
    blob.value = undefined
    ready.value = false
    error.value = ''
    if (data.value?.kind !== 'image') return
    rotation.value = data.value.rotation
    try {
      const value = await props.getMedia(data.value.mediaId)
      if (current === generation) blob.value = value
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)
const hidden = computed(() =>
  data.value && active.value
    ? data.value.regions
        .filter((region) => masked(data.value!, region.id, active.value!.id, props.revealed))
        .map((region) => region.id)
    : [],
)
watchEffect(() => {
  props.state.allowedGrades =
    props.revealed && ready.value && data.value && active.value ? [1, 2, 3, 4] : []
})
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <div class="vo-question">
    <p class="vo-question-prompt">{{ card.front }}</p>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
    <UiNotice v-if="!data || !active" tone="warning"
      >此遮挡区域不可用。原始题目、答案和历史仍然保留，请编辑卡片检查。</UiNotice
    >
    <template v-else>
      <p class="vo-question-label">{{ active.label || '回想被遮挡的内容' }}</p>
      <ImageSurface
        v-if="data.kind === 'image'"
        v-model:rotation="rotation"
        :blob="blob"
        :regions="data.regions"
        :hidden="hidden"
        :answer="revealed ? active.id : undefined"
        label="遮挡题原图"
        @ready="ready = true"
      />
      <FormulaSurface
        v-else
        :latex="data.latex"
        :data="data"
        :active="active.id"
        :revealed="revealed"
        @ready="ready = true"
      />
    </template>
  </div>
</template>
<style scoped>
.vo-question-prompt {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}
.vo-question-label {
  font-size: 0.875rem;
  color: var(--ui-text-muted, #6d7d70);
}
</style>
