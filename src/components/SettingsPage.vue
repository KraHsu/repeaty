<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, type Component } from 'vue'
import { t, locale, setLocale } from '../i18n'
import { preferences, setPreference, preferenceError } from '../preferences'
import PluginPanel from './PluginPanel.vue'
import { SettingGroup, SettingField } from './ui'
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
        <SettingGroup :title="t('界面')">
          <SettingField
            id="settings-language"
            type="select"
            :label="t('界面语言')"
            :model-value="locale"
            :options="[
              { value: 'en', label: 'English' },
              { value: 'zh-CN', label: '中文（简体）' },
            ]"
            @update:model-value="setLocale($event === 'en' ? 'en' : 'zh-CN')"
          />
        </SettingGroup>
        <SettingGroup
          :title="t('弹出通知')"
          :description="t('关闭弹出后，通知改为在页面内显示。警告和错误仍需手动关闭。')"
        >
          <SettingField
            v-for="item in popupOptions"
            :key="item.key"
            type="switch"
            :label="item.label"
            :description="item.description"
            :model-value="preferences[item.key]"
            @update:model-value="setPreference(item.key, $event === true)"
          />
        </SettingGroup>
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
  max-width: 1040px;
  container-type: inline-size;
}
.settings-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  padding-bottom: 0;
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--line);
}
.settings-tabs button {
  font: inherit;
  padding: 0.75rem 0.1rem;
  min-height: 44px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--font-size-control);
  cursor: pointer;
}
.settings-tabs button[aria-selected='true'] {
  background: transparent;
  border-bottom-color: var(--green);
  color: #365b42;
  font-weight: var(--font-weight-semibold);
}
</style>
