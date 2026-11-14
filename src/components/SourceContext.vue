<script setup lang="ts">
import { UiButton } from './ui'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { MaterialSelection } from '@repeaty/plugin-api'
import { t, locale, type DisplayMessage } from '../i18n'
import type { Source, SourceExcerpt } from '../core/source-data'
import type { MaterialLocator } from '../core/material-data'
import { sourceContextPath } from '../core/source-tree'
import AppModal from './AppModal.vue'
import CardContent from './CardContent.vue'
import SourceReader from './SourceReader.vue'

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
const linkedSource = ref<Source>()
const shown = computed(() => linkedSource.value ?? current.value.source)
const selected = computed(() => (linkedSource.value ? undefined : current.value.excerpt))
watch([() => props.source.id, () => props.source.mediaId], () => {
  level.value = 0
  linkedSource.value = undefined
})
function openLinkedSource(id: string, locator?: MaterialLocator) {
  const source = props.sources?.find((source) => source.id === id)
  linkedSource.value =
    source && locator?.kind === 'text'
      ? {
          ...source,
          reading: {
            offset: locator.start,
            fraction: 0,
            view: 'preview',
            locator,
            updatedAt: new Date().toISOString(),
          },
        }
      : source
}
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
const initialSelection = computed<MaterialSelection | undefined>(() => {
  const excerpt = selected.value
  if (!excerpt || !matches.value) return
  return {
    locator: excerpt.locator ?? {
      schemaVersion: 1,
      kind: 'text',
      sourceId: shown.value.id,
      versionId: shown.value.mediaId,
      start: excerpt.start,
      end: excerpt.end,
      quote: excerpt.quote,
    },
    text: excerpt.quote,
    projection: { start: excerpt.start, end: excerpt.end },
  }
})
</script>

<template>
  <AppModal wide :title="shown.title" @close="emit('close')">
    <div class="source-context">
      <UiButton v-if="linkedSource" variant="ghost" @click="linkedSource = undefined">{{
        t('返回摘录')
      }}</UiButton>
      <nav
        v-if="!linkedSource && path.length > 2"
        class="source-context-path"
        :aria-label="t('出处路径')"
      >
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
      <div v-if="!linkedSource && path.length > 1" class="source-context-navigation">
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
        <SourceReader
          v-if="(shown.document || selected?.locator?.kind === 'formula') && (!selected || matches)"
          :key="shown.id + ':' + shown.mediaId"
          :source="shown"
          :sources="sources"
          :text="text"
          scope="readonly-source-context"
          :get-media="getMedia"
          read-only
          @open="openLinkedSource"
          :initial-selection="initialSelection"
        />
        <UiButton
          variant="ghost"
          v-if="
            !shown.document && selected?.locator?.kind !== 'formula' && shown.format === 'markdown'
          "
          type="button"
          :aria-pressed="preview"
          @click="preview = !preview"
        >
          {{ t(preview ? '显示原文与摘录位置' : '阅读 Markdown 预览') }}
        </UiButton>
        <CardContent
          v-if="preview && !shown.document && selected?.locator?.kind !== 'formula'"
          :text="text"
          format="markdown"
          :inline-media="shown.inlineMedia"
          :get-media="getMedia"
          :source="shown"
          :sources="sources"
          :open-source="openLinkedSource"
        />
        <div
          v-else-if="
            (!shown.document && selected?.locator?.kind !== 'formula') || (selected && !matches)
          "
          class="source-original"
          tabindex="0"
          :aria-label="t('原文快照')"
        >
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
  border-bottom: 1px solid var(--ui-border);
}
.source-context-path button {
  overflow-wrap: anywhere;
  text-align: left;
}
.source-context-path [aria-current] {
  font-weight: var(--font-weight-semibold);
  color: var(--green);
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
  border-left: 3px solid var(--green);
  background: var(--ui-bg-muted);
}
.source-original {
  font-size: var(--font-size-reading);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: var(--line-height-reading);
}
.source-original mark {
  background: color-mix(in srgb, var(--ui-warning) 25%, var(--ui-bg));
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
