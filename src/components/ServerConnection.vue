<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { t } from '../i18n'
import { apiJson } from '../backend/client'
import { refreshAccount } from '../backend/account'
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ connect: [] }>()
const username = ref(''),
  password = ref(''),
  error = ref('')
const register = ref(false),
  registration = ref(false),
  saving = ref(false)
onMounted(async () => {
  try {
    registration.value = (await apiJson<{ registration: boolean }>('/status')).registration
  } catch {
    /* A retry remains available below. */
  }
})
function toggleMode() {
  register.value = !register.value
  error.value = ''
}
async function connect() {
  saving.value = true
  error.value = ''
  try {
    await apiJson(register.value ? '/auth/register' : '/auth/login', {
      username: username.value,
      password: password.value,
    })
    password.value = ''
    await refreshAccount()
    emit('connect')
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <form class="server-connection" @submit.prevent="connect">
    <h2>{{ t(register ? '创建账户' : '登录') }}</h2>
    <label class="form-field" for="account-username"
      >{{ t('用户名') }}
      <input
        id="account-username"
        v-model="username"
        required
        autocomplete="username"
        minlength="3"
        maxlength="32"
        autocapitalize="off"
        :spellcheck="false"
      />
    </label>
    <label class="form-field" for="account-password"
      >{{ t('密码') }}
      <input
        id="account-password"
        v-model="password"
        type="password"
        required
        :autocomplete="register ? 'new-password' : 'current-password'"
        :minlength="register ? 12 : undefined"
        maxlength="128"
      />
    </label>
    <p v-if="register" class="form-note">
      {{ t('用户名需为 3–32 位字母、数字、下划线或连字符。') }} {{ t('密码需为 12–128 字节。') }}
    </p>
    <p v-if="error" role="alert" class="import-warning">{{ t(error) }}</p>
    <div class="connection-actions">
      <button class="button primary" :disabled="busy || saving">
        {{ t(register ? '创建账户' : '登录') }}
      </button>
      <button
        v-if="registration"
        type="button"
        class="text-button"
        :disabled="saving"
        @click="toggleMode"
      >
        {{ t(register ? '已有账户，登录' : '创建账户') }}
      </button>
    </div>
  </form>
</template>
