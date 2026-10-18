<script setup lang="ts">
import { computed } from 'vue'
import { t, locale } from '../i18n'
import type { Attempt } from '../core/practice-data'
import type { PracticeHistoryProps } from '../plugins/types'
const props = defineProps<PracticeHistoryProps>()
const emit = defineEmits<{ reveal: [practiceId: string] }>()
const sessions = computed(() => {
  const grouped = new Map<string, Attempt[]>()
  for (const attempt of props.attempts) {
    const group = grouped.get(attempt.practiceId) ?? []
    group.push(attempt)
    grouped.set(attempt.practiceId, group)
  }
  return [...props.practices].reverse().map((practice) => ({
    practice,
    attempts: grouped.get(practice.id) ?? [],
  }))
})
const statusNames = {
  submitting: '正在提交',
  pending: '等待判题',
  completed: '判题结束',
  unknown: '提交状态未知',
  failed: '提交失败',
} as const
const gradeNames = { 1: '重来', 2: '困难', 3: '良好', 4: '简单' } as const
function timestamp(value: string) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  )
}
</script>
<template>
  <component
    :is="standalone ? 'div' : 'details'"
    v-if="sessions.length"
    class="practice-history-list"
    :class="{ standalone }"
  >
    <summary v-if="!standalone">
      {{ t('提交历史') }} <span class="muted">{{ sessions.length }}</span>
    </summary>
    <p v-if="!standalone" class="form-note">
      {{ t('历史代码可展开查看。复习时查看往次代码会计为查看答案。') }}
    </p>
    <section v-for="{ practice, attempts } in sessions" :key="practice.id" class="practice-history">
      <header>
        <strong>{{
          practice.id === activeId ? t('本次练习') : timestamp(practice.startedAt)
        }}</strong>
        <span v-if="practice.ratingUndoneAt">{{ t('评分已撤销') }}</span>
        <span v-else-if="practice.rating">{{
          t('复习评分：{grade}', { grade: t(gradeNames[practice.rating]) })
        }}</span>
        <span v-else-if="practice.completion === 'practice'">{{ t('仅练习') }}</span>
        <span v-else>{{ t('尚未评分') }}</span>
      </header>
      <p>{{ practice.question.front }}</p>
      <slot name="question" :practice="practice" />
      <p v-if="!attempts.length" class="form-note">{{ t('暂无提交记录。') }}</p>
      <details
        v-for="(attempt, index) in attempts"
        :key="attempt.id"
        class="attempt-history"
        @toggle="
          (event) => {
            if ((event.target as HTMLDetailsElement).open) emit('reveal', practice.id)
          }
        "
      >
        <summary>
          <strong>{{ t('第 {count} 次提交', { count: index + 1 }) }}</strong>
          <span>{{ t(attempt.result?.status ?? statusNames[attempt.status]) }}</span>
          <span class="muted">{{ attempt.language }}</span>
        </summary>
        <p class="form-note">{{ timestamp(attempt.submittedAt) }}</p>
        <p v-if="attempt.submissionId">{{ t('提交编号：{id}', { id: attempt.submissionId }) }}</p>
        <p v-if="attempt.result?.runtime">
          {{ t('运行时间：{value}', { value: attempt.result.runtime }) }}
        </p>
        <p v-if="attempt.result?.memory">
          {{ t('内存：{value}', { value: attempt.result.memory }) }}
        </p>
        <pre v-if="attempt.result?.detail" class="attempt-code">{{ attempt.result.detail }}</pre>
        <pre class="attempt-code"><code>{{ attempt.code }}</code></pre>
      </details>
    </section>
  </component>
</template>
<style scoped>
.practice-history-list {
  margin: 1.5rem 0;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  font-size: 1rem;
}
.standalone {
  margin: 0;
}
.practice-history p {
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  line-height: 1.65;
}
.practice-history {
  padding: 1rem 0;
}
.practice-history + .practice-history {
  border-top: 1px solid var(--line);
}
.practice-history header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.attempt-history {
  padding: 0.5rem 0;
}
.attempt-history summary > * {
  margin-right: 0.75rem;
}
.attempt-code {
  max-width: 100%;
  max-height: 24rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 1rem;
  background: var(--paper, #f7f8f4);
  border: 1px solid var(--line);
  border-radius: 8px;
  font:
    0.9375rem/1.6 ui-monospace,
    monospace;
}
</style>
