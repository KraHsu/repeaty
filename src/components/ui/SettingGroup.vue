<script setup lang="ts">
import { useId } from 'vue'
import UCard from '@nuxt/ui/components/Card.vue'
withDefaults(defineProps<{ title: string; description?: string; level?: 2 | 3 }>(), {
  level: 2,
})
const titleId = `setting-group-${useId()}`
</script>

<template>
  <UCard
    as="section"
    class="ui-setting-group"
    :aria-labelledby="titleId"
    :ui="{ body: 'space-y-5' }"
  >
    <template #header
      ><div class="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div class="ui-setting-group__intro">
          <component
            :is="`h${level}`"
            :id="titleId"
            class="ui-setting-group__title text-xl font-semibold"
            >{{ title }}</component
          >
          <p v-if="description" class="ui-setting-group__description mt-1 text-xs text-muted">
            {{ description }}
          </p>
        </div>
        <div v-if="$slots.actions" class="flex max-w-full flex-wrap items-center gap-2">
          <slot name="actions" />
        </div></div
    ></template>
    <slot />
  </UCard>
</template>
