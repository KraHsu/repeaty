<script setup lang="ts">
import { vUiControl, vUiButton } from './ui'
import AppModal from './AppModal.vue'
import { onMounted, ref } from 'vue'
import { t } from '../i18n'
import { apiJson } from '../backend/client'
import { account, refreshAccount } from '../backend/account'
const editing = ref(false),
  currentPassword = ref(''),
  password = ref(''),
  error = ref(''),
  busy = ref(false)
onMounted(refreshAccount)
function close() {
  editing.value = false
  currentPassword.value = ''
  password.value = ''
  error.value = ''
}
async function logout() {
  busy.value = true
  error.value = ''
  try {
    await apiJson('/auth/logout', {})
    location.reload()
  } catch (cause) {
    error.value = (cause as Error).message
    busy.value = false
  }
}
async function change() {
  busy.value = true
  error.value = ''
  try {
    await apiJson('/auth/password', {
      currentPassword: currentPassword.value,
      password: password.value,
    })
    location.reload()
  } catch (cause) {
    error.value = (cause as Error).message
    busy.value = false
  }
}
</script>
<template>
  <div v-if="account" class="account-controls">
    <span :title="account.username">{{ account.username }}</span>
    <button v-ui-button class="text-button" @click="editing = true">{{ t('修改密码') }}</button>
    <button v-ui-button class="text-button" :disabled="busy" @click="logout">
      {{ t('退出登录') }}
    </button>
    <p v-if="error && !editing" role="alert">{{ t(error) }}</p>
    <AppModal v-if="editing" :title="t('修改密码')" :busy="busy" :error="t(error)" @close="close">
      <form @submit.prevent="change">
        <label class="form-field"
          >{{ t('当前密码')
          }}<input
            v-ui-control
            v-model="currentPassword"
            type="password"
            required
            autocomplete="current-password"
        /></label>
        <label class="form-field"
          >{{ t('新密码')
          }}<input
            v-ui-control
            v-model="password"
            type="password"
            required
            minlength="12"
            maxlength="128"
            autocomplete="new-password"
        /></label>
        <p class="form-note">{{ t('修改后需在所有设备重新登录。') }}</p>
        <p v-if="error" role="alert">{{ t(error) }}</p>
        <div class="connection-actions">
          <button v-ui-button class="button primary" :disabled="busy">{{ t('保存') }}</button>
          <button
            v-ui-button
            class="button secondary"
            type="button"
            :disabled="busy"
            @click="close"
          >
            {{ t('取消') }}
          </button>
        </div>
      </form>
    </AppModal>
  </div>
</template>
