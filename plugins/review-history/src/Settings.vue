<script setup lang="ts">
import { onMounted } from 'vue'
import { SettingField, type SettingValue } from '@repeaty/plugin-api'
import { preferences, setPreference, preferenceError, initializePreferences } from './preferences'
import { t } from './i18n'
onMounted(initializePreferences)
function setLength(value: SettingValue) {
  setPreference('historyLength', Number(value))
}
</script>
<template>
  <div class="history-settings">
    <p v-if="preferenceError" class="import-warning" role="alert">{{ t(preferenceError) }}</p>
    <SettingField
      id="history-length"
      type="number"
      :min="1"
      :max="50"
      :step="1"
      :label="t('显示最近几次评分')"
      :description="t('可显示 1–50 次，仅统计当前卡片已保存的评分。')"
      :model-value="preferences.historyLength"
      commit="change"
      @update:model-value="setLength"
    />
    <SettingField
      id="history-after-reveal"
      type="switch"
      :label="t('翻面后才显示历史')"
      :model-value="preferences.historyAfterReveal"
      @update:model-value="setPreference('historyAfterReveal', Boolean($event))"
    />
    <p class="history-legend">
      <span class="again">● {{ t('重来') }}</span
      ><span class="hard">● {{ t('困难') }}</span
      ><span class="good">● {{ t('良好') }}</span
      ><span class="easy">● {{ t('简单') }}</span>
    </p>
  </div>
</template>
<style scoped>
.history-settings {
  margin-top: 1rem;
}
.history-legend {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  font-size: var(--font-size-meta);
  line-height: var(--line-height-ui);
}
.again {
  color: #a84e3d;
}
.hard {
  color: #8c681d;
}
.good {
  color: #416c50;
}
.easy {
  color: #466e9b;
}
</style>
