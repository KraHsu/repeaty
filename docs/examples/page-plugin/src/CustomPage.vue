<script setup lang="ts">
import { computed } from 'vue'
import { locale, UiButton, type PluginPageProps } from '@repeaty/plugin-api'

defineProps<PluginPageProps>()
const chinese = computed(() => locale.value === 'zh-CN')
</script>

<template>
  <section class="page-example-custom" aria-labelledby="page-example-custom-title">
    <h1 id="page-example-custom-title">
      {{ chinese ? '自定义布局示例' : 'Custom layout example' }}
    </h1>
    <p>
      {{
        chinese
          ? '共享页面容器是推荐用法，也可以完全自己安排页面。'
          : 'The shared container is recommended, while custom page layouts remain supported.'
      }}
    </p>
    <UiButton variant="secondary" disabled>{{ chinese ? '示例内容' : 'Example content' }}</UiButton>
  </section>
</template>

<style scoped>
.page-example-custom {
  display: grid;
  justify-items: start;
  gap: 1rem;
  width: 100%;
  min-width: 0;
  padding: clamp(1rem, 4vw, 3rem);
  color: var(--ui-text);
}
.page-example-custom h1 {
  margin: 0;
  font-size: var(--font-size-page);
  line-height: var(--line-height-heading);
  overflow-wrap: anywhere;
}
.page-example-custom p {
  margin: 0;
  max-width: 40rem;
  color: var(--ui-text-muted);
  line-height: var(--line-height-reading);
}
</style>
