<script setup lang="ts">
import { UiInput, UiButton, UiSelect, UiCollapsible } from '@repeaty/plugin-api'

import { computed, onUnmounted, ref } from 'vue'
import { t } from './i18n'
import type { NoteInput } from '@repeaty/plugin-api'
import {
  defaultSite,
  parseProblemInput,
  parseProblemResponse,
  problemSchema,
  problemUrl,
  rememberSite,
} from './model'
import { bridgeRequest } from './bridge'
import Connection from './Connection.vue'
import Statement from './Statement.vue'
const props = defineProps<{ modelValue: NoteInput }>()
const emit = defineEmits<{ 'update:modelValue': [value: NoteInput] }>()
const saved = computed(() => problemSchema.safeParse(props.modelValue.plugin?.data))
const problem = computed(() => (saved.value.success ? saved.value.data : undefined))
const site = ref(problem.value?.site ?? defaultSite())
const input = ref(problem.value ? problemUrl(problem.value) : '')
const loading = ref(false)
const error = ref<Error | string>('')
const abort = new AbortController()
onUnmounted(() => abort.abort())
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    let target
    try {
      target = parseProblemInput(input.value, site.value)
    } catch {
      throw new Error('请填写 LeetCode 题目链接或英文标识。')
    }
    await bridgeRequest({ action: 'ping' }, abort.signal)
    const raw = await bridgeRequest({ action: 'question', ...target }, abort.signal)
    const data = parseProblemResponse(raw, target.site, target.slug)
    if (abort.signal.aborted) return
    site.value = data.site
    rememberSite(data.site)
    emit('update:modelValue', {
      ...props.modelValue,
      front: `${data.frontendId}. ${data.title}`,
      plugin: { id: 'leetcode', version: 1, data },
    })
  } catch (issue) {
    if (!abort.signal.aborted) error.value = issue as Error
  } finally {
    loading.value = false
  }
}
</script>
<template>
  <section class="leetcode-editor">
    <div class="leetcode-source">
      <div class="form-field">
        <label for="leetcode-site">{{ t('LeetCode 站点') }}</label>
        <UiSelect
          id="leetcode-site"
          v-model="site"
          :disabled="loading"
          @change="rememberSite(site)"
          :items="[
            { value: 'leetcode.cn', label: t('中国站 · leetcode.cn') },
            { value: 'leetcode.com', label: t('国际站 · leetcode.com') },
          ]"
        />
      </div>
      <div class="form-field">
        <label for="leetcode-link">{{ t('题目链接或英文标识') }}</label>
        <UiInput
          id="leetcode-link"
          v-model="input"
          :disabled="loading"
          placeholder="https://leetcode.cn/problems/two-sum/"
          maxlength="500"
          @keydown.enter.prevent="load"
        />
      </div>
      <UiButton
        variant="secondary"
        type="button"
        :disabled="loading || !input.trim()"
        @click="load"
      >
        {{ loading ? t('读取中…') : t('读取题目') }}
      </UiButton>
    </div>
    <p v-if="error" role="alert" class="import-warning">{{ t(error) }}</p>
    <Connection :site="site" />
    <template v-if="problem">
      <p role="status">
        {{ t('已读取：{title}', { title: `${problem.frontendId}. ${problem.title}` }) }} ·
        {{ t(problem.difficulty) }} · {{ problem.site }}
      </p>
      <UiCollapsible>
        <UiButton variant="ghost">{{ t('题目预览') }}</UiButton>
        <template #content><Statement :content="problem.content" /></template>
      </UiCollapsible>
    </template>
    <p v-else class="form-note">
      {{ t('读取题目后再保存。题面保存在服务数据库中，提交判题需要联网。') }}
    </p>
  </section>
</template>
