<script setup lang="ts">
import UAlert from '@nuxt/ui/components/Alert.vue'
import { UiButton } from './ui'
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
    <UAlert
      v-else-if="failed"
      role="alert"
      color="error"
      :description="t('无法读取这次提交，请重试。')"
    >
      <template #actions
        ><UiButton @click="load">{{ t('重试') }}</UiButton></template
      >
    </UAlert>
    <UAlert v-else role="status" color="neutral" variant="soft" :description="t('正在读取提交…')" />
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
  font-family: var(--font-mono);
  font-size: var(--font-size-body);
  line-height: var(--line-height-code);
}
</style>
