<script setup lang="ts">
import { computed } from 'vue'
import { UiNotice, type MaterialReaderProps } from '@repeaty/plugin-api'
import FormulaSurface from './FormulaSurface.vue'
const props = defineProps<MaterialReaderProps>()
const locator = computed(() =>
  props.selection?.locator.kind === 'formula' ? props.selection.locator : undefined,
)
</script>
<template>
  <section v-if="locator" class="vo-formula-source">
    <p>来源公式 · 对应的公式元素已高亮</p>
    <FormulaSurface :latex="locator.latex" :highlight="locator.leaves" />
    <details>
      <summary>原始公式</summary>
      <pre>{{ text.slice(locator.start, locator.end) }}</pre>
    </details>
  </section>
  <UiNotice v-else tone="warning">缺少公式定位，原始材料仍然保留。</UiNotice>
</template>
<style scoped>
.vo-formula-source > p {
  color: var(--ui-text-muted, #6d7d70);
  font-size: 0.875rem;
}
.vo-formula-source details {
  margin-top: 1rem;
}
.vo-formula-source pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
}
</style>
