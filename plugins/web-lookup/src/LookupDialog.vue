<script setup lang="ts">
import { computed } from 'vue'
import { UiNotice, UiButton } from '@repeaty/plugin-api'
import { lookupUrl, type LookupTarget } from './lookup'
import { text } from './text'
const props = defineProps<{ selection: string; targets: LookupTarget[]; onClose: () => void }>()
const links = computed(() =>
  props.targets
    .filter((entry) => entry.enabled)
    .map((entry) => {
      try {
        const href = lookupUrl(entry.template, props.selection)
        return { ...entry, href, host: new URL(href).host, error: '' }
      } catch (issue) {
        return { ...entry, href: '', host: '', error: text((issue as Error).message) }
      }
    }),
)
</script>
<template>
  <div class="lookup-dialog">
    <p class="lookup-description">
      {{ text('仅在点击网站后发送下面的选区。不会自动发送整篇材料、学习记录或附件。') }}
    </p>
    <blockquote class="lookup-selection">
      {{ selection || text('请先在阅读器中选中文字。') }}
    </blockquote>
    <ul class="lookup-links">
      <li v-for="entry in links" :key="entry.id">
        <a
          v-if="entry.href"
          class="app-divider-after"
          :href="entry.href"
          target="_blank"
          rel="noopener noreferrer"
          ><strong>{{ entry.label }} ↗</strong><span>{{ entry.host }}</span></a
        >
        <UiNotice v-else tone="warning">{{ entry.error }}</UiNotice>
      </li>
    </ul>
    <UiNotice v-if="!links.length">{{ text('没有启用的查询目标，请到设置中添加。') }}</UiNotice>
    <UiButton variant="secondary" @click="onClose">{{ text('关闭') }}</UiButton>
  </div>
</template>
<style scoped>
.lookup-dialog {
  display: grid;
  gap: 1rem;
}
.lookup-description {
  margin: 0;
  color: var(--ui-text-muted);
}
.lookup-selection {
  margin: 0;
  padding: 1rem;
  max-height: 13rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--ui-bg-muted);
  border-inline-start: 3px solid var(--ui-primary);
}
.lookup-links {
  padding: 0;
  margin: 0;
  list-style: none;
}
.lookup-links a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 1rem 0;
  color: var(--ui-text);
  text-decoration: none;
}
.lookup-links a:hover strong {
  color: var(--ui-primary);
}
.lookup-links span {
  color: var(--ui-text-muted);
  font-size: var(--font-size-caption);
}
</style>
