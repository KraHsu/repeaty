<script setup lang="ts">
import { preferences, setPreference } from '../../preferences'
import { t } from '../../i18n'
</script>
<template>
  <div class="history-settings">
    <label for="history-length"
      >{{ t('显示最近几次评分') }}
      <input
        id="history-length"
        type="number"
        min="1"
        max="50"
        :value="preferences.historyLength"
        @change="
          setPreference('historyLength', Number(($event.target as HTMLInputElement).value)) ||
          (($event.target as HTMLInputElement).value = String(preferences.historyLength))
        "
      />
    </label>
    <p class="form-note">{{ t('可显示 1–50 次，仅统计当前卡片已保存的评分。') }}</p>
    <label class="check-line"
      ><input
        id="history-after-reveal"
        type="checkbox"
        :checked="preferences.historyAfterReveal"
        @change="setPreference('historyAfterReveal', ($event.target as HTMLInputElement).checked)"
      />{{ t('翻面后才显示历史') }}</label
    >
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
label {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
input[type='number'] {
  width: 6rem;
  min-height: 44px;
  padding: 0.5rem;
  font: inherit;
  border: 1px solid var(--line);
  border-radius: 6px;
}
input[type='checkbox'] {
  width: 18px;
  height: 18px;
}
.history-legend {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
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
