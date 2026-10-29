<script setup lang="ts">
import AppPageHeader from './AppPageHeader.vue'

defineProps<{ title?: string; description?: string }>()
</script>

<template>
  <div class="page app-page">
    <AppPageHeader v-if="title" :title="title" :description="description">
      <template v-if="$slots.description" #description><slot name="description" /></template>
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </AppPageHeader>
    <slot />
  </div>
</template>

<style scoped>
.app-page {
  width: 100%;
  min-width: 0;
}
</style>
