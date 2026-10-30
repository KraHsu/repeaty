<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Archive, ArrowRight, Inbox, RotateCcw } from '@lucide/vue'
import type { CollectionHostApi } from '@repeaty/plugin-api'
import type { Source, SourceExcerpt } from '../core/source-data'
import type { MaterialLocator } from '../core/material-data'
import { sourceExcerpt } from '../core/sources'
import { t, locale } from '../i18n'
import { UiButton, UiInput } from './ui'
import AppModal from './AppModal.vue'
import SourceReader from './SourceReader.vue'

const props = defineProps<{
  api: CollectionHostApi
  scope: string
  sources: Source[]
  busy?: boolean
  read: (id: string, signal?: AbortSignal, mediaId?: string) => Promise<string>
  getMedia?: (id: string) => Promise<Blob | undefined>
}>()
const emit = defineEmits<{
  collect: []
  filed: [id: string]
  create: [excerpt: SourceExcerpt, format: 'plain' | 'markdown']
}>()
const view = ref<'new' | 'archived'>('new'),
  query = ref(''),
  selectedId = ref(''),
  text = ref(''),
  loading = ref(false),
  saving = ref(false),
  error = ref('')
const excerpt = shallowRef<SourceExcerpt>()
const draft = ref<{ id: string; title: string; url: string; revision: number }>()
const entries = computed(() =>
  props.sources
    .filter(
      (source) =>
        source.inbox?.state === view.value &&
        (!query.value.trim() ||
          source.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())),
    )
    .sort((a, b) => b.inbox!.capturedAt.localeCompare(a.inbox!.capturedAt)),
)
const selected = computed(() => entries.value.find((source) => source.id === selectedId.value))
const newCount = computed(
  () => props.sources.filter((source) => source.inbox?.state === 'new').length,
)
const archivedCount = computed(
  () => props.sources.filter((source) => source.inbox?.state === 'archived').length,
)
const kindLabel = {
  text: '文字',
  file: '文件',
  clipboard: '剪贴板',
  global: '快捷收集',
  connector: '连接来源',
} as const
let controller: AbortController | undefined,
  alive = true,
  generation = 0
watch(
  entries,
  (sources) => {
    if (!sources.some((source) => source.id === selectedId.value))
      selectedId.value = sources[0]?.id ?? ''
  },
  { immediate: true },
)
watch(
  [() => selected.value?.id, () => selected.value?.mediaId, () => props.scope],
  async () => {
    controller?.abort()
    controller = new AbortController()
    const current = ++generation,
      source = selected.value,
      signal = controller.signal
    text.value = error.value = ''
    excerpt.value = undefined
    draft.value = undefined
    loading.value = !!source
    if (!source) return
    try {
      const body = await props.read(source.id, signal, source.mediaId)
      if (alive && current === generation && !signal.aborted) text.value = body
    } catch (issue) {
      if (alive && current === generation && !signal.aborted) error.value = t(issue as Error)
    } finally {
      if (alive && current === generation) loading.value = false
    }
  },
  { immediate: true },
)
watch(
  () => props.scope,
  () => {
    query.value = ''
    view.value = 'new'
    draft.value = undefined
  },
  { flush: 'sync' },
)
onUnmounted(() => {
  alive = false
  controller?.abort()
  generation++
})
function select(sourceId: string, start: number, end: number, locator?: MaterialLocator) {
  if (!selected.value || selected.value.id !== sourceId) return
  try {
    excerpt.value = sourceExcerpt(selected.value, text.value, start, end)
    if (locator) excerpt.value.locator = locator
  } catch {
    excerpt.value = undefined
  }
}
function organize() {
  const source = selected.value
  if (!source || props.busy || saving.value) return
  draft.value = {
    id: source.id,
    title: source.title,
    url: source.url,
    revision: props.api.snapshot().revision,
  }
  error.value = ''
}
async function update(action: 'file' | 'archive' | 'restore') {
  const source = selected.value,
    pending = draft.value,
    scope = props.scope
  if (!source || props.busy || saving.value) return
  if (action === 'file' && (!pending || pending.id !== source.id || !pending.title.trim())) return
  const revision = pending?.revision ?? props.api.snapshot().revision
  saving.value = true
  error.value = ''
  try {
    await props.api.organizeInbox({
      sourceId: source.id,
      action,
      expectedRevision: revision,
      operationId: crypto.randomUUID(),
      ...(action === 'file' && pending ? { title: pending.title, url: pending.url } : {}),
    })
    if (!alive || scope !== props.scope) return
    draft.value = undefined
    if (action === 'file') emit('filed', source.id)
  } catch (issue) {
    if (alive && scope === props.scope) error.value = t(issue as Error)
  } finally {
    if (alive) saving.value = false
  }
}
</script>

<template>
  <section class="inbox-panel" :aria-label="t('收件箱')">
    <div class="inbox-toolbar">
      <div class="inbox-filters" :aria-label="t('收集状态')">
        <UiButton variant="ghost" :aria-pressed="view === 'new'" @click="view = 'new'"
          >{{ t('待整理') }} <span>{{ newCount }}</span></UiButton
        >
        <UiButton variant="ghost" :aria-pressed="view === 'archived'" @click="view = 'archived'"
          >{{ t('已归档') }} <span>{{ archivedCount }}</span></UiButton
        >
      </div>
      <UiInput
        v-model="query"
        type="search"
        :placeholder="t('搜索收集内容')"
        :aria-label="t('搜索收集内容')"
      />
    </div>
    <p v-if="error && !draft" role="alert" class="import-warning">{{ error }}</p>
    <div v-if="!entries.length" class="inbox-empty">
      <Inbox :size="32" aria-hidden="true" />
      <h2>
        {{
          t(
            query
              ? '没有找到匹配的材料'
              : view === 'archived'
                ? '还没有归档内容'
                : '先收集，稍后整理',
          )
        }}
      </h2>
      <p>
        {{
          t(
            query
              ? '试试其他标题关键词。'
              : view === 'archived'
                ? '归档后仍保留原文、卡片和学习记录。'
                : '文件、剪贴板和快捷收集的内容都会保存在这里。',
          )
        }}
      </p>
      <UiButton v-if="!query && view === 'new'" variant="secondary" @click="emit('collect')">{{
        t('收集材料')
      }}</UiButton>
    </div>
    <div v-else class="inbox-layout">
      <nav class="inbox-list" :aria-label="t('收集内容')">
        <UiButton
          v-for="source in entries"
          :key="source.id"
          variant="ghost"
          :class="{ selected: source.id === selectedId }"
          :aria-pressed="source.id === selectedId"
          :disabled="saving"
          @click="selectedId = source.id"
        >
          <strong>{{ source.title }}</strong>
          <span
            >{{ t(kindLabel[source.inbox!.kind]) }} ·
            {{ new Date(source.inbox!.capturedAt).toLocaleDateString(locale) }}</span
          >
          <span v-if="source.inbox?.name" class="inbox-source-name">{{ source.inbox.name }}</span>
        </UiButton>
      </nav>
      <article v-if="selected" class="inbox-content">
        <header class="inbox-content-header">
          <div>
            <h2>{{ selected.title }}</h2>
            <a v-if="selected.url" :href="selected.url" target="_blank" rel="noopener noreferrer">{{
              selected.url
            }}</a>
          </div>
          <div class="inbox-actions">
            <UiButton
              v-if="view === 'new'"
              variant="ghost"
              :disabled="busy || saving"
              @click="update('archive')"
              ><Archive :size="16" />{{ t('归档') }}</UiButton
            >
            <UiButton
              v-else
              variant="secondary"
              :disabled="busy || saving"
              @click="update('restore')"
              ><RotateCcw :size="16" />{{ t('恢复到收件箱') }}</UiButton
            >
            <UiButton variant="primary" :disabled="busy || saving" @click="organize"
              >{{ t('整理到阅读材料') }}<ArrowRight :size="16"
            /></UiButton>
          </div>
        </header>
        <p v-if="loading" role="status">{{ t('正在读取原文…') }}</p>
        <SourceReader
          v-else-if="text"
          :key="`${scope}:${selected.id}:${selected.mediaId}`"
          :source="selected"
          :sources="sources"
          :text="text"
          :scope="scope"
          :get-media="getMedia"
          :busy="busy || saving"
          read-only
          @select="select"
        />
        <footer class="inbox-content-footer">
          <span>{{ t('选取原文中的一段内容，即可制作卡片。') }}</span
          ><UiButton
            variant="secondary"
            :disabled="!excerpt || busy || saving || loading"
            @click="excerpt && emit('create', excerpt, selected.format)"
            >{{ t('从选区制卡') }}</UiButton
          >
        </footer>
      </article>
    </div>
    <AppModal
      v-if="draft"
      :title="t('整理到阅读材料')"
      :busy="saving"
      :error="error"
      @close="draft = undefined"
    >
      <form class="inbox-organize" @submit.prevent="update('file')">
        <label for="inbox-title">{{ t('材料标题') }}</label
        ><UiInput
          id="inbox-title"
          :model-value="draft?.title ?? ''"
          @update:model-value="
            (value: string) => {
              if (draft) draft.title = value
            }
          "
          maxlength="160"
          required
          :disabled="saving"
        />
        <label for="inbox-url">{{ t('来源链接（可选）') }}</label
        ><UiInput
          id="inbox-url"
          :model-value="draft?.url ?? ''"
          @update:model-value="
            (value: string) => {
              if (draft) draft.url = value
            }
          "
          type="url"
          maxlength="2048"
          placeholder="https://"
          :disabled="saving"
        />
        <p class="form-note">{{ t('进入待阅读队列，原文和已制作的卡片保持关联。') }}</p>
        <div class="form-actions">
          <UiButton :disabled="saving" @click="draft = undefined">{{ t('取消') }}</UiButton
          ><UiButton
            variant="primary"
            type="submit"
            :busy="saving"
            :disabled="!draft?.title.trim() || busy"
            >{{ t('移入阅读材料') }}</UiButton
          >
        </div>
      </form>
    </AppModal>
  </section>
</template>

<style scoped>
.inbox-panel {
  display: grid;
  gap: 1.25rem;
}
.inbox-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}
.inbox-toolbar > :last-child {
  flex: 0 1 20rem;
  width: 20rem;
  max-width: 100%;
  min-width: 0;
}
.inbox-filters,
.inbox-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.inbox-filters [aria-pressed='true'] {
  background: var(--app-selected);
}
.inbox-filters span {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.inbox-layout {
  display: grid;
  grid-template-columns: minmax(13rem, 18rem) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.inbox-list {
  display: grid;
  align-content: start;
  max-height: 36rem;
  overflow: auto;
}
.inbox-list > button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 0.35rem;
  border-radius: 0;
  padding: 1rem 0.75rem;
  border-bottom: 1px solid var(--line);
  white-space: normal;
}
.inbox-list > button.selected {
  background: var(--app-selected);
}
.inbox-list > button > span {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.inbox-list strong,
.inbox-source-name {
  overflow-wrap: anywhere;
}
.inbox-content {
  min-width: 0;
}
.inbox-content-header {
  display: grid;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--line);
  margin-bottom: 1rem;
}
.inbox-content-header h2 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--font-size-section);
}
.inbox-content-header a {
  display: inline-block;
  margin-top: 0.5rem;
  font-size: var(--font-size-meta);
  overflow-wrap: anywhere;
}
.inbox-actions {
  justify-content: flex-end;
}
.inbox-content-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.inbox-content-footer > span {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.inbox-empty {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  padding: 4rem 1rem;
  text-align: center;
  color: var(--muted);
}
.inbox-empty h2,
.inbox-empty p {
  margin: 0;
}
.inbox-empty h2 {
  color: var(--ui-text);
  font-size: var(--font-size-section);
}
.inbox-organize {
  display: grid;
  gap: 0.75rem;
}
@media (max-width: 760px) {
  .inbox-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .inbox-list {
    max-height: 16rem;
  }
  .inbox-content-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
