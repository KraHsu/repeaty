<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  AppPage,
  UiButton,
  UiNotice,
  UiSelect,
  UiStatus,
  UiProgress,
  locale,
} from '@repeaty/plugin-api'
import { optimizer } from './model'
import { errorText, text } from './text'

const props = defineProps<{ workspaceScope: string }>()
const { state, selectedDeck, phase, progress, error, message, loading, busy, option } = optimizer
const scopeMatches = computed(() => state.value?.workspaceScope === props.workspaceScope)
const models = computed(() =>
  scopeMatches.value
    ? (state.value?.models.filter((model) => model.deckId === (selectedDeck.value || undefined)) ??
      [])
    : [],
)
const active = computed(() => models.value.find((model) => model.id === state.value?.activeModelId))
const freshCandidate = computed(() =>
  message.value === 'candidate' && !error.value ? models.value.at(-1)?.id : undefined,
)
const choices = computed(() => [
  { value: '', label: text('library') },
  ...(state.value?.decks ?? []).map((deck) => ({ value: deck.id, label: deck.name })),
])
const numbers = computed(() => new Intl.NumberFormat(locale.value))
const dates = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)
const count = (value: number) => numbers.value.format(value)
const date = (value: string) => dates.value.format(new Date(value))
const phaseLabel = computed(() =>
  phase.value === 'idle' ? '' : text(phase.value === 'rollback' ? 'rollbackPhase' : phase.value),
)
async function retry() {
  await optimizer.start()
  await optimizer.refresh()
}
onMounted(() => {
  void retry()
})
</script>

<template>
  <AppPage :title="text('title')" :description="text('description')" class="optimizer-page">
    <template #actions>
      <UiButton v-if="phase === 'activating' || phase === 'rollback'" busy>{{
        phaseLabel
      }}</UiButton>
      <UiButton v-else-if="busy" @click="optimizer.cancel()">{{ text('cancel') }}</UiButton>
      <UiButton
        v-else
        :variant="freshCandidate ? 'secondary' : 'primary'"
        :disabled="loading || !scopeMatches || (state?.reviewCount ?? 0) < 1024"
        @click="optimizer.train()"
        >{{ text('train') }}</UiButton
      >
    </template>
    <UiNotice v-if="error" tone="error" role="alert"
      >{{ errorText(error) }}
      <UiButton v-if="!state && !busy" variant="ghost" @click="retry()">{{
        text('retry')
      }}</UiButton></UiNotice
    >
    <UiNotice
      v-else-if="message"
      :tone="message === 'cancelled' ? 'info' : 'success'"
      role="status"
      >{{ text(message) }}</UiNotice
    >
    <div class="optimizer-scope">
      <label for="optimizer-scope">{{ text('scope') }}</label>
      <div class="optimizer-scope-select">
        <UiSelect
          id="optimizer-scope"
          :model-value="selectedDeck"
          :items="choices"
          :disabled="busy || loading"
          @update:model-value="optimizer.select(String($event))"
        />
      </div>
      <span class="optimizer-muted">{{ text('local') }}</span>
    </div>
    <div v-if="loading && !state" class="optimizer-muted" role="status">{{ text('loading') }}</div>
    <template v-if="scopeMatches">
      <section class="optimizer-current" :aria-label="text('current')">
        <div class="optimizer-readiness">
          <p class="optimizer-count">
            {{ count(state?.reviewCount ?? 0) }} <span>{{ text('records') }}</span>
          </p>
          <p class="optimizer-muted">{{ text('threshold') }}</p>
        </div>
        <div class="optimizer-baseline">
          <span class="optimizer-muted">{{ text('current') }}</span>
          <strong>{{ active ? date(active.createdAt) : text('defaults') }}</strong>
          <UiButton v-if="active" :disabled="busy" @click="optimizer.rollback(active.id)">{{
            text('rollback')
          }}</UiButton>
        </div>
        <p class="optimizer-unchanged">{{ text('unchanged') }}</p>
      </section>
      <section v-if="busy" class="optimizer-progress" aria-live="polite" :aria-label="phaseLabel">
        <div>
          <strong>{{ phaseLabel }}</strong
          ><span v-if="progress && phase === 'training'"
            >{{ Math.round((progress.current / progress.total) * 100) }}%</span
          >
        </div>
        <UiProgress
          :model-value="phase === 'training' && progress ? progress.current : null"
          :max="progress?.total || 100"
          :aria-label="phaseLabel"
        />
      </section>
      <section class="optimizer-results" :aria-label="text('comparison')">
        <h2>{{ text('comparison') }}</h2>
        <p class="optimizer-muted">{{ text('comparisonHint') }}</p>
        <div v-if="!models.length" class="optimizer-empty">
          <strong>{{ text('empty') }}</strong>
          <p class="optimizer-muted">{{ text('emptyHint') }}</p>
        </div>
        <div v-else class="optimizer-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ text('date') }}</th>
                <th>
                  {{ text('loss') }}<small>{{ text('beforeAfter') }}</small>
                </th>
                <th>
                  {{ text('rmse') }}<small>{{ text('beforeAfter') }}</small>
                </th>
                <th>{{ text('samples') }}</th>
                <th>
                  <span class="optimizer-sr-only">{{ text('adopt') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="model in models" :key="model.id">
                <td :data-label="text('date')">{{ date(model.createdAt) }}</td>
                <td :data-label="text('loss')">
                  <span class="optimizer-muted">{{
                    model.metrics.baseline.logLoss.toFixed(4)
                  }}</span
                  ><span aria-hidden="true"> → </span
                  ><strong>{{ model.metrics.candidate.logLoss.toFixed(4) }}</strong>
                </td>
                <td :data-label="text('rmse')">
                  <span class="optimizer-muted">{{ model.metrics.baseline.rmse.toFixed(4) }}</span
                  ><span aria-hidden="true"> → </span
                  ><strong>{{ model.metrics.candidate.rmse.toFixed(4) }}</strong>
                </td>
                <td :data-label="text('samples')">
                  {{ count(model.counts.training) }} / {{ count(model.counts.validation) }}
                </td>
                <td>
                  <UiStatus v-if="model.id === state?.activeModelId" tone="success">{{
                    text('active')
                  }}</UiStatus
                  ><UiButton
                    v-else
                    :variant="model.id === freshCandidate ? 'primary' : 'secondary'"
                    :disabled="busy"
                    @click="optimizer.activate(model.id)"
                    >{{ text('adopt') }}</UiButton
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p v-if="option.automatic" class="optimizer-muted optimizer-automatic">
        {{ text('automaticOn') }} · {{ text(option.apply ? 'autoApplyOn' : 'autoCandidate') }}
      </p>
    </template>
  </AppPage>
</template>

<style scoped>
.optimizer-page {
  color: var(--ink);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  container-type: inline-size;
  gap: var(--space-5, 24px);
}
.optimizer-page > * {
  min-width: 0;
}
.optimizer-page p {
  margin: 0;
}
.optimizer-muted {
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: 1.65;
}
.optimizer-scope {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
  flex-wrap: wrap;
}
.optimizer-scope label {
  font-weight: 600;
}
.optimizer-scope-select {
  width: min(20rem, 100%);
  min-width: 0;
}
.optimizer-scope > .optimizer-muted {
  margin-left: auto;
}
.optimizer-current {
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 28px 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.8fr);
  gap: 20px 40px;
}
.optimizer-count {
  font-size: var(--font-size-display);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}
.optimizer-count span {
  font-size: var(--font-size-meta);
  font-weight: 400;
  letter-spacing: 0;
}
.optimizer-readiness {
  display: grid;
  align-content: center;
  gap: 8px;
}
.optimizer-baseline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.optimizer-baseline > .optimizer-muted {
  flex-basis: 100%;
}
.optimizer-baseline strong {
  font-size: var(--font-size-body);
  font-weight: 500;
}
.optimizer-unchanged {
  grid-column: 1/-1;
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.optimizer-progress {
  padding: 20px;
  background: var(--app-surface-subtle);
  border-radius: var(--radius-md, 12px);
  display: grid;
  gap: 12px;
}
.optimizer-progress > div {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-meta);
}
.optimizer-results h2 {
  font-size: var(--font-size-section);
  margin: 0 0 6px;
  font-weight: 600;
}
.optimizer-empty {
  padding: 40px 0;
  display: grid;
  gap: 8px;
}
.optimizer-empty strong {
  font-size: var(--font-size-body);
  font-weight: 500;
}
.optimizer-table-scroll {
  overflow-x: auto;
  margin-top: 20px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-meta);
}
th,
td {
  text-align: left;
  padding: 16px 14px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
th:first-child,
td:first-child {
  padding-left: 0;
}
th:last-child,
td:last-child {
  padding-right: 0;
  text-align: right;
}
th {
  font-weight: 500;
  color: var(--muted);
}
th small {
  display: block;
  font-size: var(--font-size-meta);
  font-weight: 400;
  margin-top: 5px;
}
td strong {
  font-weight: 600;
  color: var(--green);
}
.optimizer-automatic {
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
.optimizer-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
@container (max-width: 55rem) {
  .optimizer-current {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .optimizer-scope > .optimizer-muted {
    margin-left: 0;
    width: 100%;
  }
  .optimizer-baseline {
    border-top: 1px solid var(--line);
    padding-top: 20px;
  }
  .optimizer-unchanged {
    grid-column: auto;
  }
  thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  tbody,
  tr,
  td {
    display: block;
  }
  tbody tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    padding: 20px 0;
    border-bottom: 1px solid var(--line);
  }
  td,
  td:first-child,
  td:last-child {
    border: 0;
    padding: 0;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  td:first-child,
  td:last-child {
    grid-column: 1 / -1;
  }
  td::before {
    content: attr(data-label);
    display: block;
    color: var(--muted);
    margin-bottom: 8px;
  }
  td:last-child::before {
    display: none;
  }
}
</style>
