<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import type { QuestionProps } from '../types'
import MediaList from '../../components/MediaList.vue'
const CardContent = defineAsyncComponent(() => import('../../components/CardContent.vue'))
defineProps<QuestionProps>()
</script>
<template>
  <CardContent :text="card.back" :format="card.format" />
  <MediaList :ids="card.backMedia" :media="media" :get-media="getMedia" />
</template>
