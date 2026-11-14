<script setup lang="ts">
import { ref } from 'vue'
import { locale, UiNotice, type MaterialReaderProps } from '@repeaty/plugin-api'

const props = defineProps<MaterialReaderProps>()
const body = ref<HTMLElement>()
function selected() {
  const root = body.value,
    selection = window.getSelection()
  if (!root || !selection?.rangeCount || selection.isCollapsed) {
    props.onSelect(undefined)
    return
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
  const before = range.cloneRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length,
    text = range.toString(),
    end = start + text.length
  if (!text || props.text.slice(start, end) !== text) {
    props.onSelect(undefined)
    return
  }
  props.onSelect({
    text,
    locator: {
      schemaVersion: 1,
      sourceId: props.material.id,
      versionId: props.material.versionId,
      kind: 'text',
      start,
      end,
      quote: text,
    },
  })
}
</script>

<template>
  <section class="study-chapter" data-testid="structured-study-reader">
    <UiNotice>
      {{
        locale === 'zh-CN'
          ? '选中章节内容，保存为摘录或用摘录制卡。'
          : 'Select chapter text to save an excerpt or create a card.'
      }}
    </UiNotice>
    <div
      ref="body"
      class="study-chapter-body"
      data-testid="structured-study-text"
      :aria-label="locale === 'zh-CN' ? '章节正文' : 'Chapter text'"
      tabindex="0"
      @mouseup="selected"
      @keyup="selected"
      @touchend="selected"
    >
      {{ text }}
    </div>
  </section>
</template>

<style scoped>
.study-chapter {
  display: grid;
  gap: 1rem;
}
.study-chapter-body {
  min-height: 12rem;
  max-height: 36rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-reading);
  line-height: var(--line-height-reading);
  padding: 0.75rem;
  border-inline-start: 2px solid var(--color-border);
}
</style>
