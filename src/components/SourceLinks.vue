<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { MaterialSearchHit } from '@repeaty/plugin-api'
import type { Source } from '../core/source-data'
import type { WikiContext } from '../core/material-search'
import { stableWikiLink } from '../core/wiki-links'
import type { MaterialKnowledge } from '../composables/material-knowledge'
import { UiButton } from './ui'
import { t } from '../i18n'
const props = defineProps<{
  source: Source
  knowledge: MaterialKnowledge
  target?: string
  busy?: boolean
}>()
const emit = defineEmits<{
  open: [hit: MaterialSearchHit]
  insert: [text: string]
  closePreview: []
}>()
const context = shallowRef<WikiContext>(),
  previews = shallowRef<MaterialSearchHit[]>([])
const expanded = ref(false),
  error = ref(''),
  loading = ref(false),
  copied = ref(false)
const previewCount = ref(0),
  previewPage = ref(1)
let sequence = 0,
  controller: AbortController | undefined
const count = computed(
  () => (context.value?.incoming.length ?? 0) + (context.value?.outgoing.length ?? 0),
)
function clear() {
  sequence++
  controller?.abort()
  context.value = undefined
  previews.value = []
  previewCount.value = 0
  loading.value = false
  error.value = ''
  copied.value = false
}
async function load(more = false) {
  previewPage.value = more === true ? previewPage.value + 1 : 1
  clear()
  const current = sequence
  controller = new AbortController()
  loading.value = true
  try {
    if (props.target) {
      const matches = props.knowledge.resolve(props.target)
      previewCount.value = matches.length
      const found = await Promise.all(
        matches
          .slice(0, previewPage.value * 20)
          .map((source) => props.knowledge.preview(source.id, { signal: controller!.signal })),
      )
      if (current === sequence)
        previews.value = found.filter((item): item is MaterialSearchHit => !!item)
    }
    if (expanded.value || !props.target) {
      const value = await props.knowledge.context(props.source.id, { signal: controller.signal })
      if (current === sequence) context.value = value
    }
  } catch (issue) {
    if (current === sequence && !(issue instanceof DOMException && issue.name === 'AbortError'))
      error.value = t(issue as Error)
  } finally {
    if (current === sequence) loading.value = false
  }
}
watch(
  [() => props.source.id, () => props.source.mediaId, () => props.knowledge, () => props.target],
  () => {
    clear()
    if (expanded.value || props.target) void load()
  },
  { immediate: true },
)
onScopeDispose(clear)
async function copyLink() {
  try {
    await navigator.clipboard.writeText(stableWikiLink(props.source))
    copied.value = true
  } catch {
    error.value = t('无法访问剪贴板，请选择下方链接后复制。')
  }
}
function toggle(event: Event) {
  expanded.value = (event.target as HTMLDetailsElement).open
  if (expanded.value || props.target) void load()
  else clear()
}
</script>
<template>
  <aside class="source-links" :aria-label="t('关联材料')">
    <section v-if="target" class="wiki-preview" :aria-label="t('链接预览')">
      <div class="wiki-preview-heading">
        <strong>{{ target.startsWith('source:') ? t('链接预览') : target }}</strong
        ><UiButton icon variant="ghost" :aria-label="t('关闭预览')" @click="emit('closePreview')"
          >×</UiButton
        >
      </div>
      <p v-if="!loading && !previews.length && !error" class="form-note">
        {{ t('链接目标不存在或已移除。原链接保留，恢复材料后可再次打开。') }}
      </p>
      <p v-if="previews.length > 1" class="form-note">
        {{ t('有多个同名材料，请选择要打开的一项。') }}
      </p>
      <ul class="wiki-results">
        <li v-for="hit in previews" :key="hit.sourceId">
          <UiButton variant="ghost" class="wiki-result" :disabled="busy" @click="emit('open', hit)"
            ><strong>{{ hit.title }}</strong
            ><span class="form-note">{{ hit.snippet }}</span
            ><span v-if="previews.length > 1" class="form-note">{{ hit.sourceId }}</span></UiButton
          >
        </li>
      </ul>
      <UiButton
        v-if="previews.length < previewCount"
        variant="ghost"
        :disabled="loading"
        @click="load(true)"
        >{{ t('加载更多') }}</UiButton
      >
    </section>
    <details @toggle="toggle">
      <summary>
        {{ t('链接与反向链接') }}<span v-if="context"> · {{ count }}</span>
      </summary>
      <div class="wiki-link-actions">
        <UiButton variant="ghost" @click="copyLink">{{
          t(copied ? '已复制链接' : '复制稳定链接')
        }}</UiButton>
        <UiButton variant="ghost" :disabled="loading" @click="load()">{{ t('刷新') }}</UiButton>
      </div>
      <code class="stable-wiki-link" tabindex="0">{{ stableWikiLink(source) }}</code>
      <template v-if="context">
        <h4>{{ t('引用的材料') }}</h4>
        <p v-if="!context.outgoing.length" class="form-note">{{ t('正文中还没有 Wiki 链接。') }}</p>
        <ul class="wiki-results">
          <li v-for="entry in context.outgoing" :key="entry.link.start">
            <span v-if="!entry.candidates.length" class="form-note"
              >{{ entry.link.label }} · {{ t('目标不可用') }}</span
            >
            <p v-if="entry.candidates.length > 1" class="form-note">
              {{ entry.link.label }} · {{ t('同名材料') }}
            </p>
            <UiButton
              v-for="hit in entry.candidates"
              :key="hit.sourceId"
              class="wiki-result"
              variant="ghost"
              :disabled="busy"
              @click="emit('open', hit)"
              ><strong>{{ hit.title }}</strong
              ><span class="form-note">{{ hit.snippet }}</span></UiButton
            >
          </li>
        </ul>
        <h4>{{ t('引用此处') }}</h4>
        <p v-if="!context.incoming.length" class="form-note">{{ t('还没有材料链接到这里。') }}</p>
        <ul class="wiki-results">
          <li v-for="(entry, index) in context.incoming" :key="`${entry.source.sourceId}:${index}`">
            <UiButton
              class="wiki-result"
              variant="ghost"
              :disabled="busy"
              @click="emit('open', entry.source)"
              ><strong>{{ entry.source.title }}</strong
              ><span v-if="entry.ambiguous" class="form-note">{{ t('标题链接有多个候选') }}</span
              ><span class="form-note">{{ entry.source.snippet }}</span></UiButton
            >
          </li>
        </ul>
      </template>
    </details>
    <p v-if="loading" role="status" class="form-note">{{ t('正在读取关联材料…') }}</p>
    <p v-if="error" role="alert" class="form-note">{{ error }}</p>
  </aside>
</template>
<style scoped>
.source-links {
  min-width: 0;
  font-size: var(--text-body-size, 0.875rem);
}
.source-links summary {
  cursor: pointer;
  padding-block: 0.75rem;
  font-weight: 600;
}
.wiki-preview-heading,
.wiki-link-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.wiki-results {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0;
}
.wiki-results li + li {
  border-top: 1px solid var(--ui-border);
}
.wiki-result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  text-align: left;
  white-space: normal;
  padding-block: 0.65rem;
}
.wiki-result .form-note {
  margin: 0;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.stable-wiki-link {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0.5rem;
  background: var(--ui-bg-muted);
  border-radius: 0.5rem;
  user-select: all;
}
.source-links h4 {
  margin: 1rem 0 0.3rem;
  font-size: inherit;
}
.wiki-preview {
  border-bottom: 1px solid var(--ui-border);
  padding-bottom: 0.75rem;
}
</style>
