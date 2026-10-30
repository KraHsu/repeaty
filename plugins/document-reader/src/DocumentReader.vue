<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import {
  locale,
  materials,
  tasks,
  UiButton,
  UiCollapsible,
  UiInput,
  UiNotice,
  UiSelect,
  type MaterialLocator,
  type MaterialReaderProps,
  type MaterialRecord,
} from '@repeaty/plugin-api'
import type { DocumentBook } from './model'
import { readDocument } from './worker'
import { cacheBook, cachedBook } from './cache'
import { pointRange, selectionOffsets, spanAt } from './selection'

const props = defineProps<MaterialReaderProps>()
const t = (zh: string, en: string) => (locale.value === 'en' ? en : zh)
const book = shallowRef<DocumentBook>(),
  busy = ref(false),
  error = ref(''),
  progress = ref(''),
  query = ref(''),
  found = ref(-1)
const article = ref<HTMLElement>(),
  viewport = ref<HTMLElement>(),
  siblings = shallowRef<readonly MaterialRecord[]>([]),
  changing = ref(false)
const showContents = ref(true)
let abort: AbortController | undefined,
  epoch = 0,
  urls: string[] = [],
  positionTimer: ReturnType<typeof setTimeout> | undefined
const chapter = computed(() =>
  book.value?.chapters.find((item) => item.path === props.material.document?.path),
)
const container = computed(
  () => props.material.document?.container === true && !props.material.document.path,
)
// The host updates this descriptor after undo, redo and chapter mutations.
const activeRecord = computed(() => props.material)
const sequence = computed(
  () =>
    activeRecord.value.studySequence ??
    siblings.value.find((item) => item.studySequence)?.studySequence,
)
const currentIndex = computed(() =>
  siblings.value.findIndex((item) => item.id === props.material.id),
)
const modes = computed(() => [
  { value: 'free', label: t('自由阅读', 'Free reading') },
  { value: 'sequential', label: t('顺序学习', 'Sequential study') },
])
const verified = computed(() => chapter.value?.text === props.text)
function revoke() {
  urls.forEach((url) => URL.revokeObjectURL(url))
  urls = []
}
function locator(start: number, end?: number): MaterialLocator {
  if (end === undefined) ({ start, end } = pointRange(props.text, start))
  const base = {
    schemaVersion: 1 as const,
    sourceId: props.material.id,
    versionId: props.material.versionId,
  }
  return book.value?.kind === 'epub'
    ? { ...base, kind: 'epub', href: props.material.document?.path ?? '', start, end }
    : { ...base, kind: 'text', start, end, quote: props.text.slice(start, end) }
}
function open(path: string, fragment?: string) {
  const target = siblings.value.find((item) => item.document?.path === path)
  const targetChapter = book.value?.chapters.find((item) => item.path === path)
  const start = fragment ? (targetChapter?.anchors[fragment] ?? 0) : 0
  if (path === props.material.document?.path) scrollTo(start)
  else if (target && targetChapter)
    props.onOpen?.(target.id, {
      schemaVersion: 1,
      sourceId: target.id,
      versionId: target.versionId,
      kind: 'epub',
      href: path,
      ...pointRange(targetChapter.text, start),
    })
}
function scrollTo(start: number) {
  if (start === 0 && viewport.value) {
    viewport.value.scrollTop = 0
    return
  }
  const span = article.value && spanAt(article.value, start)
  if (span && viewport.value)
    viewport.value.scrollTop +=
      span.getBoundingClientRect().top - viewport.value.getBoundingClientRect().top - 24
}
function select() {
  if (!article.value || !verified.value) return
  const selection = document.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return
  const projection = selectionOffsets(article.value, selection.getRangeAt(0))
  if (!projection || projection.end > props.text.length) return
  props.onSelect({
    locator: locator(projection.start, projection.end),
    text: props.text.slice(projection.start, projection.end),
    projection,
  })
}
function onScroll() {
  clearTimeout(positionTimer)
  positionTimer = setTimeout(() => {
    if (!verified.value || !article.value || !viewport.value || !props.onPosition) return
    const top = viewport.value.getBoundingClientRect().top + 24
    const span = [...article.value.querySelectorAll<HTMLElement>('[data-doc-start]')].find(
      (item) => item.getBoundingClientRect().bottom >= top,
    )
    if (!span) return
    const offset = Number(span.dataset.docStart)
    props.onPosition({ locator: locator(offset), projectionOffset: offset })
  }, 180)
}
function navigateLink(event: Event) {
  const anchor = (event.target as Element).closest<HTMLElement>('[data-doc-link]')
  if (!anchor) return
  event.preventDefault()
  const link = anchor.dataset.docLink!,
    hash = link.indexOf('#')
  open(hash < 0 ? link : link.slice(0, hash), hash < 0 ? undefined : link.slice(hash + 1))
}
function linkKey(event: KeyboardEvent) {
  if (event.key === 'Enter') navigateLink(event)
}
function search() {
  if (!query.value.trim() || !verified.value) {
    found.value = -1
    return
  }
  const needle = query.value.toLocaleLowerCase(),
    haystack = props.text.toLocaleLowerCase()
  found.value = haystack.indexOf(needle, found.value + 1)
  if (found.value < 0) found.value = haystack.indexOf(needle)
  if (found.value >= 0) {
    scrollTo(found.value)
    props.onSelect({
      locator: locator(found.value, found.value + query.value.length),
      text: props.text.slice(found.value, found.value + query.value.length),
      projection: { start: found.value, end: found.value + query.value.length },
    })
  }
}
async function refreshSiblings() {
  const generation = epoch,
    root = props.material.parentSourceId ?? props.material.id
  const all = await materials.list()
  if (generation === epoch)
    siblings.value = all
      .filter((item) => item.parentSourceId === root)
      .sort(
        (a, b) =>
          (book.value?.chapters.findIndex((item) => item.path === a.document?.path) ?? 0) -
          (book.value?.chapters.findIndex((item) => item.path === b.document?.path) ?? 0),
      )
}
async function setSequence(change: { mode?: 'free' | 'sequential'; completed?: boolean }) {
  if (props.readOnly || changing.value) return
  changing.value = true
  error.value = ''
  const sourceId = props.material.id,
    versionId = props.material.versionId,
    generation = epoch
  try {
    const snapshot = materials.snapshot()
    const current = await materials.get(sourceId)
    if (generation !== epoch) return
    if (current.material.versionId !== versionId)
      throw new Error(
        t('正文已更新，请重新打开后操作。', 'The source changed. Reopen it before continuing.'),
      )
    await materials.setSequence({
      sourceId,
      ...change,
      expectedRevision: snapshot.revision,
      operationId: crypto.randomUUID(),
    })
    await refreshSiblings()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    changing.value = false
  }
}
async function load() {
  const generation = ++epoch
  abort?.abort()
  abort = new AbortController()
  clearTimeout(positionTimer)
  revoke()
  book.value = undefined
  error.value = ''
  found.value = -1
  busy.value = true
  const signal = abort.signal
  try {
    if (!props.original)
      throw new Error(
        t(
          '原始文档不可用，可继续阅读下方文字。',
          'The original document is unavailable; the text remains below.',
        ),
      )
    const kind = props.material.document?.format === 'epub' ? 'epub' : 'html'
    const key = `${props.workspaceScope}:${kind}:${props.material.document?.originalMediaId}:${kind === 'html' ? props.material.versionId : ''}`
    let parsed = cachedBook(key)
    if (!parsed)
      parsed = await tasks.run(
        {
          id: `read-${props.material.id}`,
          title: t('打开文档', 'Open document'),
          signal,
          onProgress: (value) => {
            if (epoch === generation) progress.value = value.message ?? ''
          },
        },
        async (context) => {
          const related: File[] = []
          if (kind === 'html')
            for (const resource of props.material.document?.resources ?? []) {
              context.signal.throwIfAborted()
              const blob = await props.resource?.(resource.path)
              if (blob) related.push(new File([blob], resource.path, { type: blob.type }))
            }
          return readDocument(props.original!, kind, props.material.document?.path ?? 'book.epub', {
            ...context,
            files: related,
          })
        },
      )
    if (signal.aborted || generation !== epoch) return
    cacheBook(key, parsed)
    book.value = parsed
    await refreshSiblings()
    if (generation !== epoch || signal.aborted) return
    busy.value = false
    await nextTick()
    const elements = [
      ...(article.value?.querySelectorAll<HTMLElement>('[data-doc-resource]') ?? []),
    ]
    for (const path of new Set(elements.map((item) => item.dataset.docResource!))) {
      const blob = await props.resource?.(path)
      if (generation !== epoch || signal.aborted) return
      const fallback = parsed.resources.find((resource) => resource.path === path)
      const resource =
        blob ?? (fallback && new Blob([new Uint8Array(fallback.bytes)], { type: fallback.type }))
      if (!resource) continue
      const url = URL.createObjectURL(resource)
      urls.push(url)
      for (const element of elements.filter((item) => item.dataset.docResource === path))
        element.setAttribute('src', url)
    }
    const selected =
      props.selection?.projection?.start ??
      (props.selection?.locator.kind === 'epub' ? props.selection.locator.start : undefined)
    scrollTo(selected ?? props.position?.projectionOffset ?? 0)
  } catch (cause) {
    if (!signal.aborted && generation === epoch)
      error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (generation === epoch) busy.value = false
  }
}
watch(
  [
    () => props.workspaceScope,
    () => props.material.id,
    () => props.material.versionId,
    () => props.original,
  ],
  () => void load(),
  { immediate: true },
)
watch(
  () => props.position,
  (position) => {
    if (position) scrollTo(position.projectionOffset)
  },
  { flush: 'post' },
)
watch(
  [
    () => props.material.studySequence?.mode,
    () => props.material.studySequence?.completed,
    () => props.material.locked,
    () => (container.value ? props.material : undefined),
  ],
  () => {
    if (book.value) void refreshSiblings().catch(() => {})
  },
)
watch(
  () => props.selection,
  (selected) => {
    const offset = selected?.projection?.start
    if (offset !== undefined) scrollTo(offset)
  },
)
onBeforeUnmount(() => {
  epoch++
  abort?.abort()
  clearTimeout(positionTimer)
  revoke()
})
</script>

<template>
  <section
    class="document-reader"
    :aria-label="t('文档阅读器', 'Document reader')"
    :aria-busy="busy"
  >
    <div class="document-toolbar">
      <UiButton
        v-if="book?.kind === 'epub'"
        variant="ghost"
        :aria-expanded="showContents"
        @click="showContents = !showContents"
        >{{ t('目录', 'Contents') }}</UiButton
      >
      <span class="document-caption">{{
        container ? t('选择章节开始阅读', 'Choose a chapter to read') : material.title
      }}</span>
      <UiSelect
        v-if="sequence && !readOnly && (container || activeRecord.studySequence)"
        :aria-label="t('学习顺序', 'Study order')"
        :items="modes"
        :model-value="sequence.mode"
        :disabled="changing"
        @update:model-value="setSequence({ mode: $event })"
      />
    </div>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
    <p v-if="busy" class="document-loading" role="status">
      {{ progress || t('正在打开文档…', 'Opening document…') }}
    </p>
    <template v-else-if="book">
      <UiNotice v-if="activeRecord.locked" tone="info">{{
        t(
          '可浏览本章；完成前一章后，本章会进入学习队列。',
          'You can browse this chapter. Complete the previous chapter to add this one to the study queue.',
        )
      }}</UiNotice>
      <UiCollapsible
        v-if="book.warnings.length"
        :title="t('部分资源未加载', 'Some resources were not loaded')"
      >
        <ul>
          <li v-for="warning in book.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </UiCollapsible>
      <div
        class="document-layout"
        :class="{ 'with-contents': book.kind === 'epub' && showContents }"
      >
        <nav
          v-if="book.kind === 'epub' && showContents"
          class="document-contents"
          :aria-label="t('书籍目录', 'Book contents')"
        >
          <span class="document-book-title">{{ book.title }}</span>
          <ol>
            <li
              v-for="(item, index) in book.toc"
              :key="index"
              :style="{ paddingInlineStart: `${item.depth * 0.65}rem` }"
            >
              <UiButton
                variant="ghost"
                :aria-current="item.path === material.document?.path ? 'page' : undefined"
                :disabled="!onOpen && item.path !== material.document?.path"
                @click="open(item.path, item.fragment)"
                >{{ item.title }}</UiButton
              >
            </li>
          </ol>
        </nav>
        <div class="document-body">
          <div v-if="container" class="document-cover">
            <span class="document-eyebrow">EPUB</span>
            <h2>{{ book.title }}</h2>
            <p>
              {{ book.chapters.length }}
              {{ t('个章节 · 离线可读', 'chapters · available offline') }}
            </p>
            <p>
              {{
                sequence?.mode === 'sequential'
                  ? t(
                      '依次完成章节，后续章节会自动进入学习队列。',
                      'Complete chapters in order to release the next chapter into your study queue.',
                    )
                  : t(
                      '按目录自由选择章节，也可切换为顺序学习。',
                      'Choose any chapter, or switch to sequential study.',
                    )
              }}
            </p>
            <UiButton :disabled="!onOpen" @click="open(book.chapters[0]!.path)">{{
              t('开始阅读', 'Start reading')
            }}</UiButton>
          </div>
          <template v-else-if="chapter && verified">
            <form class="document-search" @submit.prevent="search">
              <UiInput
                v-model="query"
                :placeholder="t('在本章查找', 'Find in this chapter')"
                :aria-label="t('在本章查找', 'Find in this chapter')"
                @update:model-value="found = -1"
              />
              <UiButton type="submit" variant="ghost" :disabled="!query.trim()">{{
                t('查找下一个', 'Find next')
              }}</UiButton>
            </form>
            <div ref="viewport" class="document-viewport" tabindex="0" @scroll.passive="onScroll">
              <article
                ref="article"
                class="document-prose"
                @mouseup="select"
                @keyup="select"
                @click="navigateLink"
                @keydown="linkKey"
                v-html="chapter.html"
              />
            </div>
            <footer class="document-footer">
              <UiButton
                v-if="book.kind === 'epub'"
                variant="ghost"
                :disabled="currentIndex < 1 || !onOpen"
                @click="open(siblings[currentIndex - 1]!.document!.path!)"
                >{{ t('上一章', 'Previous') }}</UiButton
              >
              <span v-if="book.kind === 'epub'"
                >{{ currentIndex + 1 }} / {{ siblings.length }}</span
              >
              <UiButton
                v-if="activeRecord.studySequence && !readOnly"
                variant="secondary"
                :disabled="activeRecord.locked || activeRecord.studySequence.completed || changing"
                @click="setSequence({ completed: true })"
                >{{
                  activeRecord.studySequence.completed
                    ? t('本章已完成', 'Completed')
                    : t('完成本章', 'Complete chapter')
                }}</UiButton
              >
              <UiButton
                v-if="book.kind === 'epub'"
                variant="ghost"
                :disabled="currentIndex < 0 || currentIndex >= siblings.length - 1 || !onOpen"
                @click="open(siblings[currentIndex + 1]!.document!.path!)"
                >{{ t('下一章', 'Next') }}</UiButton
              >
            </footer>
          </template>
          <UiNotice v-else tone="warning">{{
            t(
              '正文版本与原件不一致，以下显示已保存的文字。请重新导入以恢复富文本阅读。',
              'This text version differs from the original. The saved text is below; reimport to restore rich reading.',
            )
          }}</UiNotice>
        </div>
      </div>
    </template>
    <pre v-if="!busy && (!book || (!container && !verified))" class="document-fallback">{{
      text
    }}</pre>
  </section>
</template>

<style scoped>
.document-reader {
  color: var(--ui-text);
  min-width: 0;
}
.document-toolbar,
.document-search,
.document-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 0;
}
.document-toolbar {
  border-bottom: 1px solid var(--ui-border);
}
.document-caption {
  flex: 1;
  min-width: 8rem;
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
}
.document-loading {
  padding: 3rem 1rem;
  text-align: center;
  color: var(--ui-text-muted);
}
.document-layout {
  display: grid;
  min-width: 0;
}
.document-layout.with-contents {
  grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr);
  gap: 1.5rem;
}
.document-contents {
  padding: 1.25rem 0;
  max-height: 65vh;
  overflow: auto;
}
.document-book-title {
  display: block;
  font-weight: 600;
  margin: 0 0.5rem 1rem;
}
.document-contents ol {
  list-style: none;
  padding: 0;
  margin: 0;
}
.document-contents :deep(button) {
  width: 100%;
  justify-content: flex-start;
  text-align: start;
  white-space: normal;
  margin-block: 0.125rem;
}
.document-contents :deep([aria-current='page']) {
  background: var(--ui-bg-elevated);
  color: var(--green);
}
.document-body {
  min-width: 0;
}
.document-cover {
  padding: clamp(2rem, 6vw, 5rem) 1.5rem;
  max-width: 42rem;
  margin-inline: auto;
  text-align: center;
}
.document-cover h2 {
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  line-height: 1.35;
  margin: 1rem 0;
}
.document-cover p {
  color: var(--ui-text-muted);
  margin: 1rem 0 1.5rem;
  line-height: 1.7;
}
.document-eyebrow {
  letter-spacing: 0.12em;
  font-size: var(--font-size-meta);
  color: var(--green);
}
.document-search :deep(input) {
  min-width: 10rem;
}
.document-viewport {
  max-height: 65vh;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border-block: 1px solid var(--ui-border);
}
.document-prose {
  max-width: 48rem;
  margin-inline: auto;
  padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 3rem;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.document-prose :deep(p) {
  margin: 0.8em 0;
}
.document-prose :deep(h1),
.document-prose :deep(h2),
.document-prose :deep(h3) {
  font-weight: 600;
  line-height: 1.4;
  margin: 1.5em 0 0.75em;
}
.document-prose :deep(h1) {
  font-size: 1.75rem;
}
.document-prose :deep(h2) {
  font-size: 1.4rem;
}
.document-prose :deep(h3) {
  font-size: 1.2rem;
}
.document-prose :deep(img),
.document-prose :deep(audio) {
  max-width: 100%;
  height: auto;
  margin: 1rem auto;
}
.document-prose :deep(a),
.document-prose :deep([data-doc-link]) {
  color: var(--green);
  text-decoration: underline;
  cursor: pointer;
}
.document-prose :deep(pre) {
  white-space: pre-wrap;
  padding: 1rem;
  background: var(--ui-bg-elevated);
  border-radius: 0.5rem;
  font-family: var(--font-mono);
}
.document-prose :deep(blockquote) {
  border-inline-start: 3px solid var(--ui-border);
  padding-inline-start: 1rem;
  color: var(--ui-text-muted);
}
.document-prose :deep(table) {
  border-collapse: collapse;
  display: block;
  max-width: 100%;
  overflow: auto;
}
.document-prose :deep(td),
.document-prose :deep(th) {
  padding: 0.5rem;
  border: 1px solid var(--ui-border);
}
.document-prose :deep(ul),
.document-prose :deep(ol) {
  padding-inline-start: 1.5rem;
  list-style: revert;
}
.document-prose :deep(mark) {
  background: var(--ui-bg-elevated);
  color: inherit;
}
.document-footer {
  justify-content: flex-end;
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
}
.document-footer > :first-child {
  margin-inline-end: auto;
}
.document-fallback {
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.8;
  padding-block: 1rem;
}
@media (max-width: 700px) {
  .document-layout.with-contents {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  .document-contents {
    max-height: 13rem;
    border-bottom: 1px solid var(--ui-border);
  }
  .document-viewport {
    max-height: 60vh;
  }
}
</style>
