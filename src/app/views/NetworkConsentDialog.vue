<script setup lang="ts">
import AppModal from '../../components/AppModal.vue'
import { UiButton } from '../../components/ui'
import { useApplication } from '../context'
import { locale } from '../../i18n'
const { prompt, resolve } = useApplication().networkConsent
const text = (zh: string, en: string) => (locale.value === 'en' ? en : zh)
</script>
<template>
  <AppModal
    v-if="prompt"
    :title="text('允许插件连接此网站？', 'Allow this plugin to connect?')"
    @close="resolve(false)"
  >
    <p>{{ prompt.owner.label }} {{ text('请求访问：', 'requests access to:') }}</p>
    <p class="network-origin">{{ prompt.origin }}</p>
    <p class="network-description">
      {{
        text(
          '允许后，插件可以向此网站发送请求，并使用为此网站保存的设备凭据。授权仅在当前学习库、本次插件启用期间有效。',
          'The plugin can send requests to this website and use device credentials saved for it. Access lasts only for this library and this plugin activation.',
        )
      }}
    </p>
    <template #footer>
      <UiButton variant="secondary" @click="resolve(false)">{{ text('取消', 'Cancel') }}</UiButton>
      <UiButton variant="primary" @click="resolve(true)">{{
        text('允许连接', 'Allow connection')
      }}</UiButton>
    </template>
  </AppModal>
</template>
<style scoped>
.network-origin {
  overflow-wrap: anywhere;
  font-weight: 600;
}
.network-description {
  color: var(--text-muted);
}
</style>
