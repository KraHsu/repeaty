<script setup lang="ts">
import { useId } from 'vue'
withDefaults(defineProps<{ title: string; description?: string; level?: 2 | 3 }>(), {
  level: 2,
})
const titleId = `setting-group-${useId()}`
</script>

<template>
  <section class="ui-setting-group" :aria-labelledby="titleId">
    <header class="ui-setting-group__header">
      <div class="ui-setting-group__intro">
        <component :is="`h${level}`" :id="titleId" class="ui-setting-group__title">{{
          title
        }}</component>
        <p v-if="description" class="ui-setting-group__description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="ui-setting-group__actions"><slot name="actions" /></div>
    </header>
    <div class="ui-setting-group__body"><slot /></div>
  </section>
</template>
