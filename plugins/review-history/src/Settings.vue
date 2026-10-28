<script setup lang="ts">
import { onMounted } from 'vue'
import { SettingField, SettingSection, UiNotice, type SettingValue } from '@repeaty/plugin-api'
import { preferences, setPreference, preferenceError, initializePreferences } from './preferences'
import { t } from './i18n'
onMounted(initializePreferences)
function setLength(value: SettingValue) {
  setPreference('historyLength', Number(value))
}
</script>
<template>
  <SettingSection :title="t('历史显示')" :description="t('调整复习卡片上方的历史记录。')">
    <UiNotice v-if="preferenceError" tone="error">{{ t(preferenceError) }}</UiNotice>
    <SettingField
      id="history-length"
      type="number"
      :min="1"
      :max="50"
      :step="1"
      :label="t('显示条数')"
      :description="t('显示当前卡片最近 1–50 次评分。')"
      :model-value="preferences.historyLength"
      commit="change"
      @update:model-value="setLength"
    />
    <SettingField
      id="history-after-reveal"
      type="switch"
      :label="t('翻面后才显示历史')"
      :description="t('开启后，显示答案时再展示历史记录。')"
      :model-value="preferences.historyAfterReveal"
      @update:model-value="setPreference('historyAfterReveal', Boolean($event))"
    />
  </SettingSection>
</template>
