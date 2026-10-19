<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { t, locale, type DisplayMessage } from '../i18n'
import type { Source, SourceExcerpt } from '../core/source-data'
import AppModal from './AppModal.vue'
import CardContent from './CardContent.vue'

const props = defineProps<{
  source: Source
  excerpt?: SourceExcerpt
  read: (id: string, signal?: AbortSignal) => Promise<string>
}>()
const emit = defineEmits<{ close: [] }>()
const highlight = ref<HTMLElement>()
const text = ref(''),
  error = ref<DisplayMessage>(''),
  loading = ref(true),
  preview = ref(false)
let controller: AbortController | undefined
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  text.value = ''
  try {
    text.value = await props.read(props.source.id, current.signal)
  } catch (issue) {
    if (!current.signal.aborted) error.value = issue as Error
  } finally {
    if (controller === current) loading.value = false
  }
}
watch(() => props.source.mediaId, load, { immediate: true })
onUnmounted(() => controller?.abort())
watch([text, preview], async () => {
  await nextTick()
  highlight.value?.scrollIntoView({ block: 'center' })
})
const matches = computed(
  () =>
    !!props.excerpt &&
    text.value.slice(props.excerpt.start, props.excerpt.end) === props.excerpt.quote,
)
</script>

<template>
  <AppModal wide :title="source.title" @close="emit('close')">
    <div class="source-context">
      <p class="form-note">
        {{ t('保存于 {date}', { date: new Date(source.createdAt).toLocaleString(locale) }) }}
      </p>
      <a
        v-if="source.url"
        class="source-url"
        :href="source.url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ source.url }}</a
      >
      <p v-if="loading" role="status">{{ t('正在读取原文…') }}</p>
      <template v-else-if="error"
        ><p class="import-warning" role="alert">{{ t(error) }}</p>
        <button type="button" class="button secondary" @click="load">
          {{ t('重试') }}
        </button></template
      >
      <template v-else>
        <p v-if="excerpt && !matches" class="import-warning" role="alert">
          {{ t('摘录与原文不一致，请从备份恢复。') }}
        </p>
        <blockquote v-if="excerpt" class="source-quote">{{ excerpt.quote }}</blockquote>
        <button
          v-if="source.format === 'markdown'"
          type="button"
          class="text-button"
          :aria-pressed="preview"
          @click="preview = !preview"
        >
          {{ t(preview ? '显示原文与摘录位置' : '阅读 Markdown 预览') }}
        </button>
        <CardContent v-if="preview" :text="text" format="markdown" />
        <div v-else class="source-original" tabindex="0" :aria-label="t('原文快照')">
          <template v-if="excerpt && matches"
            >{{ text.slice(0, excerpt.start)
            }}<mark ref="highlight">{{ text.slice(excerpt.start, excerpt.end) }}</mark
            >{{ text.slice(excerpt.end) }}</template
          ><template v-else>{{ text }}</template>
        </div>
      </template>
      <div class="form-actions">
        <button type="button" class="button secondary" @click="emit('close')">
          {{ t('关闭') }}
        </button>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.source-context {
  text-align: left;
  display: grid;
  gap: 1rem;
  padding: 1.3rem 1.75rem;
  min-width: 0;
  overflow-y: auto;
}
.source-context > * {
  min-width: 0;
  margin: 0;
}
.source-url {
  overflow-wrap: anywhere;
}
.source-quote {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 1rem;
  border-left: 3px solid #66896b;
  background: #f4f7ef;
}
.source-original {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.source-original mark {
  background: #f2df9b;
  color: inherit;
  border-radius: 2px;
}
.source-context :deep(.card-content) {
  font-size: 1rem;
}
@media (max-width: 720px) {
  .source-context {
    padding: 1.1rem;
  }
}
</style>
