<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../i18n'
import { desktopEndpoint } from '../platform/desktop'
import { setEndpoint } from './native'
import McpSettings from './McpSettings.vue'
const endpoint = ref(desktopEndpoint.value),
  saving = ref(false),
  error = ref('')
async function save() {
  saving.value = true
  error.value = ''
  try {
    await setEndpoint(endpoint.value)
    location.reload()
  } catch {
    error.value = '请输入 HTTPS 服务地址；本机服务可使用 HTTP。地址不应包含路径、账号或参数。'
    saving.value = false
  }
}
</script>
<template>
  <section class="settings-section desktop-settings" role="region" :aria-label="t('桌面设置')">
    <h2>{{ t('桌面设置') }}</h2>
    <form @submit.prevent="save">
      <label class="form-field" for="upstream-endpoint"
        >{{ t('上游后端地址') }}
        <input
          id="upstream-endpoint"
          v-model="endpoint"
          type="url"
          placeholder="https://repeaty.example.com"
          autocomplete="url"
        />
      </label>
      <p class="form-note">
        {{ t('留空使用本地学习库。连接后使用服务端账户的学习库，两者独立保留，不会自动合并。') }}
      </p>
      <p class="form-note">{{ t('LeetCode 登录信息始终保存在本机，不会发送给上游服务。') }}</p>
      <p v-if="error" role="alert">{{ t(error) }}</p>
      <div class="connection-actions">
        <button class="button primary" :disabled="saving">{{ t('保存并重新打开') }}</button>
      </div>
    </form>
    <McpSettings />
  </section>
</template>
<style scoped>
.desktop-settings {
  padding: 1.5rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
}
h2 {
  margin-top: 0;
  font-size: 1.2rem;
}
</style>
