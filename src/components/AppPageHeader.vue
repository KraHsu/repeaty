<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <header class="page-heading app-page-header">
    <div class="app-page-header__layout" :class="{ 'has-actions': !!$slots.actions }">
      <div class="app-page-header__copy">
        <h1>{{ title }}</h1>
        <p v-if="description || $slots.description" class="app-page-header__description">
          <slot name="description">{{ description }}</slot>
        </p>
      </div>
      <div v-if="$slots.actions" class="app-page-header__actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-page-header {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0 0 2rem;
  container-type: inline-size;
}
.app-page-header__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 1.5rem;
}
.app-page-header__layout.has-actions {
  grid-template-columns: minmax(0, 1fr) auto;
}
.app-page-header__copy {
  min-width: 0;
}
.app-page-header h1 {
  display: flex;
  align-items: center;
  min-height: var(--ui-control-height);
  margin: 0;
  font-size: var(--font-size-page);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
}
.app-page-header .app-page-header__description {
  margin: 0.375rem 0 0;
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-ui);
  overflow-wrap: anywhere;
}
.app-page-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
  max-width: 100%;
  min-height: var(--ui-control-height);
}
@container (max-width: 48rem) {
  .app-page-header__layout.has-actions {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  .app-page-header__actions {
    justify-content: flex-start;
  }
}
</style>
