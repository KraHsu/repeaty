<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale, type PluginWidgetProps } from '@repeaty/plugin-api'
import { reviewDays } from './review-days'
import { startDayClock } from './day-clock'
import { text } from './text'

const props = defineProps<PluginWidgetProps>()
const today = ref(new Date())
const days = computed(() => reviewDays(props.reviews, today.value))
const total = computed(() => days.value.reduce((sum, day) => sum + day.count, 0))
const numbers = computed(() => new Intl.NumberFormat(locale.value))
const dates = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }),
)
const countLabel = (count: number) => `${numbers.value.format(count)} ${text('ratingCount')}`
let stopClock: (() => void) | undefined
onMounted(() => {
  stopClock = startDayClock((date) => {
    today.value = date
  })
})
onUnmounted(() => stopClock?.())
</script>

<template>
  <section class="review-heatmap" :aria-label="text('accessible')">
    <header>
      <div>
        <h2>{{ text('title') }}</h2>
        <p>{{ text('description') }}</p>
      </div>
      <strong class="review-heatmap-total">{{ countLabel(total) }}</strong>
    </header>
    <p class="review-heatmap-range">
      {{ dates.format(days[0]!.date) }} – {{ dates.format(days[27]!.date) }}
    </p>
    <p v-if="total === 0" class="review-heatmap-empty">{{ text('empty') }}</p>
    <ol class="review-heatmap-grid">
      <li
        v-for="day in days"
        :key="day.key"
        :data-level="day.count === 0 ? 0 : day.count < 5 ? 1 : 2"
        :aria-label="`${dates.format(day.date)}: ${countLabel(day.count)}`"
        :title="`${dates.format(day.date)}: ${countLabel(day.count)}`"
      >
        <span>{{ numbers.format(day.date.getDate()) }}</span>
        <strong>{{ numbers.format(day.count) }}</strong>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.review-heatmap {
  container-type: inline-size;
  padding: 1.5rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.875rem;
  background: var(--ui-bg);
  color: var(--ui-text);
}
.review-heatmap header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.review-heatmap h2,
.review-heatmap p {
  margin: 0;
}
.review-heatmap h2 {
  font-size: var(--font-size-section);
}
.review-heatmap p {
  color: var(--ui-text-muted);
  line-height: var(--line-height-reading);
}
.review-heatmap header p {
  margin-top: 0.375rem;
}
.review-heatmap .review-heatmap-range,
.review-heatmap .review-heatmap-empty {
  font-size: var(--font-size-meta);
  margin-bottom: 0.75rem;
}
.review-heatmap-total {
  overflow-wrap: anywhere;
}
.review-heatmap-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.375rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
.review-heatmap-grid li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}
.review-heatmap-grid li[data-level='1'] {
  background: var(--app-selected);
}
.review-heatmap-grid li[data-level='2'] {
  background: var(--sage);
  border-color: var(--green);
}
.review-heatmap-grid span {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
}
.review-heatmap-grid strong {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
@container (max-width: 24rem) {
  .review-heatmap-grid {
    gap: 0.25rem;
  }
  .review-heatmap-grid li {
    padding: 0.375rem 0.25rem;
  }
}
</style>
