<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../core/content'
import { useInlineMedia } from '../composables/useInlineMedia'
import type { InlineMedia } from '../core/inline-media'
import { t } from '../i18n'
import type { Source } from '../core/source-data'
import type { MaterialLocator } from '../core/material-data'
import { useSourceContentLinks } from '../composables/useSourceContentLinks'
const props = defineProps<{
  text: string
  format: 'plain' | 'markdown'
  inlineMedia?: InlineMedia
  getMedia?: (id: string) => Promise<Blob | undefined>
  source?: Source
  sources?: Source[]
  scope?: string
  openSource?: (id: string, locator?: MaterialLocator) => void
}>()
const contentLinks = useSourceContentLinks(() => ({
  source: props.source,
  sources: props.sources,
  text: props.text,
  scope: props.scope,
  read: props.getMedia,
  open: props.openSource,
}))
const media = useInlineMedia(() => ({
  text: props.text,
  media:
    props.format === 'markdown'
      ? [
          ...(props.inlineMedia ?? []),
          ...[...contentLinks.targets.value.resources].map(([url, resource]) => ({
            url,
            mediaId: resource.mediaId,
          })),
        ]
      : undefined,
  read: props.getMedia,
}))
const html = computed(() =>
  props.format === 'markdown'
    ? renderMarkdown(props.text, media.urls.value, {
        sourceLinks: new Set(contentLinks.targets.value.links.keys()),
        resourceLinks: new Set(contentLinks.targets.value.resources.keys()),
      })
    : '',
)
function openContent(event: MouseEvent | KeyboardEvent) {
  const root = event.currentTarget as HTMLElement | null
  const target = (event.target as Element | null)?.closest<HTMLElement>(
    '[data-source-reference], [data-source-resource]',
  )
  if (
    !target ||
    !root?.contains(target) ||
    (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key))
  )
    return
  event.preventDefault()
  event.stopPropagation()
  void contentLinks.activate(target.dataset.sourceReference, target.dataset.sourceResource)
}
const paragraphs = computed(() => props.text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/))
</script>
<template>
  <div
    v-if="format === 'markdown'"
    class="card-content markdown-content"
    @click="openContent"
    @keydown="openContent"
    v-html="html"
  />
  <div v-else class="card-content plain-content">
    <p v-for="(paragraph, index) in paragraphs" :key="index" class="plain-paragraph">
      {{ paragraph }}
    </p>
  </div>
  <p v-if="media.error.value" role="alert" class="form-note">
    {{ t('部分媒体无法读取，请从完整备份恢复。') }}
  </p>
  <p v-if="contentLinks.error.value" role="alert" class="form-note">
    {{ t(contentLinks.error.value as Error) }}
  </p>
</template>
