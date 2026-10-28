<script setup lang="ts">
import { useAttrs, useId } from 'vue'
withDefaults(defineProps<{ title: string; description?: string; level?: 3 | 4 }>(), {
  level: 3,
})
const titleId = `setting-section-${useId()}`
const attrs = useAttrs()
</script>

<template>
  <section class="ui-setting-section" :aria-labelledby="attrs['aria-label'] ? undefined : titleId">
    <header class="ui-setting-section__header">
      <div class="ui-setting-section__intro">
        <component :is="`h${level}`" :id="titleId" class="ui-setting-section__title">{{
          title
        }}</component>
        <p v-if="description" class="ui-setting-section__description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="ui-setting-section__actions"><slot name="actions" /></div>
    </header>
    <div class="ui-setting-section__body"><slot /></div>
  </section>
</template>
