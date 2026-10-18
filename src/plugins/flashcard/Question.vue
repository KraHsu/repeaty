<script setup lang="ts">
import { defineAsyncComponent, onMounted } from 'vue'
import type { QuestionProps } from '../types'
import MediaList from '../../components/MediaList.vue'
const CardContent = defineAsyncComponent(() => import('../../components/CardContent.vue'))
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
    <CardContent :text="card.front" :format="card.format" />
  </div>
  <MediaList :ids="card.frontMedia" :media="media" :get-media="getMedia" />
</template>
