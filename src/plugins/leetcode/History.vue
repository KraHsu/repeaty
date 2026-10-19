<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../../i18n'
import PracticeHistory from '../../components/PracticeHistory.vue'
import type { PracticeHistoryProps } from '../types'
import { problemSchema } from './model'
import Statement from './Statement.vue'
import type { Practice } from '../../core/practice-data'
const props = defineProps<PracticeHistoryProps>()
const emit = defineEmits<{ reveal: [practiceId: string] }>()
const shown = ref(new Set<string>())
const statements = new WeakMap<Practice, string | undefined>()
function statement(practice: Practice) {
  if (!statements.has(practice)) {
    const problem = problemSchema.safeParse(practice.question.plugin.data)
    statements.set(practice, problem.success ? problem.data.content : undefined)
  }
  return statements.get(practice)
}
</script>
<template>
  <PracticeHistory v-bind="props" class="leetcode-history" @reveal="emit('reveal', $event)">
    <template #question="{ practice }">
      <details
        v-if="statement(practice) !== undefined"
        @toggle="
          (event) => {
            if ((event.target as HTMLDetailsElement).open) shown.add(practice.id)
            else shown.delete(practice.id)
          }
        "
      >
        <summary>{{ t('当时的题目') }}</summary>
        <Statement v-if="shown.has(practice.id)" :content="statement(practice)!" />
      </details>
    </template>
  </PracticeHistory>
</template>
