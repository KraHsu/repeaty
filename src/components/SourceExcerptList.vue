<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { t } from '../i18n'
import { excerptPreview, matchingExcerpts, type SavedExcerpt } from '../core/source-navigation'
import { sourceQueueState } from '../core/source-queue'
import type { SourceExcerpt } from '../core/source-data'

const props = defineProps<{
  entries: SavedExcerpt[]
  text: string
  selection?: SourceExcerpt
  today: string
  busy: boolean
  canLocate: boolean
}>()
const emit = defineEmits<{ locate: [id: string]; open: [id: string] }>()
const heading = ref<HTMLElement>()
const page = ref(0)
const pageSize = 5
const pages = computed(() => Math.max(1, Math.ceil(props.entries.length / pageSize)))
const visible = computed(() =>
  props.entries.slice(page.value * pageSize, (page.value + 1) * pageSize),
)
const matches = computed(
  () => new Set(matchingExcerpts(props.entries, props.selection).map((entry) => entry.source.id)),
)
watch(pages, (total) => {
  page.value = Math.min(page.value, total - 1)
})
async function showMatches() {
  const index = props.entries.findIndex((entry) => matches.value.has(entry.source.id))
  if (index < 0) return
  page.value = Math.floor(index / pageSize)
  await nextTick()
  heading.value?.focus({ preventScroll: true })
  heading.value?.scrollIntoView({ block: 'nearest' })
}
defineExpose({ showMatches })
</script>

<template>
  <section class="source-excerpts" :aria-label="t('本篇摘录')">
    <h3 ref="heading" tabindex="-1">{{ t('本篇摘录（{count}）', { count: entries.length }) }}</h3>
    <p class="form-note">{{ t('按原文位置排列，包含稍后阅读和已归档的摘录。') }}</p>
    <ol class="source-excerpt-list" :start="page * pageSize + 1">
      <li
        v-for="entry in visible"
        :key="entry.source.id"
        :data-excerpt-id="entry.source.id"
        :class="{ matched: matches.has(entry.source.id) }"
      >
        <h4>{{ entry.source.title }}</h4>
        <p v-if="text" class="source-excerpt-preview">{{ excerptPreview(text, entry.origin) }}</p>
        <div class="source-excerpt-meta">
          <span>{{ t('{count} 张关联卡片', { count: entry.cards }) }}</span>
          <span v-if="sourceQueueState(entry.source, today) !== 'ready'">{{
            t(sourceQueueState(entry.source, today) === 'archived' ? '已归档' : '稍后阅读')
          }}</span>
          <span v-if="matches.has(entry.source.id)" class="source-excerpt-match">{{
            t('当前选区')
          }}</span>
        </div>
        <div class="source-excerpt-buttons">
          <button
            type="button"
            class="button secondary"
            :disabled="busy || !canLocate"
            :aria-label="t('定位「{title}」的原文', { title: entry.source.title })"
            @click="emit('locate', entry.source.id)"
          >
            {{ t('定位原文') }}
          </button>
          <button
            type="button"
            class="text-button"
            :disabled="busy"
            :aria-label="t('打开摘录「{title}」', { title: entry.source.title })"
            @click="emit('open', entry.source.id)"
          >
            {{ t('打开摘录') }}
          </button>
        </div>
      </li>
    </ol>
    <nav v-if="pages > 1" class="source-excerpt-pages" :aria-label="t('本篇摘录分页')">
      <button type="button" class="text-button" :disabled="busy || page === 0" @click="page--">
        {{ t('上一页') }}
      </button>
      <span>{{ t('第 {page} 页，共 {pages} 页', { page: page + 1, pages }) }}</span>
      <button
        type="button"
        class="text-button"
        :disabled="busy || page + 1 >= pages"
        @click="page++"
      >
        {{ t('下一页') }}
      </button>
    </nav>
  </section>
</template>

<style scoped>
.source-excerpts {
  min-width: 0;
  border-top: 1px solid var(--line);
  padding-top: 1rem;
}
.source-excerpts h3 {
  margin: 0 0 0.6rem;
  font-size: var(--font-size-section);
}
.source-excerpt-list {
  display: grid;
  gap: 0.75rem;
  padding: 0;
  list-style: none;
}
.source-excerpt-list li {
  display: grid;
  gap: 0.65rem;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem;
}
.source-excerpt-list li.matched {
  border-color: #67886d;
  background: #f4f7ef;
}
.source-excerpt-list h4 {
  font-size: var(--font-size-body);
  margin: 0;
  overflow-wrap: anywhere;
}
.source-excerpt-preview {
  margin: 0;
  font-size: var(--font-size-body);
  line-height: var(--line-height-ui);
  overflow-wrap: anywhere;
}
.source-excerpt-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.source-excerpt-match {
  color: #3c624b;
  font-weight: var(--font-weight-semibold);
}
.source-excerpt-buttons,
.source-excerpt-pages {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.source-excerpt-pages {
  justify-content: space-between;
  font-size: var(--font-size-meta);
}
.source-excerpt-buttons button {
  min-height: 44px;
}
</style>
