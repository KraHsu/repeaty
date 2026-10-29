<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, type PluginWidgetProps } from '@repeaty/plugin-api'
import { reviewCalendar, reviewLevel, type ReviewDay } from './review-days'
import { startDayClock } from './day-clock'
import { text } from './text'

const props = defineProps<PluginWidgetProps>()
const today = ref(new Date())
const calendar = computed(() => reviewCalendar(props.reviews, today.value))
const days = computed(() => calendar.value.days)
const total = computed(() => days.value.reduce((sum, day) => sum + day.count, 0))
const numbers = computed(() => new Intl.NumberFormat(locale.value))
const dates = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }),
)
const months = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'short' }))
const weekdays = computed(() => {
  const format = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  return [1, 3, 5].map((day) => ({ day, label: format.format(new Date(2026, 0, 4 + day)) }))
})
const countLabel = (count: number) => `${numbers.value.format(count)} ${text('ratingCount')}`
const dayLabel = (day: ReviewDay) => `${dates.value.format(day.date)}: ${countLabel(day.count)}`
const hoveredKey = ref<string>()
const focusedKey = ref<string>()
const tabKey = ref(days.value.at(-1)!.key)
const inspectedDay = computed(() =>
  days.value.find((day) => day.key === (hoveredKey.value ?? focusedKey.value)),
)
const scroll = ref<HTMLElement>()
const grid = ref<HTMLElement>()

function inspectDay(day: ReviewDay) {
  hoveredKey.value = undefined
  focusedKey.value = day.key
  tabKey.value = day.key
}

function focusDay(event: KeyboardEvent, index: number) {
  const offsets: Record<string, number> = {
    ArrowUp: -1,
    ArrowDown: 1,
    ArrowLeft: -7,
    ArrowRight: 7,
  }
  if (event.key === 'Escape') {
    hoveredKey.value = undefined
    focusedKey.value = undefined
    return
  }
  let target: number
  if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = days.value.length - 1
  else if (event.key in offsets) target = index + offsets[event.key]!
  else return
  event.preventDefault()
  hoveredKey.value = undefined
  const day = days.value[Math.max(0, Math.min(days.value.length - 1, target))]!
  focusedKey.value = day.key
  tabKey.value = day.key
  const button = grid.value?.querySelector<HTMLButtonElement>(`[data-date="${day.key}"]`)
  button?.focus({ preventScroll: true })
  // Only move the calendar viewport, never the surrounding learning overview.
  if (button && scroll.value) {
    const cell = button.getBoundingClientRect()
    const viewport = scroll.value.getBoundingClientRect()
    if (cell.left < viewport.left) scroll.value.scrollLeft += cell.left - viewport.left - 3
    if (cell.right > viewport.right) scroll.value.scrollLeft += cell.right - viewport.right + 3
  }
}

function showLatest() {
  if (scroll.value) scroll.value.scrollLeft = scroll.value.scrollWidth
}

// Date changes should follow today; review/undo updates must retain the inspected day.
watch(
  () => days.value.at(-1)!.key,
  async () => {
    tabKey.value = days.value.at(-1)!.key
    hoveredKey.value = undefined
    focusedKey.value = undefined
    await nextTick()
    showLatest()
  },
)

let stopClock: (() => void) | undefined
let resize: ResizeObserver | undefined
onMounted(() => {
  stopClock = startDayClock((date) => {
    today.value = date
  })
  showLatest()
  // Preserve older weeks while browsing, and keep the latest edge visible on resize.
  let previousWidth = scroll.value?.clientWidth ?? 0
  let previousScrollWidth = scroll.value?.scrollWidth ?? 0
  resize = new ResizeObserver(() => {
    const element = scroll.value
    if (!element) return
    const atEnd = previousScrollWidth - previousWidth - element.scrollLeft <= 2
    if (atEnd) showLatest()
    previousWidth = element.clientWidth
    previousScrollWidth = element.scrollWidth
  })
  if (scroll.value) resize.observe(scroll.value)
  if (grid.value) resize.observe(grid.value)
})
onUnmounted(() => {
  stopClock?.()
  resize?.disconnect()
})
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
    <div class="review-heatmap-chart">
      <div class="review-heatmap-weekdays" aria-hidden="true">
        <span v-for="weekday in weekdays" :key="weekday.day" :style="{ gridRow: weekday.day + 1 }">
          {{ weekday.label }}
        </span>
      </div>
      <div ref="scroll" class="review-heatmap-scroll">
        <div
          class="review-heatmap-calendar"
          :style="{ '--heatmap-weeks': calendar.cells.length / 7 }"
        >
          <div class="review-heatmap-months" aria-hidden="true">
            <span
              v-for="month in calendar.months"
              :key="month.key"
              :style="{ gridColumn: `${month.column + 1} / span 3` }"
              >{{ months.format(month.date) }}</span
            >
          </div>
          <div ref="grid" class="review-heatmap-grid" role="group" :aria-label="text('keyboard')">
            <template v-for="(day, index) in calendar.cells" :key="day?.key ?? `padding-${index}`">
              <button
                v-if="day"
                type="button"
                class="review-heatmap-day"
                :data-date="day.key"
                :data-level="reviewLevel(day.count)"
                :aria-label="dayLabel(day)"
                :title="dayLabel(day)"
                :tabindex="day.key === tabKey ? 0 : -1"
                @mouseenter="hoveredKey = day.key"
                @mouseleave="hoveredKey = undefined"
                @focus="inspectDay(day)"
                @blur="focusedKey = undefined"
                @click="inspectDay(day)"
                @keydown="focusDay($event, index - days[0]!.date.getDay())"
              ></button>
              <span v-else class="review-heatmap-padding" aria-hidden="true"></span>
            </template>
          </div>
        </div>
      </div>
    </div>
    <footer>
      <p class="review-heatmap-detail">
        <template v-if="inspectedDay">{{ dayLabel(inspectedDay) }}</template>
        <template v-else
          >{{ dates.format(days[0]!.date) }} – {{ dates.format(days.at(-1)!.date) }}</template
        >
      </p>
      <div
        class="review-heatmap-legend"
        role="img"
        :aria-label="text('legend')"
        :title="text('legend')"
      >
        <span>{{ text('less') }}</span>
        <span
          v-for="level in 5"
          :key="level"
          class="review-heatmap-swatch"
          :data-level="level - 1"
          aria-hidden="true"
        ></span>
        <span>{{ text('more') }}</span>
      </div>
    </footer>
    <p v-if="total === 0" class="review-heatmap-empty">{{ text('empty') }}</p>
  </section>
</template>

<style scoped>
.review-heatmap {
  container-type: inline-size;
  --heatmap-cell: clamp(
    0.8125rem,
    calc((100cqw - 3.25rem - 52 * var(--heatmap-gap)) / 53),
    1.125rem
  );
  --heatmap-gap: 0.1875rem;
  --heatmap-month-height: 1.75rem;
  --heatmap-zero: var(--ui-bg-elevated);
  --heatmap-full: var(--green);
  min-width: 0;
  padding: 1.5rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.875rem;
  background: var(--ui-bg);
  color: var(--ui-text);
}
.review-heatmap header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-bottom: 1.25rem;
}
.review-heatmap h2,
.review-heatmap p {
  margin: 0;
}
.review-heatmap h2 {
  font-size: var(--font-size-section);
}
.review-heatmap header p {
  margin-top: 0.375rem;
  font-size: var(--font-size-meta);
  color: var(--ui-text-muted);
}
.review-heatmap-total {
  font-size: var(--font-size-body);
  overflow-wrap: anywhere;
}
.review-heatmap-chart {
  display: flex;
  gap: 0.625rem;
  min-width: 0;
}
.review-heatmap-weekdays {
  display: grid;
  grid-template-rows: repeat(7, var(--heatmap-cell));
  gap: var(--heatmap-gap);
  margin-top: var(--heatmap-month-height);
  flex: none;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: var(--heatmap-cell);
}
.review-heatmap-scroll {
  min-width: 0;
  overflow-x: auto;
  padding: 3px;
  margin: -3px;
}
.review-heatmap-calendar {
  width: max-content;
}
.review-heatmap-months {
  display: grid;
  grid-template-columns: repeat(var(--heatmap-weeks), var(--heatmap-cell));
  column-gap: var(--heatmap-gap);
  height: var(--heatmap-month-height);
  color: var(--ui-text-muted);
  font-size: 0.75rem;
}
.review-heatmap-months span {
  white-space: nowrap;
}
.review-heatmap-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, var(--heatmap-cell));
  grid-auto-columns: var(--heatmap-cell);
  gap: var(--heatmap-gap);
}
.review-heatmap-day,
.review-heatmap-swatch {
  display: block;
  box-sizing: border-box;
  width: var(--heatmap-cell);
  height: var(--heatmap-cell);
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--ui-text) 8%, transparent);
  border-radius: 3px;
  background: var(--heatmap-zero);
}
[data-level='1'] {
  background: color-mix(in srgb, var(--heatmap-full) 25%, var(--heatmap-zero));
}
[data-level='2'] {
  background: color-mix(in srgb, var(--heatmap-full) 50%, var(--heatmap-zero));
}
[data-level='3'] {
  background: color-mix(in srgb, var(--heatmap-full) 75%, var(--heatmap-zero));
}
[data-level='4'] {
  background: var(--heatmap-full);
}
.review-heatmap-day {
  cursor: pointer;
}
.review-heatmap-day:hover,
.review-heatmap-day:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 1px;
}
.review-heatmap footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-top: 1rem;
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
}
.review-heatmap-detail {
  min-height: 1.5em;
  line-height: 1.5;
}
.review-heatmap-legend {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--heatmap-gap);
  margin-left: auto;
}
.review-heatmap-legend > :first-child {
  margin-right: 0.25rem;
}
.review-heatmap-legend > :last-child {
  margin-left: 0.25rem;
}
.review-heatmap .review-heatmap-empty {
  margin-top: 0.75rem;
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
}
@container (max-width: 28rem) {
  .review-heatmap-detail {
    min-height: 3em;
  }
}
</style>
