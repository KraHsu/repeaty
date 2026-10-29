<script setup lang="ts">
import { useAttrs, useId } from 'vue'
import UCard from '@nuxt/ui/components/Card.vue'
withDefaults(defineProps<{ title: string; description?: string; level?: 3 | 4 }>(), {
  level: 3,
})
const titleId = `setting-section-${useId()}`
const attrs = useAttrs()
</script>

<template>
  <UCard
    as="section"
    variant="soft"
    class="ui-setting-section"
    :aria-labelledby="attrs['aria-label'] ? undefined : titleId"
    :ui="{ body: 'space-y-4' }"
  >
    <template #header
      ><div class="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div class="ui-setting-section__intro">
          <component
            :is="`h${level}`"
            :id="titleId"
            class="ui-setting-section__title text-base font-semibold"
            >{{ title }}</component
          >
          <p v-if="description" class="ui-setting-section__description mt-1 text-xs text-muted">
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
