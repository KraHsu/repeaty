<script setup lang="ts">
import UCard from '@nuxt/ui/components/Card.vue'
import UCollapsible from '@nuxt/ui/components/Collapsible.vue'
import UPagination from '@nuxt/ui/components/Pagination.vue'
import { UiButton } from './ui'
import { computed, ref, watch } from 'vue'
import { t, locale } from '../i18n'
import type { AttemptRecord } from '../core/practice-data'
import type { PracticeHistoryProps } from '../plugins/types'
import AttemptBody from './AttemptBody.vue'
const props = defineProps<PracticeHistoryProps>()
const emit = defineEmits<{ reveal: [practiceId: string] }>()
const opened = ref(new Set<string>())
const historyOpen = ref(false)
const page = ref(1)
const pageSize = 20
const pages = computed(() => Math.max(1, Math.ceil(props.practices.length / pageSize)))
watch(pages, (count) => {
  page.value = Math.min(page.value, count)
})
watch(page, () => {
  opened.value = new Set()
})
const sessions = computed(() => {
  const grouped = new Map<string, AttemptRecord[]>()
  for (const attempt of props.attempts) {
    const group = grouped.get(attempt.practiceId) ?? []
    group.push(attempt)
    grouped.set(attempt.practiceId, group)
  }
  const ordered = [...props.practices].reverse()
  const visible = props.standalone
    ? ordered
    : ordered.slice((page.value - 1) * pageSize, page.value * pageSize)
  return visible.map((practice) => ({
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
  <UCard v-if="sessions.length" class="practice-history-list" :class="{ standalone }">
    <UCollapsible
      :open="standalone || historyOpen"
      @update:open="
        (value) => {
          historyOpen = value
          if (!value) opened.clear()
        }
      "
    >
      <template v-if="!standalone" #default>
        <UiButton variant="ghost" class="practice-history-trigger">
          {{ t('提交历史') }} <span class="muted">{{ practices.length }}</span>
        </UiButton>
      </template>
      <template #content>
        <p v-if="!standalone" class="form-note">
          {{ t('历史代码可展开查看。复习时查看往次代码会计为查看答案。') }}
        </p>
        <section
          v-for="{ practice, attempts } in sessions"
          :key="practice.id"
          class="practice-history"
        >
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
          <UCollapsible
            v-for="(attempt, index) in attempts"
            :key="attempt.id"
            class="attempt-history"
            :open="opened.has(attempt.id)"
            @update:open="
              (value) => {
                if (value) opened.add(attempt.id)
                else opened.delete(attempt.id)
              }
            "
          >
            <UiButton variant="ghost" class="attempt-history-trigger">
              <strong>{{ t('第 {count} 次提交', { count: index + 1 }) }}</strong>
              <span>{{ t(attempt.result?.status ?? statusNames[attempt.status]) }}</span>
              <span class="muted">{{ attempt.language }}</span>
            </UiButton>
            <template #content>
              <p class="form-note">{{ timestamp(attempt.submittedAt) }}</p>
              <AttemptBody
                v-if="opened.has(attempt.id)"
                :attempt="attempt"
                :get-attempt="getAttempt"
                @loaded="emit('reveal', practice.id)"
              />
            </template>
          </UCollapsible>
        </section>
        <nav v-if="!standalone && pages > 1" class="pagination" :aria-label="t('练习历史分页')">
          <UPagination
            v-model:page="page"
            :total="practices.length"
            :items-per-page="pageSize"
            :show-controls="false"
          >
            <template #prev
              ><UiButton :aria-label="t('上一页')">{{ t('上一页') }}</UiButton></template
            >
            <template #next
              ><UiButton :aria-label="t('下一页')">{{ t('下一页') }}</UiButton></template
            >
          </UPagination>
          <span role="status">{{ t('第 {page} / {pages} 页', { page, pages }) }}</span>
        </nav>
      </template>
    </UCollapsible>
  </UCard>
</template>
<style scoped>
.practice-history-list {
  margin: 1.5rem 0;
  font-size: var(--font-size-body);
}
.standalone {
  margin: 0;
}
.practice-history p {
  overflow-wrap: anywhere;
}
.practice-history-trigger,
.attempt-history-trigger {
  cursor: pointer;
  line-height: var(--line-height-ui);
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
.attempt-history-trigger > * {
  margin-right: 0.75rem;
}
</style>
