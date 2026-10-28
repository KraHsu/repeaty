<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  triggerRef,
  useId,
} from 'vue'
import { t } from '../i18n'
import { usePlugins } from '../plugins'
import { usePluginManager } from '../plugins/manager'
import type { PluginSettingField, PluginSettingsContribution } from '../plugins/settings'
import type { PluginInstallation } from '../plugins/types'
import { SettingGroup, SettingField, UiNotice, type SettingValue } from './ui'

const props = defineProps<{ focusPlugin?: string }>()
const { installedPlugins, pluginEnabled } = usePlugins()
const { pluginScope } = usePluginManager()
const panel = ref<HTMLElement>()
const prefix = `plugin-settings-${useId()}`
const fieldErrors = shallowRef(new WeakMap<PluginSettingsContribution, Map<string, Error>>())
const changes = new WeakMap<PluginSettingsContribution, Map<string, number>>()
const registrationIds = new WeakMap<PluginSettingsContribution, number>()
let nextRegistration = 0
let alive = true
const entries = computed(() =>
  installedPlugins
    .filter(({ plugin }) => pluginEnabled(plugin.id))
    .flatMap((installation) =>
      (installation.settings ?? []).map((contribution) => ({ installation, contribution })),
    ),
)
function fieldKey(
  installation: PluginInstallation,
  contribution: PluginSettingsContribution,
  field: PluginSettingField,
) {
  return `${installation.plugin.id}:${contribution.id}:${field.key}`
}
function registrationKey(contribution: PluginSettingsContribution) {
  if (!registrationIds.has(contribution)) registrationIds.set(contribution, ++nextRegistration)
  return `${pluginScope.value}:${registrationIds.get(contribution)}`
}
function fieldProps(
  installation: PluginInstallation,
  contribution: PluginSettingsContribution,
  field: PluginSettingField,
) {
  const { key: _key, onChange: _onChange, ...settings } = field
  const key = fieldKey(installation, contribution, field)
  const failure = fieldErrors.value.get(contribution)?.get(field.key)
  return {
    ...settings,
    id: `${prefix}-${key}`,
    error: field.error || (failure ? t(failure) : undefined),
  }
}
function update(
  installation: PluginInstallation,
  contribution: PluginSettingsContribution,
  field: PluginSettingField,
  value: SettingValue,
) {
  if (
    !alive ||
    !installedPlugins.includes(installation) ||
    !installation.settings?.includes(contribution) ||
    !pluginEnabled(installation.plugin.id)
  )
    return
  const scope = pluginScope.value
  const updates = changes.get(contribution) ?? new Map<string, number>()
  changes.set(contribution, updates)
  const version = (updates.get(field.key) ?? 0) + 1
  updates.set(field.key, version)
  fieldErrors.value.get(contribution)?.delete(field.key)
  triggerRef(fieldErrors)
  const failed = (issue: unknown) => {
    if (
      alive &&
      scope === pluginScope.value &&
      changes.get(contribution)?.get(field.key) === version &&
      installedPlugins.includes(installation) &&
      installation.settings?.includes(contribution)
    ) {
      const errors = fieldErrors.value.get(contribution) ?? new Map<string, Error>()
      errors.set(
        field.key,
        issue instanceof Error ? issue : new Error('无法保存插件设置，请重试。'),
      )
      fieldErrors.value.set(contribution, errors)
      triggerRef(fieldErrors)
    }
  }
  try {
    void Promise.resolve(field.onChange(value)).catch(failed)
  } catch (issue) {
    failed(issue)
  }
}
onMounted(async () => {
  await nextTick()
  if (!alive || !props.focusPlugin) return
  const target = panel.value?.querySelector<HTMLElement>(`[data-plugin-id="${props.focusPlugin}"]`)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'start' })
})
onBeforeUnmount(() => {
  alive = false
})
</script>

<template>
  <div ref="panel" class="plugin-settings-page">
    <header class="page-heading">
      <div>
        <h2>{{ t('插件设置') }}</h2>
        <p>{{ t('已启用插件提供的配置，统一在这里调整。') }}</p>
      </div>
    </header>
    <SettingGroup
      v-for="{ installation, contribution } in entries"
      :key="registrationKey(contribution)"
      class="plugin-configuration"
      :data-plugin-id="installation.plugin.id"
      :data-settings-id="contribution.id"
      :title="contribution.title"
      :description="contribution.description"
      tabindex="-1"
    >
      <UiNotice v-if="contribution.error" tone="error">{{ contribution.error }}</UiNotice>
      <SettingField
        v-for="field in contribution.fields"
        :key="field.key"
        v-bind="fieldProps(installation, contribution, field)"
        @update:model-value="update(installation, contribution, field, $event)"
      />
      <component v-if="contribution.component" :is="contribution.component" />
    </SettingGroup>
    <UiNotice v-if="!entries.length">{{
      t('当前没有可配置的插件。启用提供设置的插件后，配置会出现在这里。')
    }}</UiNotice>
  </div>
</template>

<style scoped>
.plugin-configuration {
  scroll-margin-top: 4rem;
}
.plugin-configuration:focus-visible {
  outline: 2px solid var(--ui-control-focus);
  outline-offset: 3px;
}
</style>
