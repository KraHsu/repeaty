<script setup lang="ts">
import { ref } from 'vue'
import { t } from './i18n'
import { PracticeHistory, UiButton, UiCollapsible } from '@repeaty/plugin-api'
import type { PracticeHistoryProps } from '@repeaty/plugin-api'
import { problemSchema } from './model'
import Statement from './Statement.vue'
import type { Practice } from '@repeaty/plugin-api'
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
      <UiCollapsible
        v-if="statement(practice) !== undefined"
        @update:open="
          (open) => {
            if (open) shown.add(practice.id)
            else shown.delete(practice.id)
          }
        "
      >
        <UiButton variant="ghost">{{ t('当时的题目') }}</UiButton>
        <template #content
          ><Statement v-if="shown.has(practice.id)" :content="statement(practice)!"
        /></template>
      </UiCollapsible>
    </template>
  </PracticeHistory>
</template>
