<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../core/content'
const props = defineProps<{ text: string; format: 'plain' | 'markdown' }>()
const html = computed(() => (props.format === 'markdown' ? renderMarkdown(props.text) : ''))
const paragraphs = computed(() => props.text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/))
</script>
<template>
  <div v-if="format === 'markdown'" class="card-content markdown-content" v-html="html" />
  <div v-else class="card-content plain-content">
    <p v-for="(paragraph, index) in paragraphs" :key="index" class="plain-paragraph">
      {{ paragraph }}
    </p>
  </div>
</template>
