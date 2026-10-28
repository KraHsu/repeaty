<script setup lang="ts">
import { UiButton } from './ui'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { t, locale, type DisplayMessage } from '../i18n'
import type { Source, SourceExcerpt } from '../core/source-data'
import { sourceContextPath } from '../core/source-tree'
import AppModal from './AppModal.vue'
import CardContent from './CardContent.vue'

const props = defineProps<{
  source: Source
  origin?: Source
  sources?: Source[]
  excerpt?: SourceExcerpt
  getMedia?: (id: string) => Promise<Blob | undefined>
  read: (id: string, signal?: AbortSignal, mediaId?: string) => Promise<string>
}>()
const emit = defineEmits<{ close: [] }>()
const level = ref(0)
const path = computed(() =>
  sourceContextPath(
    props.sources ?? [props.source, ...(props.origin ? [props.origin] : [])],
    props.source,
    props.excerpt,
  ),
)
const current = computed(() => path.value[Math.min(level.value, path.value.length - 1)]!)
const shown = computed(() => current.value.source)
const selected = computed(() => current.value.excerpt)
watch([() => props.source.id, () => props.source.mediaId], () => {
  level.value = 0
})
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
    const body = await props.read(shown.value.id, current.signal, shown.value.mediaId)
    if (!current.signal.aborted) text.value = body
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
      <nav v-if="path.length > 2" class="source-context-path" :aria-label="t('出处路径')">
        <UiButton
          variant="ghost"
          v-for="(entry, index) in [...path].reverse()"
          :key="entry.source.id"
          type="button"
          :aria-current="entry.source.id === shown.id ? 'page' : undefined"
          @click="level = path.length - 1 - index"
        >
          {{ entry.source.title }}
        </UiButton>
      </nav>
      <div v-if="path.length > 1" class="source-context-navigation">
        <UiButton variant="ghost" v-if="level < path.length - 1" type="button" @click="level++">
          {{ t('查看出处') }}
        </UiButton>
        <UiButton variant="ghost" v-if="level > 0" type="button" @click="level = 0">
          {{ t('返回摘录') }}
        </UiButton>
      </div>
      <p class="form-note">
        {{
          t('保存于 {date}', {
            date: new Date(shown.acceptedAt ?? shown.createdAt).toLocaleString(locale),
          })
        }}
      </p>
      <p
        v-if="sources?.some((source) => source.id === shown.id && source.mediaId !== shown.mediaId)"
        class="form-note"
      >
        {{ t('正在查看摘录保存时的版本。') }}
      </p>
      <p v-if="shown.derived" class="form-note">
        {{ t('这篇摘录已经编辑，出处保留最初摘录的原文。') }}
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
        <UiButton variant="secondary" type="button" @click="load">
          {{ t('重试') }}
        </UiButton></template
      >
      <template v-else>
        <p v-if="selected && !matches" class="import-warning" role="alert">
          {{ t('摘录与原文不一致，请从备份恢复。') }}
        </p>
        <blockquote v-if="selected" class="source-quote">{{ selected.quote }}</blockquote>
        <UiButton
          variant="ghost"
          v-if="shown.format === 'markdown'"
          type="button"
          :aria-pressed="preview"
          @click="preview = !preview"
        >
          {{ t(preview ? '显示原文与摘录位置' : '阅读 Markdown 预览') }}
        </UiButton>
        <CardContent
          v-if="preview"
          :text="text"
          format="markdown"
          :inline-media="shown.inlineMedia"
          :get-media="getMedia"
        />
        <div v-else class="source-original" tabindex="0" :aria-label="t('原文快照')">
          <template v-if="selected && matches"
            >{{ text.slice(0, selected.start)
            }}<mark ref="highlight">{{ text.slice(selected.start, selected.end) }}</mark
            >{{ text.slice(selected.end) }}</template
          ><template v-else>{{ text }}</template>
        </div>
      </template>
      <div class="form-actions">
        <UiButton variant="secondary" type="button" @click="emit('close')">
          {{ t('关闭') }}
        </UiButton>
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
.source-context-path,
.source-context-navigation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}
.source-context-path {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #dfe5d8;
}
.source-context-path button {
  overflow-wrap: anywhere;
  text-align: left;
}
.source-context-path [aria-current] {
  font-weight: var(--font-weight-semibold);
  color: #35573c;
}
.source-context > * {
  min-width: 0;
  margin: 0;
}
.source-url {
  overflow-wrap: anywhere;
}
.source-quote {
  font-size: var(--font-size-reading);
  line-height: var(--line-height-reading);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 1rem;
  border-left: 3px solid #66896b;
  background: #f4f7ef;
}
.source-original {
  font-size: var(--font-size-reading);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: var(--line-height-reading);
}
.source-original mark {
  background: #f2df9b;
  color: inherit;
  border-radius: 2px;
}
.source-context :deep(.card-content) {
  font-size: var(--font-size-reading);
}
@media (max-width: 720px) {
  .source-context {
    padding: 1.1rem;
  }
}
</style>
