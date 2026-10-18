<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../core/content'
const props = defineProps<{ text: string; format: 'plain' | 'markdown' }>()
const html = computed(() => (props.format === 'markdown' ? renderMarkdown(props.text) : ''))
</script>
<template>
  <div v-if="format === 'markdown'" class="card-content markdown-content" v-html="html" />
  <div v-else class="card-content plain-content">{{ text }}</div>
</template>
