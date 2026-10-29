<script setup lang="ts">
import { UiInput, UiButton, UiCollapsible } from '@repeaty/plugin-api'

import { ref } from 'vue'
import { t, locale } from './i18n'
import type { Attempt, AttemptRecord } from '@repeaty/plugin-api'
import { AttemptBody } from '@repeaty/plugin-api'
const props = defineProps<{
  attempt: AttemptRecord
  getAttempt?: (id: string, signal?: AbortSignal) => Promise<Attempt>
  disabled: boolean
  recover: (attempt: AttemptRecord, input: string) => Promise<boolean>
}>()
const input = ref('')
const shown = ref(false)
</script>
<template>
  <form class="submission-recovery" @submit.prevent="props.recover(attempt, input)">
    <h3>{{ t('恢复未确认的提交') }}</h3>
    <p class="form-note">
      {{ attempt.language }} · {{ new Date(attempt.submittedAt).toLocaleString(locale) }}
    </p>
    <p>
      {{ t('在 LeetCode 找到这次提交，粘贴编号或详情链接。恢复只查询结果，不会重新提交代码。') }}
    </p>
    <UiCollapsible @update:open="shown = $event">
      <UiButton variant="ghost">{{ t('核对本次提交的代码') }}</UiButton>
      <template #content
        ><AttemptBody v-if="shown" :attempt="attempt" :get-attempt="getAttempt" code-only
      /></template>
    </UiCollapsible>
    <label :for="`recover-${attempt.id}`">{{ t('提交编号或详情链接') }}</label>
    <div class="recovery-fields">
      <UiInput
        class="min-w-0 flex-1"
        :id="`recover-${attempt.id}`"
        v-model="input"
        type="text"
        inputmode="text"
        autocomplete="off"
        spellcheck="false"
        maxlength="500"
        :disabled="disabled"
        :placeholder="t('粘贴提交编号或链接')"
        required
      />
      <UiButton type="submit" variant="secondary" :disabled="disabled || !input.trim()">
        {{ t('关联并查询') }}
      </UiButton>
    </div>
  </form>
</template>
<style scoped>
.submission-recovery {
  padding: 1.25rem;
  margin: 1.25rem 0;
  border: 1px solid var(--line);
  border-radius: 12px;
}
h3 {
  margin: 0;
  font-size: var(--font-size-section);
}
p {
  line-height: var(--line-height-ui);
}
details {
  margin-bottom: 1rem;
}
summary {
  cursor: pointer;
}
.recovery-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
input {
  flex: 1 1 16rem;
  min-width: 0;
}
</style>
