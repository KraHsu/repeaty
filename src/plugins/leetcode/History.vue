<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../../i18n'
import PracticeHistory from '../../components/PracticeHistory.vue'
import type { PracticeHistoryProps } from '../types'
import { problemSchema } from './model'
import Statement from './Statement.vue'
const props = defineProps<PracticeHistoryProps>()
const emit = defineEmits<{ reveal: [practiceId: string] }>()
const shown = ref(new Set<string>())
const statements = computed(
  () =>
    new Map(
      props.practices.flatMap((practice) => {
        const problem = problemSchema.safeParse(practice.question.plugin.data)
        return problem.success ? [[practice.id, problem.data.content] as const] : []
      }),
    ),
)
</script>
<template>
  <PracticeHistory v-bind="props" class="leetcode-history" @reveal="emit('reveal', $event)">
    <template #question="{ practice }">
      <details
        v-if="statements.has(practice.id)"
        @toggle="
          (event) => {
            if ((event.target as HTMLDetailsElement).open) shown.add(practice.id)
            else shown.delete(practice.id)
          }
        "
      >
        <summary>{{ t('当时的题目') }}</summary>
        <Statement v-if="shown.has(practice.id)" :content="statements.get(practice.id)!" />
      </details>
    </template>
  </PracticeHistory>
</template>
