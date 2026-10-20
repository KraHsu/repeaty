<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { t, locale, type DisplayMessage } from '../i18n'
import type { Source, SourceExcerpt } from '../core/source-data'
import AppModal from './AppModal.vue'
import CardContent from './CardContent.vue'

const props = defineProps<{
  source: Source
  origin?: Source
  excerpt?: SourceExcerpt
  read: (id: string, signal?: AbortSignal) => Promise<string>
}>()
const emit = defineEmits<{ close: [] }>()
const originOpen = ref(false)
const original = computed(() =>
  props.origin?.id === props.source.origin?.sourceId ? props.origin : undefined,
)
const shown = computed(() => (originOpen.value && original.value ? original.value : props.source))
const selected = computed(() => {
  const anchor = props.source.origin,
    excerpt = props.excerpt
  if (!originOpen.value || !original.value || !anchor || !excerpt) return excerpt
  return {
    sourceId: original.value.id,
    start: anchor.start + excerpt.start,
    end: anchor.start + excerpt.end,
    quote: excerpt.quote,
  }
})
watch(
  () => props.source.id,
  () => {
    originOpen.value = false
  },
)
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
  preview.value = false
  error.value = ''
  text.value = ''
  try {
    text.value = await props.read(shown.value.id, current.signal)
  } catch (issue) {
    if (!current.signal.aborted) error.value = issue as Error
  } finally {
    if (controller === current) loading.value = false
  }
}
watch([() => shown.value.id, () => shown.value.mediaId], load, { immediate: true })
onUnmounted(() => controller?.abort())
watch([text, preview, selected], async () => {
  await nextTick()
  highlight.value?.scrollIntoView({ block: 'center' })
})
const matches = computed(
  () =>
    !!selected.value &&
    text.value.slice(selected.value.start, selected.value.end) === selected.value.quote,
)
</script>

<template>
  <AppModal wide :title="shown.title" @close="emit('close')">
    <div class="source-context">
      <button
        v-if="original"
        type="button"
        class="text-button source-origin-toggle"
        :aria-pressed="originOpen"
        @click="originOpen = !originOpen"
      >
        {{ t(originOpen ? '返回摘录' : '查看出处') }}
      </button>
      <p class="form-note">
        {{ t('保存于 {date}', { date: new Date(shown.createdAt).toLocaleString(locale) }) }}
      </p>
      <a
        v-if="shown.url"
        class="source-url"
        :href="shown.url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ shown.url }}</a
      >
      <p v-if="loading" role="status">{{ t('正在读取原文…') }}</p>
      <template v-else-if="error"
        ><p class="import-warning" role="alert">{{ t(error) }}</p>
        <button type="button" class="button secondary" @click="load">
          {{ t('重试') }}
        </button></template
      >
      <template v-else>
        <p v-if="selected && !matches" class="import-warning" role="alert">
          {{ t('摘录与原文不一致，请从备份恢复。') }}
        </p>
        <blockquote v-if="selected" class="source-quote">{{ selected.quote }}</blockquote>
        <button
          v-if="shown.format === 'markdown'"
          type="button"
          class="text-button"
          :aria-pressed="preview"
          @click="preview = !preview"
        >
          {{ t(preview ? '显示原文与摘录位置' : '阅读 Markdown 预览') }}
        </button>
        <CardContent v-if="preview" :text="text" format="markdown" />
        <div v-else class="source-original" tabindex="0" :aria-label="t('原文快照')">
          <template v-if="selected && matches"
            >{{ text.slice(0, selected.start)
            }}<mark ref="highlight">{{ text.slice(selected.start, selected.end) }}</mark
            >{{ text.slice(selected.end) }}</template
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
.source-origin-toggle {
  justify-self: start;
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
