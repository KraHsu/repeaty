<script setup lang="ts">
import { onUnmounted, shallowRef, ref, watch } from 'vue'
import { t } from '../i18n'
import { hasAttemptBody, type Attempt, type AttemptRecord } from '../core/practice-data'
const props = defineProps<{
  attempt: AttemptRecord
  getAttempt?: (id: string, signal?: AbortSignal) => Promise<Attempt>
  codeOnly?: boolean
}>()
const emit = defineEmits<{ loaded: [] }>()
const body = shallowRef<Attempt>()
const failed = ref(false)
let request: AbortController | undefined
async function load() {
  request?.abort()
  const controller = new AbortController()
  request = controller
  body.value = undefined
  failed.value = false
  try {
    const value = hasAttemptBody(props.attempt)
      ? props.attempt
      : await props.getAttempt?.(props.attempt.id, controller.signal)
    if (controller.signal.aborted) return
    if (!value || value.id !== props.attempt.id || !hasAttemptBody(value))
      throw new Error('missing body')
    body.value = value
    emit('loaded')
  } catch {
    if (!controller.signal.aborted) failed.value = true
  }
}
watch(
  () => props.attempt,
  () => {
    void load()
  },
  { immediate: true },
)
onUnmounted(() => {
  request?.abort()
  body.value = undefined
})
</script>
<template>
  <div class="attempt-body">
    <template v-if="body">
      <template v-if="!codeOnly">
        <p v-if="body.submissionId">{{ t('提交编号：{id}', { id: body.submissionId }) }}</p>
        <p v-if="body.result?.runtime">
          {{ t('运行时间：{value}', { value: body.result.runtime }) }}
        </p>
        <p v-if="body.result?.memory">{{ t('内存：{value}', { value: body.result.memory }) }}</p>
        <pre v-if="body.result?.detail" class="attempt-code">{{ body.result.detail }}</pre>
      </template>
      <pre class="attempt-code"><code>{{ body.code }}</code></pre>
    </template>
    <div v-else-if="failed" role="alert">
      <p>{{ t('无法读取这次提交，请重试。') }}</p>
      <button type="button" class="button secondary" @click="load">{{ t('重试') }}</button>
    </div>
    <p v-else class="form-note" role="status">{{ t('正在读取提交…') }}</p>
  </div>
</template>
<style scoped>
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
