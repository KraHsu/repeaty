<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AppPage,
  UiButton,
  UiNotice,
  UiSelect,
  UiStatus,
  locale,
  study,
  type StudyStatisticsDay,
  type StudyStatisticsDetails,
  type StudyStatisticsDetailKind,
  type StudyStatisticsSnapshot,
} from '@repeaty/plugin-api'
import {
  calendarCells,
  displayDate,
  dueDateLabel,
  localDateKey,
  monthTotals,
  nextBoundary,
  shiftDay,
  statisticsWindow,
} from './calendar'
import { duration, text } from './text'

const props = defineProps<{ workspaceScope: string }>()
const snapshot = ref<StudyStatisticsSnapshot>()
const details = ref<StudyStatisticsDetails>()
const error = ref(''),
  detailError = ref('')
const loading = ref(false),
  detailsLoading = ref(false)
const initialDay = localDateKey(new Date())
const selectedDay = ref(initialDay),
  selectedMonth = ref(initialDay.slice(0, 7))
const detailKind = ref<StudyStatisticsDetailKind>('reviews')
const grid = ref<HTMLElement>()
let alive = true,
  controller: AbortController | undefined,
  detailController: AbortController | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  refreshTimer: ReturnType<typeof setTimeout> | undefined,
  unsubscribe: (() => void) | undefined
const today = computed(() => snapshot.value?.today ?? initialDay)
const windowRange = computed(() => statisticsWindow(today.value))
const months = computed(() => windowRange.value.months)
const monthIndex = computed(() => months.value.indexOf(selectedMonth.value))
const cells = computed(() => calendarCells(selectedMonth.value))
const byDay = computed(() => new Map(snapshot.value?.days.map((day) => [day.day, day]) ?? []))
const selected = computed(() => byDay.value.get(selectedDay.value))
const totals = computed(() => monthTotals(snapshot.value?.days ?? [], selectedMonth.value))
const futureMonth = computed(() => selectedMonth.value > today.value.slice(0, 7))
const numbers = computed(() => new Intl.NumberFormat(locale.value))
const monthFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }),
)
const dayFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { month: 'long', day: 'numeric', weekday: 'long' }),
)
const timeFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }),
)
const weekdays = computed(() => {
  const format = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  return Array.from({ length: 7 }, (_, index) => format.format(new Date(2026, 9, 26 + index, 12)))
})
const monthOptions = computed(() =>
  months.value.map((month) => ({
    value: month,
    label: monthFormat.value.format(displayDate(`${month}-01`)),
  })),
)
const kinds = computed(() => {
  const values: StudyStatisticsDetailKind[] =
    selectedDay.value > today.value
      ? ['scheduledCards', 'scheduledReadings']
      : selectedDay.value === today.value
        ? ['reviews', 'readings', 'practices', 'scheduledCards', 'scheduledReadings']
        : ['reviews', 'readings', 'practices']
  return values.map((value) => ({
    value,
    label: `${text(value)} · ${count(selected.value?.[value] ?? null)}`,
  }))
})
const actualCount = (day: StudyStatisticsDay | undefined) => {
  if (!day) return null
  const known = day.reviews + (day.readings ?? 0) + (day.practices ?? 0)
  return known || (day.readings !== null && day.practices !== null) ? known : null
}
const planCount = (day: StudyStatisticsDay | undefined) =>
  day ? day.scheduledCards + day.scheduledReadings : 0
function count(value: number | null) {
  return value === null ? '—' : numbers.value.format(value)
}
function dayLabel(day: string) {
  const record = byDay.value.get(day)
  return `${dayFormat.value.format(displayDate(day))} · ${day > today.value ? `${text('scheduled')}: ${planCount(record)}` : `${text('reviews')}: ${count(record?.reviews ?? null)}; ${text('readings')}: ${count(record?.readings ?? null)}; ${text('practices')}: ${count(record?.practices ?? null)}`}`
}
function keepDayInMonth(month: string) {
  if (selectedDay.value.startsWith(`${month}-`)) return
  selectedDay.value = month === today.value.slice(0, 7) ? today.value : `${month}-01`
}
function moveMonth(offset: number) {
  const next = months.value[monthIndex.value + offset]
  if (next) selectedMonth.value = next
}
function chooseToday() {
  selectedMonth.value = today.value.slice(0, 7)
  selectedDay.value = today.value
}
function choose(day: string) {
  selectedDay.value = day
}
async function keyDay(event: KeyboardEvent, day: string) {
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  }
  let next: string | undefined
  if (event.key in offsets) next = shiftDay(day, offsets[event.key]!)
  else if (event.key === 'Home') next = `${selectedMonth.value}-01`
  else if (event.key === 'End')
    next = cells.value.filter((entry): entry is string => !!entry).at(-1)
  else if (event.key === 'PageUp' || event.key === 'PageDown') {
    const month = months.value[monthIndex.value + (event.key === 'PageUp' ? -1 : 1)]
    if (month) next = `${month}-01`
  } else return
  event.preventDefault()
  if (!next || next < windowRange.value.from || next > windowRange.value.to) return
  selectedMonth.value = next.slice(0, 7)
  selectedDay.value = next
  await nextTick()
  grid.value?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus()
}
function scheduleBoundary() {
  clearTimeout(timer)
  const now = new Date()
  timer = setTimeout(
    () => void refresh(),
    nextBoundary(now, snapshot.value?.dayStartHour ?? 0).getTime() - now.getTime() + 10,
  )
}
async function refresh() {
  controller?.abort()
  const pending = new AbortController()
  controller = pending
  const scope = props.workspaceScope
  loading.value = true
  error.value = ''
  try {
    let query = statisticsWindow(snapshot.value?.today ?? localDateKey(new Date()))
    let result = await study.statistics({ from: query.from, to: query.to }, pending.signal)
    const aligned = statisticsWindow(result.today)
    // On the first day of a month, the configured study day can still be in the
    // previous month. Align the full window once using the host's day boundary.
    if (aligned.from !== query.from) {
      query = aligned
      result = await study.statistics({ from: query.from, to: query.to }, pending.signal)
    }
    if (!alive || pending.signal.aborted || scope !== props.workspaceScope) return
    if (result.workspaceScope !== scope) throw new Error(text('scopeChanged'))
    const first = !snapshot.value
    snapshot.value = result
    if (first || !statisticsWindow(result.today).months.includes(selectedMonth.value)) chooseToday()
    scheduleBoundary()
    await loadDetails()
  } catch (reason) {
    if (!alive || pending.signal.aborted || scope !== props.workspaceScope) return
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (controller === pending) loading.value = false
  }
}
async function loadDetails(more = false) {
  if (!snapshot.value) return
  detailController?.abort()
  const pending = new AbortController()
  detailController = pending
  const scope = props.workspaceScope,
    day = selectedDay.value,
    kind = detailKind.value
  const previous = more ? details.value : undefined
  const offset = previous?.nextOffset ?? 0
  detailsLoading.value = true
  detailError.value = ''
  if (!more && (details.value?.day !== day || details.value?.kind !== kind))
    details.value = undefined
  try {
    const result = await study.statisticsDetails({ day, kind, offset, limit: 20 }, pending.signal)
    if (
      !alive ||
      pending.signal.aborted ||
      scope !== props.workspaceScope ||
      day !== selectedDay.value ||
      kind !== detailKind.value
    )
      return
    if (result.workspaceScope !== scope) throw new Error(text('scopeChanged'))
    if (previous && result.revision !== previous.revision) throw new Error(text('changed'))
    details.value = previous
      ? { ...result, offset: 0, items: [...previous.items, ...result.items] }
      : result
  } catch (reason) {
    if (!alive || pending.signal.aborted || scope !== props.workspaceScope) return
    detailError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (detailController === pending) detailsLoading.value = false
  }
}
watch(selectedMonth, keepDayInMonth)
watch([selectedDay, kinds], () => {
  if (!kinds.value.some((kind) => kind.value === detailKind.value))
    detailKind.value = kinds.value[0]!.value
})
watch([selectedDay, detailKind], () => void loadDetails())
watch(
  () => props.workspaceScope,
  () => {
    controller?.abort()
    detailController?.abort()
    snapshot.value = undefined
    details.value = undefined
    error.value = ''
    detailError.value = ''
    void refresh()
  },
)
function focusRefresh() {
  if (document.visibilityState === 'visible') void refresh()
}
onMounted(() => {
  void refresh()
  unsubscribe = study.subscribe(() => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 150)
  })
  window.addEventListener('focus', focusRefresh)
  document.addEventListener('visibilitychange', focusRefresh)
})
onBeforeUnmount(() => {
  alive = false
  controller?.abort()
  detailController?.abort()
  clearTimeout(timer)
  clearTimeout(refreshTimer)
  unsubscribe?.()
  window.removeEventListener('focus', focusRefresh)
  document.removeEventListener('visibilitychange', focusRefresh)
})
</script>

<template>
  <AppPage :title="text('title')" :description="text('description')" class="study-statistics">
    <template #actions
      ><UiButton :busy="loading" @click="refresh">{{ text('refresh') }}</UiButton></template
    >
    <UiNotice v-if="error" tone="error" :title="text('failed')">
      {{ error }} <span v-if="snapshot">{{ text('retained') }}</span>
      <template #actions
        ><UiButton @click="refresh">{{ text('retry') }}</UiButton></template
      >
    </UiNotice>
    <p v-if="loading && !snapshot" role="status">{{ text('loading') }}</p>
    <template v-if="snapshot">
      <div class="statistics-toolbar">
        <div class="statistics-month-controls">
          <UiButton
            icon
            :aria-label="text('previous')"
            :disabled="monthIndex <= 0"
            @click="moveMonth(-1)"
            >‹</UiButton
          >
          <div class="statistics-month-select">
            <UiSelect v-model="selectedMonth" :items="monthOptions" :aria-label="text('month')" />
          </div>
          <UiButton
            icon
            :aria-label="text('next')"
            :disabled="monthIndex >= months.length - 1"
            @click="moveMonth(1)"
            >›</UiButton
          >
          <UiButton variant="ghost" @click="chooseToday">{{ text('today') }}</UiButton>
        </div>
        <p class="statistics-boundary">
          {{ text('dayStarts') }} {{ String(snapshot.dayStartHour).padStart(2, '0') }}:00
        </p>
      </div>
      <section v-if="!futureMonth" class="statistics-summary" :aria-label="text('monthRecord')">
        <div class="statistics-time">
          <span>{{ text('foreground') }}</span
          ><strong>{{ duration(totals.foregroundMs) }}</strong>
        </div>
        <dl>
          <div>
            <dt>{{ text('reviews') }}</dt>
            <dd>{{ count(totals.reviews) }}</dd>
          </div>
          <div>
            <dt>{{ text('readings') }}</dt>
            <dd>{{ count(totals.readings) }}</dd>
          </div>
          <div>
            <dt>{{ text('practices') }}</dt>
            <dd>{{ count(totals.practices) }}</dd>
          </div>
        </dl>
      </section>
      <section
        v-else
        class="statistics-summary statistics-plan-summary"
        :aria-label="text('scheduled')"
      >
        <dl>
          <div>
            <dt>{{ text('scheduledCards') }}</dt>
            <dd>{{ count(totals.scheduledCards) }}</dd>
          </div>
          <div>
            <dt>{{ text('scheduledReadings') }}</dt>
            <dd>{{ count(totals.scheduledReadings) }}</dd>
          </div>
        </dl>
        <p>{{ text('futureNote') }}</p>
      </section>
      <div class="statistics-workbench app-section-divider">
        <section class="statistics-calendar" :aria-label="text('keyboard')">
          <div class="statistics-legend">
            <span class="recorded">{{ text('recorded') }}</span
            ><span class="planned">{{ text('scheduled') }}</span>
          </div>
          <div class="statistics-weekdays" aria-hidden="true">
            <span v-for="day in weekdays" :key="day">{{ day }}</span>
          </div>
          <div ref="grid" class="statistics-days">
            <template v-for="(day, index) in cells" :key="day ?? `empty-${index}`">
              <UiButton
                v-if="day"
                variant="ghost"
                class="statistics-day"
                :class="{
                  'is-selected': day === selectedDay,
                  'is-today': day === today,
                  'is-future': day > today,
                }"
                :data-day="day"
                :aria-label="dayLabel(day)"
                :aria-pressed="day === selectedDay"
                :aria-current="day === today ? 'date' : undefined"
                :tabindex="day === selectedDay ? 0 : -1"
                @click="choose(day)"
                @keydown="keyDay($event, day)"
              >
                <span class="statistics-day-number">{{ Number(day.slice(-2)) }}</span>
                <span
                  class="statistics-day-count"
                  :class="{ 'has-record': (actualCount(byDay.get(day)) ?? 0) > 0 && day <= today }"
                >
                  <template v-if="day > today">{{ count(planCount(byDay.get(day))) }}</template>
                  <template v-else>{{ count(actualCount(byDay.get(day))) }}</template>
                </span>
                <span
                  v-if="day > today || actualCount(byDay.get(day)) !== null"
                  class="statistics-day-unit"
                  >{{ day > today ? text('planUnit') : text('completionUnit') }}</span
                >
              </UiButton>
              <span v-else class="statistics-blank" aria-hidden="true" />
            </template>
          </div>
        </section>
        <section
          class="statistics-detail app-section-divider"
          :aria-label="text('dailyDetails')"
          :aria-busy="detailsLoading"
        >
          <header>
            <div>
              <p>{{ selectedDay }}</p>
              <h2>{{ dayFormat.format(displayDate(selectedDay)) }}</h2>
            </div>
            <UiStatus :tone="selectedDay > today ? 'neutral' : 'success'">{{
              selectedDay > today ? text('scheduled') : text('recorded')
            }}</UiStatus>
          </header>
          <dl class="statistics-day-time" v-if="selectedDay <= today">
            <div>
              <dt>{{ text('foreground') }}</dt>
              <dd>{{ duration(selected?.foregroundMs ?? null) }}</dd>
            </div>
            <div>
              <dt>{{ text('readingTime') }}</dt>
              <dd>{{ duration(selected?.readingMs ?? null) }}</dd>
            </div>
            <div>
              <dt>{{ text('reviewTime') }}</dt>
              <dd>{{ duration(selected?.reviewMs ?? null) }}</dd>
            </div>
            <div>
              <dt>{{ text('practiceTime') }}</dt>
              <dd>{{ duration(selected?.practiceMs ?? null) }}</dd>
            </div>
          </dl>
          <UiSelect v-model="detailKind" :items="kinds" :aria-label="text('detailKind')" />
          <UiNotice v-if="detailError" tone="error">
            {{ detailError }}
            <template #actions
              ><UiButton @click="loadDetails()">{{ text('retry') }}</UiButton></template
            >
          </UiNotice>
          <p v-else-if="detailsLoading && !details" role="status">{{ text('detailsLoading') }}</p>
          <template v-if="details">
            <ol class="statistics-detail-list" v-if="details.items.length">
              <li v-for="entry in details.items" :key="entry.id">
                <span>{{ entry.title }}</span>
                <time v-if="entry.occurredAt" :datetime="entry.occurredAt">{{
                  timeFormat.format(new Date(entry.occurredAt))
                }}</time>
                <time v-else-if="entry.dueAt" :datetime="entry.dueAt">{{
                  dueDateLabel(entry.dueAt)
                }}</time>
              </li>
            </ol>
            <p v-else class="statistics-empty">
              {{ detailKind.startsWith('scheduled') ? text('noPlanned') : text('noDetails') }}
            </p>
            <div class="statistics-detail-footer" v-if="details.items.length">
              <span
                >{{ count(details.items.length) }} / {{ count(details.total) }}
                {{ text('items') }}</span
              >
              <UiButton
                v-if="details.nextOffset !== undefined"
                :busy="detailsLoading"
                @click="loadDetails(true)"
                >{{ text('more') }}</UiButton
              >
            </div>
          </template>
        </section>
      </div>
      <footer class="statistics-notes">
        <p>{{ text('planNote') }}</p>
        <p>{{ text('coverageNote') }}</p>
        <p>{{ text('activityNote') }}</p>
      </footer>
    </template>
  </AppPage>
</template>

<style scoped>
.study-statistics {
  color: var(--ink);
  container-type: inline-size;
}
.statistics-toolbar,
.statistics-month-controls,
.statistics-summary,
.statistics-detail > header,
.statistics-detail-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.statistics-toolbar {
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.statistics-month-controls {
  justify-content: flex-start;
  gap: 0.5rem;
  flex-wrap: wrap;
  width: max-content;
  max-width: 100%;
}
.statistics-month-controls > .ui-button {
  flex-shrink: 0;
  white-space: nowrap;
}
.statistics-month-controls :deep([data-slot='base']) {
  font-variant-numeric: tabular-nums;
}
.statistics-month-select {
  width: 11rem;
  max-width: 100%;
  flex: 0 0 11rem;
  min-width: 0;
}
.statistics-month-select :deep([role='combobox']) {
  width: 100%;
}
.statistics-boundary,
.statistics-notes,
.statistics-legend,
.statistics-detail-footer,
.statistics-detail > header p {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.statistics-boundary {
  margin: 0;
}
.statistics-summary {
  justify-content: flex-start;
  gap: 3rem;
  flex-wrap: wrap;
}
.statistics-time {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.statistics-time > span,
.statistics-summary dt {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.statistics-time > strong {
  color: var(--green);
  font-size: 1.8rem;
  line-height: 1.25;
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.statistics-summary dl {
  display: flex;
  flex-wrap: wrap;
  gap: 2.5rem;
  margin: 0;
}
.statistics-summary dd {
  margin: 0.35rem 0 0;
  font-size: 1.4rem;
  font-variant-numeric: tabular-nums;
}
.statistics-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(17rem, 1fr);
  column-gap: 2rem;
  align-items: start;
}
.statistics-calendar {
  min-width: 0;
}
.statistics-legend {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1rem;
}
.statistics-legend > span {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.statistics-legend > span::before {
  content: '';
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  border: 1px solid var(--green);
}
.statistics-legend > .recorded::before {
  background: var(--green);
}
.statistics-weekdays,
.statistics-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.35rem;
}
.statistics-weekdays {
  margin-bottom: 0.5rem;
  text-align: center;
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.statistics-day {
  min-width: 0;
  width: 100%;
  min-height: 5.5rem;
  padding: 0.55rem 0.4rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  border: 1px solid transparent;
  color: var(--ink);
  font-weight: var(--font-weight-regular);
}
.statistics-day-number {
  align-self: flex-start;
  font-size: var(--font-size-meta);
  line-height: 1.2;
}
.statistics-day-count {
  font-size: 1.2rem;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.statistics-day-count.has-record {
  color: var(--green);
  font-weight: var(--font-weight-semibold);
}
.statistics-day-unit {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.statistics-day.is-future {
  border-color: var(--line);
  border-style: dashed;
}
.statistics-day.is-today .statistics-day-number {
  font-weight: var(--font-weight-semibold);
  color: var(--green);
}
.statistics-day.is-selected {
  background: var(--app-nav-active);
  border-color: var(--green);
  border-style: solid;
}
.statistics-detail {
  min-width: 0;
  border-left: 1px solid var(--line);
  padding-left: 2rem;
}
.statistics-detail > header {
  align-items: flex-start;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
}
.statistics-detail h2 {
  font-size: var(--font-size-section);
  line-height: var(--line-height-heading);
  margin: 0.35rem 0 0;
  font-weight: var(--font-weight-semibold);
}
.statistics-detail > header p {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.statistics-day-time {
  margin: 0 0 1.25rem;
  display: grid;
  gap: 0.65rem;
}
.statistics-day-time > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  font-size: var(--font-size-meta);
}
.statistics-day-time dt {
  color: var(--muted);
}
.statistics-day-time dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.statistics-detail > [role='combobox'] {
  width: 100%;
}
.statistics-plan-summary > p {
  color: var(--muted);
  font-size: var(--font-size-meta);
  max-width: 28rem;
  margin: 0;
}
.statistics-detail-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0;
  max-height: 23rem;
  overflow: auto;
}
.statistics-detail-list li {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.8rem 0;
  border-bottom: 1px solid var(--line);
  font-size: var(--font-size-meta);
}
.statistics-detail-list li > :first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.statistics-detail-list time,
.statistics-detail-list li > :last-child:not(:first-child) {
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.statistics-detail-footer {
  margin-top: 1rem;
  flex-wrap: wrap;
}
.statistics-empty {
  color: var(--muted);
  padding: 1.5rem 0;
  font-size: var(--font-size-body);
}
.statistics-notes {
  margin-top: 2rem;
  max-width: 65rem;
  line-height: var(--line-height-ui);
}
.statistics-notes p {
  margin: 0.5rem 0;
}
@container (width > 60rem) {
  .statistics-detail {
    border-block-start: 0;
    margin-block-start: 0;
    padding-block-start: 0;
  }
}
@container (max-width: 60rem) {
  .statistics-workbench {
    grid-template-columns: 1fr;
  }
  .statistics-detail {
    border-left: 0;
    padding-left: 0;
  }
  .statistics-day {
    min-height: 5rem;
  }
}
@media (max-width: 600px) {
  .statistics-summary {
    gap: 1.5rem;
  }
  .statistics-summary dl {
    gap: 1.5rem;
  }
  .statistics-month-controls {
    flex-wrap: wrap;
  }
  .statistics-day {
    min-height: 4.6rem;
    padding: 0.4rem 0.2rem;
  }
  .statistics-day-unit {
    font-size: var(--font-size-meta);
  }
  .statistics-days {
    gap: 0.2rem;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .statistics-day {
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }
  .statistics-day:active {
    transform: translateY(1px);
  }
}
</style>
