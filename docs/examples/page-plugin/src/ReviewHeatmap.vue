<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale, type PluginWidgetProps } from '@repeaty/plugin-api'
import { reviewDays } from './review-days'

const props = defineProps<PluginWidgetProps>()
const today = ref(new Date())
const chinese = computed(() => locale.value === 'zh-CN')
const days = computed(() => reviewDays(props.reviews, today.value))
const total = computed(() => days.value.reduce((sum, day) => sum + day.count, 0))
const dateLabel = (date: Date) =>
  new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }).format(date)
let midnight: ReturnType<typeof setTimeout> | undefined
function refreshDay() {
  today.value = new Date()
  const next = new Date(today.value)
  next.setHours(24, 0, 0, 0)
  midnight = setTimeout(refreshDay, next.getTime() - today.value.getTime() + 100)
}
onMounted(refreshDay)
onUnmounted(() => clearTimeout(midnight))
</script>

<template>
  <section
    class="review-heatmap"
    :aria-label="chinese ? '最近28天复习次数' : 'Ratings in the last 28 days'"
  >
    <header>
      <div>
        <h2>{{ chinese ? '每日复习' : 'Daily reviews' }}</h2>
        <p>
          {{
            chinese
              ? '最近28天，按本地日期统计正式评分。'
              : 'Formal ratings over the last 28 local calendar days.'
          }}
        </p>
      </div>
      <strong>{{ total }} {{ chinese ? '次复习' : 'ratings' }}</strong>
    </header>
    <ol class="review-heatmap-grid">
      <li
        v-for="day in days"
        :key="day.key"
        :data-level="day.count === 0 ? 0 : day.count < 5 ? 1 : 2"
        :aria-label="`${dateLabel(day.date)}: ${day.count} ${chinese ? '次复习' : 'ratings'}`"
      >
        <span>{{ day.date.getDate() }}</span
        ><strong>{{ day.count }}</strong>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.review-heatmap {
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
  margin-top: 0.375rem;
  color: var(--ui-text-muted);
  line-height: var(--line-height-reading);
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
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
}
</style>
