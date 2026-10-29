<script setup lang="ts">
import { onScopeDispose, ref } from 'vue'
import { t } from '../i18n'
import { readSynonyms, saveSynonyms } from '../material-search-settings'
import { UiButton, SettingGroup, SettingField } from './ui'
const props = defineProps<{ isCurrent?: () => boolean }>()
const text = ref(''),
  error = ref(''),
  saved = ref(false),
  saving = ref(false)
let alive = true
try {
  text.value = readSynonyms().text
} catch (issue) {
  error.value = t(issue as Error)
}
onScopeDispose(() => {
  alive = false
})
async function save() {
  if (!alive || saving.value || props.isCurrent?.() === false) return
  error.value = ''
  saved.value = false
  saving.value = true
  try {
    await saveSynonyms(text.value)
    if (alive && props.isCurrent?.() !== false) saved.value = true
  } catch (issue) {
    if (alive && props.isCurrent?.() !== false)
      error.value = `${t('同义词未能保存，请重试。')} ${t(issue as Error)}`
  } finally {
    if (alive) saving.value = false
  }
}
function reset() {
  text.value = ''
  void save()
}
function update(value: string | number | boolean | string[]) {
  text.value = String(value)
  saved.value = false
}
</script>
<template>
  <SettingGroup :title="t('材料搜索')">
    <SettingField
      type="textarea"
      :rows="7"
      :model-value="text"
      :disabled="saving"
      @update:model-value="update"
      :label="t('同义词组')"
      :description="
        t(
          '每行一组，逗号分隔。例如：间隔重复, spaced repetition。搜索多个条件用空格，完整词组用双引号。',
        )
      "
      placeholder="间隔重复, spaced repetition"
    />
    <div class="synonym-actions">
      <UiButton variant="primary" :busy="saving" :disabled="saving" @click="save">{{
        t('保存规则')
      }}</UiButton>
      <UiButton variant="ghost" :disabled="saving" @click="reset">{{ t('恢复默认规则') }}</UiButton>
    </div>
    <p v-if="error" role="alert" class="form-note">{{ error }}</p>
    <p v-else-if="saved" role="status" class="form-note">{{ t('同义词规则已保存。') }}</p>
  </SettingGroup>
</template>
<style scoped>
.synonym-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
