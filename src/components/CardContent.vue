<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../core/content'
import { useInlineMedia } from '../composables/useInlineMedia'
import type { InlineMedia } from '../core/inline-media'
import { t } from '../i18n'
const props = defineProps<{
  text: string
  format: 'plain' | 'markdown'
  inlineMedia?: InlineMedia
  getMedia?: (id: string) => Promise<Blob | undefined>
}>()
const media = useInlineMedia(() => ({
  text: props.text,
  media: props.format === 'markdown' ? props.inlineMedia : undefined,
  read: props.getMedia,
}))
const html = computed(() =>
  props.format === 'markdown' ? renderMarkdown(props.text, media.urls.value) : '',
)
const paragraphs = computed(() => props.text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/))
</script>
<template>
  <div v-if="format === 'markdown'" class="card-content markdown-content" v-html="html" />
  <div v-else class="card-content plain-content">
    <p v-for="(paragraph, index) in paragraphs" :key="index" class="plain-paragraph">
      {{ paragraph }}
    </p>
  </div>
  <p v-if="media.error.value" role="alert" class="form-note">
    {{ t('部分媒体无法读取，请从完整备份恢复。') }}
  </p>
</template>
