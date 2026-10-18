<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../i18n'
import { remoteWorkspace } from '../edition'
import { desktopEndpoint } from '../platform/desktop'
import { setEndpoint } from './native'
import AppModal from '../components/AppModal.vue'
import AccountControls from '../components/AccountControls.vue'
const opened = ref(false),
  endpoint = ref(desktopEndpoint.value),
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
  <AccountControls v-if="remoteWorkspace" />
  <button class="text-button" @click="opened = true">{{ t('设置') }}</button>
  <AppModal
    v-if="opened"
    :title="t('学习库存储')"
    :busy="saving"
    :error="t(error)"
    @close="opened = false"
  >
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
        <button class="button secondary" type="button" :disabled="saving" @click="opened = false">
          {{ t('取消') }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
