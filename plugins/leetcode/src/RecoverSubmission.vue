<script setup lang="ts">
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
    <details
      @toggle="
        (event) => {
          shown = (event.target as HTMLDetailsElement).open
        }
      "
    >
      <summary>{{ t('核对本次提交的代码') }}</summary>
      <AttemptBody v-if="shown" :attempt="attempt" :get-attempt="getAttempt" code-only />
    </details>
    <label :for="`recover-${attempt.id}`">{{ t('提交编号或详情链接') }}</label>
    <div class="recovery-fields">
      <input
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
      <button class="button secondary" :disabled="disabled || !input.trim()">
        {{ t('关联并查询') }}
      </button>
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
  font-size: 1.125rem;
}
p {
  line-height: 1.7;
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
.recovery-code {
  max-height: 20rem;
  overflow: auto;
  padding: 1rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font:
    0.9375rem/1.6 ui-monospace,
    monospace;
}
</style>
