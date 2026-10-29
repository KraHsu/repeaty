<script setup lang="ts">
import { computed } from 'vue'
import { useApplication } from '../app/context'
import type { PluginWidgetPlacement } from '../plugins/widgets'
import { t } from '../i18n'
import PluginViewBoundary from './PluginViewBoundary.vue'
const props = defineProps<{ placement: PluginWidgetPlacement }>()
const { pluginWidgets, pluginReviews } = useApplication()
const entries = computed(() =>
  pluginWidgets.value.filter((entry) => entry.contribution.placement === props.placement),
)
</script>
<template>
  <div v-if="entries.length" class="plugin-widget-slot" :data-plugin-slot="placement">
    <section
      v-for="entry in entries"
      :key="entry.key"
      :aria-label="t(entry.contribution.title)"
      :data-plugin-widget="`${entry.pluginId}/${entry.contribution.id}`"
    >
      <PluginViewBoundary
        kind="widget"
        :title="t(entry.contribution.title)"
        :component="entry.contribution.component"
        :scope="entry.scope"
        :reviews="pluginReviews"
      />
    </section>
  </div>
</template>
<style scoped>
.plugin-widget-slot {
  display: grid;
  gap: 1.5rem;
  margin-block: 1.5rem;
  min-width: 0;
}
.plugin-widget-slot > section {
  min-width: 0;
}
</style>
