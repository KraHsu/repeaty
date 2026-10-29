<script setup lang="ts">
import { onScopeDispose, ref } from 'vue'
import { t } from '../i18n'
import { UiButton, SettingField, SettingGroup } from './ui'
import { sourceMetadataFields, saveSourceMetadataFields } from '../source-metadata-settings'
const props = defineProps<{ isCurrent?: () => boolean }>()
const fields = ref(''),
  error = ref(''),
  saved = ref(false),
  busy = ref(false)
let alive = true
const current = () => alive && (props.isCurrent?.() ?? true)
try {
  fields.value = sourceMetadataFields().join(', ')
} catch {}
onScopeDispose(() => {
  alive = false
})
async function save() {
  if (busy.value || !current()) return
  busy.value = true
  error.value = ''
  saved.value = false
  try {
    await saveSourceMetadataFields(fields.value, current)
    if (current()) saved.value = true
  } catch (issue) {
    if (current()) error.value = t(issue as Error)
  } finally {
    if (current()) busy.value = false
  }
}
</script>
<template>
  <SettingGroup :title="t('材料属性')">
    <SettingField
      type="text"
      v-model="fields"
      :disabled="busy"
      :label="t('显示的属性字段')"
      :description="t('逗号分隔；留空显示所有自定义属性。保留原始 YAML 中的其他字段。')"
      placeholder="author, tags, published"
    />
    <UiButton variant="primary" :disabled="busy" @click="save">{{ t('保存设置') }}</UiButton>
    <p v-if="error" role="alert" class="form-note">{{ error }}</p>
    <p v-else-if="saved" role="status" class="form-note">{{ t('属性显示设置已保存。') }}</p>
  </SettingGroup>
</template>
