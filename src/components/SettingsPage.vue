<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, type Component } from 'vue'
import { t, locale, setLocale } from '../i18n'
import { preferences, setPreference, preferenceError } from '../preferences'
import PluginPanel from './PluginPanel.vue'
const props = defineProps<{ initialTab?: 'general' | 'plugins'; platformSettings?: Component }>()
const selected = ref<'general' | 'plugins' | 'ai'>(props.initialTab ?? 'general')
const AiCardSkill = defineAsyncComponent(() => import('./AiCardSkill.vue'))
const categories = ['general', 'plugins', 'ai'] as const
async function moveTab(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = categories.indexOf(selected.value)
  selected.value =
    categories[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 2
          : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3
    ]!
  await nextTick()
  document.getElementById(`settings-tab-${selected.value}`)?.focus()
}
const popupOptions = computed(() => [
  {
    key: 'popupInfo' as const,
    label: t('信息通知'),
    description: t('保存成功和一般提示，5 秒后自动关闭。'),
  },
  {
    key: 'popupWarning' as const,
    label: t('警告通知'),
    description: t('需要留意的情况，手动关闭。'),
  },
  {
    key: 'popupError' as const,
    label: t('错误通知'),
    description: t('操作失败和保存错误，手动关闭。'),
  },
])
</script>
<template>
  <div class="page settings-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('设置') }}</h1>
        <p>{{ t('界面、通知与插件。设置保存在当前浏览器或桌面应用中。') }}</p>
      </div>
    </header>
    <div class="settings-tabs" role="tablist" :aria-label="t('设置分类')" @keydown="moveTab">
      <button
        v-for="item in [
          { id: 'general', label: '通用' },
          { id: 'plugins', label: '插件' },
          { id: 'ai', label: 'AI 制卡' },
        ] as const"
        :id="`settings-tab-${item.id}`"
        :key="item.id"
        role="tab"
        :aria-selected="selected === item.id"
        :tabindex="selected === item.id ? 0 : -1"
        :aria-controls="selected === item.id ? `settings-panel-${item.id}` : undefined"
        @click="selected = item.id"
      >
        {{ t(item.label) }}
      </button>
    </div>
    <section
      :id="`settings-panel-${selected}`"
      role="tabpanel"
      :aria-labelledby="`settings-tab-${selected}`"
    >
      <template v-if="selected === 'general'">
        <section class="settings-section">
          <h2>{{ t('界面') }}</h2>
          <label for="settings-language">{{ t('偏好语言') }}</label
          ><select
            id="settings-language"
            :value="locale"
            @change="
              setLocale(($event.target as HTMLSelectElement).value === 'en' ? 'en' : 'zh-CN')
            "
          >
            <option value="en">English</option>
            <option value="zh-CN">中文（简体）</option>
          </select>
        </section>
        <section class="settings-section">
          <h2>{{ t('弹出通知') }}</h2>
          <p class="form-note">
            {{ t('关闭弹出后，通知改为在页面内显示。警告和错误仍需手动关闭。') }}
          </p>
          <div v-for="item in popupOptions" :key="item.key" class="notification-setting">
            <label class="check-line"
              ><input
                type="checkbox"
                :checked="preferences[item.key]"
                @change="setPreference(item.key, ($event.target as HTMLInputElement).checked)"
              />{{ item.label }}</label
            >
            <p class="form-note">{{ item.description }}</p>
          </div>
        </section>
        <component v-if="platformSettings" :is="platformSettings" />
      </template>
      <PluginPanel v-else-if="selected === 'plugins'" embedded />
      <AiCardSkill v-else />
    </section>
    <p v-if="preferenceError" class="import-warning" role="alert">{{ t(preferenceError) }}</p>
  </div>
</template>
<style scoped>
.settings-page {
  max-width: 1100px;
}
.settings-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--line);
}
.settings-tabs button {
  font: inherit;
  padding: 0.65rem 1.25rem;
  min-height: 44px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.settings-tabs button[aria-selected='true'] {
  background: #e5ecdf;
  border-color: #bacbb0;
  color: #365b42;
}
.settings-section {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}
.settings-section h2 {
  font-size: 1.2rem;
  margin: 0 0 1rem;
}
select {
  font: inherit;
  min-height: 44px;
  padding: 0.5rem 1rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  margin-left: 1rem;
}
.notification-setting + .notification-setting {
  margin-top: 1.25rem;
}
.check-line input {
  width: 18px;
  height: 18px;
}
</style>
