<script setup lang="ts">
import { defineAsyncComponent, onMounted } from 'vue'
import type { QuestionProps } from '../../plugins/types'
import MediaList from '../MediaList.vue'
const CardContent = defineAsyncComponent(() => import('../CardContent.vue'))
const props = defineProps<QuestionProps>()
onMounted(() => {
  props.state.allowedGrades = [1, 2, 3, 4]
})
</script>
<template>
  <div
    class="card-question"
    :class="{ 'long-content': card.front.length > 300 }"
    role="heading"
    aria-level="1"
  >
    <CardContent
      :text="card.front"
      :format="card.format"
      :inline-media="card.inlineMedia"
      :get-media="getMedia"
    />
  </div>
  <MediaList :ids="card.frontMedia" :media="media" :get-media="getMedia" />
</template>
