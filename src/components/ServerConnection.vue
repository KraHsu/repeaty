<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../i18n'
import { setServerToken } from '../backend/client'
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ connect: [] }>()
const token = ref('')
function connect() {
  setServerToken(token.value)
  token.value = ''
  emit('connect')
}
</script>
<template>
  <form class="server-connection" @submit.prevent="connect">
    <div class="form-field">
      <label for="server-token">{{ t('服务访问密钥') }}</label>
      <input
        id="server-token"
        v-model="token"
        type="password"
        autocomplete="off"
        :disabled="busy"
      />
    </div>
    <p class="form-note">{{ t('填写部署时设置的访问密钥。密钥仅保存在当前标签页会话中。') }}</p>
    <button class="button primary" :disabled="busy">{{ t('连接服务') }}</button>
  </form>
</template>
