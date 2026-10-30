<script setup lang="ts">
import { computed } from 'vue'
import { CardContent, MediaList, type QuestionProps } from '@repeaty/plugin-api'
import { activeRegion, parseData } from './model'
const props = defineProps<QuestionProps>()
const data = computed(() => parseData(props.card.plugin?.data)),
  active = computed(() => (data.value ? activeRegion(data.value, props.card.variant) : undefined))
const notes = computed(() =>
  data.value?.kind === 'formula' && props.card.back.trim() === `$$\n${data.value.latex}\n$$`
    ? ''
    : props.card.back,
)
const attachments = computed(() =>
  data.value?.kind === 'image' ? props.card.backMedia.slice(1) : props.card.backMedia,
)
</script>
<template>
  <p v-if="active" class="vo-answer">
    {{ active.label || '当前区域' }}已显示，请对照原图或公式评分。
  </p>
  <p v-else>{{ card.back }}</p>
  <CardContent v-if="active && notes" :text="notes" :format="card.format" />
  <MediaList
    v-if="active && attachments.length"
    :ids="attachments"
    :media="media"
    :get-media="getMedia"
  />
</template>
<style scoped>
.vo-answer {
  font-size: 0.875rem;
  color: var(--ui-text-muted, #6d7d70);
}
</style>
