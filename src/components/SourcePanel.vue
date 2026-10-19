<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { FileText, Plus, Upload } from '@lucide/vue'
import { t, locale, type DisplayMessage } from '../i18n'
import type { Library } from '../core/model'
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_CHARACTERS,
  type SourceInput,
  type SourceExcerpt,
} from '../core/source-data'
import { sourceExcerpt } from '../core/sources'
import { createExportFile } from '@repeaty-platform'
import AppModal from './AppModal.vue'
import CardContent from './CardContent.vue'

const props = defineProps<{
  library: Library
  busy: boolean
  scope: string
  actionError?: string
  read: (id: string, signal?: AbortSignal) => Promise<string>
  save: (input: SourceInput, scope: string) => Promise<boolean>
  remove: (id: string, scope: string) => Promise<boolean>
}>()
const emit = defineEmits<{
  create: [excerpt: SourceExcerpt, format: 'plain' | 'markdown']
  edit: [noteId: string]
  clearNotice: []
}>()
const selectedId = ref(props.library.sources.at(-1)?.id ?? '')
const source = computed(() => props.library.sources.find((entry) => entry.id === selectedId.value))
const linked = computed(() =>
  props.library.notes.filter((note) => note.excerpt?.sourceId === selectedId.value),
)
const text = ref(''),
  error = ref<DisplayMessage>(''),
  loading = ref(false),
  preview = ref(false),
  excerpt = ref<SourceExcerpt>()
const importing = ref(false),
  deleting = ref(false),
  exporting = ref(false),
  readingFile = ref(false),
  importError = ref<DisplayMessage>('')
const query = ref(''),
  page = ref(0)
const pageSize = 20
const filteredSources = computed(() =>
  props.library.sources
    .filter((entry) => entry.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))
    .slice()
    .reverse(),
)
const pages = computed(() => Math.max(1, Math.ceil(filteredSources.value.length / pageSize)))
const visibleSources = computed(() =>
  filteredSources.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
)
watch([query, () => props.library.sources], () => {
  page.value = 0
})
const form = reactive<SourceInput>({ title: '', url: '', format: 'markdown', content: '' })
const fileInput = ref<HTMLInputElement>(),
  reader = ref<HTMLTextAreaElement>()
let controller: AbortController | undefined,
  fileGeneration = 0
watch(
  () => props.library.sources,
  (sources) => {
    if (!sources.some((entry) => entry.id === selectedId.value))
      selectedId.value = sources.at(-1)?.id ?? ''
  },
)
watch(() => source.value?.mediaId, load, { immediate: true })
onUnmounted(() => {
  controller?.abort()
  fileGeneration++
})
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  text.value = ''
  excerpt.value = undefined
  preview.value = false
  error.value = ''
  if (!source.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    text.value = await props.read(source.value.id, current.signal)
  } catch (issue) {
    if (!current.signal.aborted) error.value = issue as Error
  } finally {
    if (controller === current) loading.value = false
  }
}
function select() {
  if (!source.value || !reader.value) return
  try {
    excerpt.value = sourceExcerpt(
      source.value,
      text.value,
      reader.value.selectionStart,
      reader.value.selectionEnd,
    )
  } catch {
    excerpt.value = undefined
  }
}
function openImport() {
  emit('clearNotice')
  fileGeneration++
  readingFile.value = false
  Object.assign(form, { title: '', url: '', format: 'markdown', content: '' })
  importError.value = ''
  importing.value = true
}
function openDelete() {
  emit('clearNotice')
  deleting.value = true
}
function closeImport() {
  importing.value = false
  fileGeneration++
  readingFile.value = false
}
async function fileChanged(event: Event) {
  const target = event.target as HTMLInputElement,
    file = target.files?.[0]
  target.value = ''
  if (!file) return
  const generation = ++fileGeneration
  readingFile.value = true
  importError.value = ''
  try {
    if (file.size > MAX_SOURCE_BYTES) throw new Error('文本或 Markdown 文件不能超过 1 MB。')
    if (!/\.(txt|md|markdown)$/i.test(file.name))
      throw new Error('请选择 UTF-8 的 .txt、.md 或 .markdown 文件。')
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    } catch {
      throw new Error('无法读取文件，请使用 UTF-8 编码。')
    }
    if (generation !== fileGeneration) return
    if (content.length > MAX_SOURCE_CHARACTERS || !content.trim())
      throw new Error('正文不能为空，且不能超过 250000 个字符。')
    form.content = content
    form.title = file.name.replace(/\.(txt|md|markdown)$/i, '').slice(0, 160)
    form.format = /\.(md|markdown)$/i.test(file.name) ? 'markdown' : 'plain'
  } catch (issue) {
    if (generation === fileGeneration) importError.value = issue as Error
  } finally {
    if (generation === fileGeneration) readingFile.value = false
  }
}
async function save() {
  if (props.busy || readingFile.value) return
  if (await props.save({ ...form }, props.scope)) {
    importing.value = false
    query.value = ''
    page.value = 0
    selectedId.value = props.library.sources.at(-1)?.id ?? ''
  }
}
async function remove() {
  if (source.value && (await props.remove(source.value.id, props.scope))) deleting.value = false
}
async function download() {
  if (!source.value || loading.value || exporting.value || error.value) return
  const current = source.value,
    body = text.value
  const filename = `repeaty-source-${current.id}.${current.format === 'markdown' ? 'md' : 'txt'}`
  exporting.value = true
  let writable: WritableStream<Uint8Array> | undefined
  try {
    const blob = new Blob([body], {
      type: current.format === 'markdown' ? 'text/markdown' : 'text/plain',
    })
    if (createExportFile) {
      writable = await createExportFile(filename)
      await blob.stream().pipeTo(writable)
    } else {
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  } catch (issue) {
    await writable?.abort().catch(() => {})
    if (!(issue instanceof DOMException && issue.name === 'AbortError'))
      error.value = issue as Error
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="page sources-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('学习材料') }}</h1>
        <p>{{ t('保存原文，选取摘录制作卡片。') }}</p>
      </div>
      <button class="button primary" :disabled="busy" @click="openImport">
        <Plus :size="18" />{{ t('导入材料') }}
      </button>
    </header>
    <div v-if="!library.sources.length" class="empty-state">
      <FileText :size="36" />
      <h2>{{ t('还没有学习材料') }}</h2>
      <p>{{ t('导入文本或 Markdown，也可以直接粘贴。原文会保存在当前学习库中。') }}</p>
    </div>
    <div v-else class="sources-layout">
      <aside class="source-list">
        <label class="sr-only" for="source-search">{{ t('搜索材料') }}</label
        ><input id="source-search" v-model="query" type="search" :placeholder="t('搜索材料')" />
        <p v-if="!visibleSources.length" class="form-note">{{ t('没有找到材料。') }}</p>
        <button
          v-for="entry in visibleSources"
          :key="entry.id"
          class="source-list-item"
          :class="{ selected: entry.id === selectedId }"
          :aria-pressed="entry.id === selectedId"
          @click="selectedId = entry.id"
        >
          <strong>{{ entry.title }}</strong
          ><span
            >{{ entry.format === 'markdown' ? 'Markdown' : t('纯文本') }} ·
            {{ new Date(entry.createdAt).toLocaleDateString(locale) }}</span
          >
        </button>
        <nav v-if="pages > 1" class="source-list-pages" :aria-label="t('材料列表分页')">
          <button type="button" class="text-button" :disabled="page === 0" @click="page--">
            {{ t('上一页') }}</button
          ><span>{{ page + 1 }} / {{ pages }}</span
          ><button type="button" class="text-button" :disabled="page + 1 >= pages" @click="page++">
            {{ t('下一页') }}
          </button>
        </nav>
      </aside>
      <section v-if="source" class="source-reader">
        <div class="source-reader-heading">
          <div>
            <h2>{{ source.title }}</h2>
            <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{
              source.url
            }}</a>
            <p class="form-note">
              {{ t('保存于 {date}', { date: new Date(source.createdAt).toLocaleString(locale) }) }}
            </p>
          </div>
          <div class="source-actions">
            <button
              class="button secondary"
              :disabled="loading || !!error || exporting"
              @click="download"
            >
              {{ t('导出原文') }}</button
            ><button class="text-button danger" :disabled="busy || exporting" @click="openDelete">
              {{ t('删除材料') }}
            </button>
          </div>
        </div>
        <p v-if="loading" role="status">{{ t('正在读取原文…') }}</p>
        <template v-else-if="error"
          ><p class="import-warning" role="alert">{{ t(error) }}</p>
          <button class="button secondary" @click="load">{{ t('重试') }}</button></template
        >
        <template v-else>
          <div class="source-selection-tools">
            <p class="form-note">
              {{ t('选中原文中的文字，再点击「用摘录制卡」。每次最多 10000 个字符。') }}
            </p>
            <button
              v-if="source.format === 'markdown'"
              class="text-button"
              :aria-pressed="preview"
              @click="preview = !preview"
            >
              {{ t(preview ? '返回原文选取摘录' : '阅读 Markdown 预览') }}
            </button>
          </div>
          <div v-if="preview" class="source-markdown-preview">
            <CardContent :text="text" format="markdown" />
          </div>
          <textarea
            v-else
            ref="reader"
            class="source-text"
            :value="text"
            readonly
            :aria-label="t('材料正文')"
            @select="select"
            @keyup="select"
            @mouseup="select"
            @touchend="select"
          />
          <div class="source-excerpt-action">
            <span>{{
              excerpt
                ? t('已选 {count} 个字符', { count: excerpt.quote.length })
                : t('尚未选取摘录')
            }}</span
            ><button
              class="button primary"
              :disabled="busy || !excerpt || !library.decks.length"
              @click="excerpt && emit('create', excerpt, source.format)"
            >
              {{ t('用摘录制卡') }}
            </button>
          </div>
          <p v-if="!library.decks.length" class="form-note">
            {{ t('请先新建一个卡组，再用摘录制卡。') }}
          </p>
          <details v-if="linked.length" class="source-linked">
            <summary>{{ t('关联笔记（{count}）', { count: linked.length }) }}</summary>
            <ul>
              <li v-for="note in linked" :key="note.id">
                <button class="text-button" @click="emit('edit', note.id)">
                  {{ note.front.slice(0, 120) }}
                </button>
              </li>
            </ul>
          </details>
        </template>
      </section>
    </div>
    <AppModal
      v-if="importing"
      wide
      :title="t('导入材料')"
      :busy="busy || readingFile"
      :error="actionError"
      @close="closeImport"
    >
      <form class="editor-form source-import-form" @submit.prevent="save">
        <p class="form-note">
          {{ t('支持 UTF-8 文本和 Markdown，文件最大 1 MB，正文最多 250000 个字符。') }}
        </p>
        <input
          id="source-file"
          ref="fileInput"
          class="sr-only"
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          :disabled="busy || readingFile"
          :aria-label="t('选择材料文件')"
          @change="fileChanged"
        /><button
          type="button"
          class="button attachment-button"
          :disabled="busy || readingFile"
          @click="fileInput?.click()"
        >
          <Upload :size="18" />{{ t('选择材料文件') }}</button
        ><label for="source-title">{{ t('材料标题') }}</label
        ><input
          id="source-title"
          v-model="form.title"
          required
          maxlength="160"
          :disabled="busy || readingFile"
        /><label for="source-url">{{ t('来源链接（可选）') }}</label
        ><input
          id="source-url"
          v-model="form.url"
          type="url"
          maxlength="2048"
          placeholder="https://"
          :disabled="busy || readingFile"
        /><label for="source-format">{{ t('内容格式') }}</label
        ><select id="source-format" v-model="form.format" :disabled="busy || readingFile">
          <option value="markdown">Markdown</option>
          <option value="plain">{{ t('纯文本') }}</option></select
        ><label for="source-content">{{ t('粘贴正文') }}</label
        ><textarea
          id="source-content"
          v-model="form.content"
          required
          rows="10"
          :maxlength="MAX_SOURCE_CHARACTERS"
          :disabled="busy || readingFile"
        />
        <p v-if="readingFile" role="status">{{ t('正在读取原文…') }}</p>
        <p v-if="importError" class="import-warning" role="alert">{{ t(importError) }}</p>
        <div class="form-actions">
          <button type="button" class="button secondary" :disabled="busy" @click="closeImport">
            {{ t('取消') }}</button
          ><button class="button primary" :disabled="busy || readingFile">
            {{ t('保存材料') }}
          </button>
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="deleting && source"
      :title="t('删除材料？')"
      :busy="busy"
      :error="actionError"
      @close="deleting = false"
      ><div class="source-delete">
        <p>
          {{
            t(
              '将删除「{title}」的原文快照，并解除 {count} 条笔记的来源关联。卡片内容和复习进度保留。',
              { title: source.title, count: linked.length },
            )
          }}
        </p>
        <p class="form-note">{{ t('操作前会保存快照，可在「数据与备份」中恢复。') }}</p>
        <div class="form-actions">
          <button class="button secondary" :disabled="busy" @click="deleting = false">
            {{ t('取消') }}</button
          ><button class="button danger" :disabled="busy" @click="remove">
            {{ t('确认删除') }}
          </button>
        </div>
      </div></AppModal
    >
  </div>
</template>

<style scoped>
.sources-layout {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.source-list {
  display: grid;
  gap: 0.6rem;
  max-height: 70vh;
  overflow: auto;
  padding: 0.2rem;
}
.source-list-pages {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.source-list input,
.source-text {
  width: 100%;
  min-width: 0;
  border: 1px solid #d4decd;
  border-radius: 8px;
  background: #fafbf8;
  color: #293d33;
  padding: 11px 13px;
}
.source-list input:hover,
.source-text:hover {
  border-color: #a8bca2;
}
.source-list-item {
  text-align: left;
  display: grid;
  gap: 0.4rem;
  padding: 0.9rem;
  color: inherit;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.source-list-item.selected {
  border-color: #67886d;
  background: #eef4e9;
}
.source-list-item span {
  font-size: 0.9rem;
  color: var(--muted);
}
.source-reader {
  min-width: 0;
  padding: 1.4rem;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  display: grid;
  gap: 1rem;
}
.source-reader-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
}
.source-reader-heading > div {
  min-width: 0;
}
.source-reader h2 {
  margin: 0 0 0.5rem;
  overflow-wrap: anywhere;
}
.source-reader a {
  overflow-wrap: anywhere;
}
.source-actions {
  display: flex;
  gap: 0.8rem;
  align-items: center;
  flex-wrap: wrap;
}
.source-text {
  width: 100%;
  min-height: 28rem;
  resize: vertical;
  line-height: 1.8;
  font-family: inherit;
  font-size: 1rem;
}
.source-selection-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
}
.source-markdown-preview {
  max-height: 36rem;
  overflow: auto;
}
.source-markdown-preview :deep(.card-content) {
  font-size: 1rem;
}
.source-excerpt-action {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  align-items: center;
}
.source-linked ul {
  padding-left: 1.3rem;
  display: grid;
  gap: 0.6rem;
  overflow-wrap: anywhere;
}
.source-import-form {
  overflow: auto;
  padding: 1.25rem 1.75rem;
}
.source-import-form .form-actions {
  position: sticky;
  bottom: -1.25rem;
  margin: 0 -1.75rem -1.25rem;
  padding: 1rem 1.75rem;
  background: #fff;
  box-shadow: 0 -4px 12px #293d3308;
}
.source-import-form .attachment-button {
  justify-self: start;
}
.source-import-form input[type='file'] {
  width: 1px;
  min-height: 0;
  height: 1px;
}
.source-delete {
  padding: 1.25rem 1.75rem;
  line-height: 1.7;
}
@media (max-width: 850px) {
  .sources-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-list {
    max-height: 14rem;
  }
  .source-reader {
    padding: 1rem;
  }
  .source-text {
    min-height: 20rem;
  }
}
@media (max-width: 720px) {
  .source-import-form,
  .source-delete {
    padding: 1rem;
  }
  .source-import-form .form-actions {
    bottom: -1rem;
    margin: 0 -1rem -1rem;
    padding: 1rem;
  }
}
</style>
