<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, useId } from 'vue'
import { t } from '../i18n'
import type { SettingsContribution, SettingsEntry, SettingsField } from '../settings/types'
import { SettingGroup, SettingField, UiNotice, UiButton, type SettingValue } from './ui'

const props = defineProps<{
  entries: readonly SettingsEntry[]
  scope: string
  focusOwner?: string
}>()
const emit = defineEmits<{ details: [pluginId: string] }>()
const panel = ref<HTMLElement>()
const prefix = `settings-${useId()}`
const fieldErrors = shallowRef(new WeakMap<SettingsContribution, Map<string, Error>>())
const changes = new WeakMap<SettingsContribution, Map<string, number>>()
const registrationIds = new WeakMap<SettingsContribution, number>()
let nextRegistration = 0
let alive = true
function fieldKey(entry: SettingsEntry, field: SettingsField) {
  return `${entry.ownerId}:${entry.contribution.id}:${field.key}`
}
function registrationKey(contribution: SettingsContribution) {
  if (!registrationIds.has(contribution)) registrationIds.set(contribution, ++nextRegistration)
  return `${props.scope}:${registrationIds.get(contribution)}`
}
function fieldProps(entry: SettingsEntry, field: SettingsField) {
  const { key: _key, onChange: _onChange, ...settings } = field
  const key = fieldKey(entry, field)
  const failure = fieldErrors.value.get(entry.contribution)?.get(field.key)
  return {
    ...settings,
    id: `${prefix}-${key}`,
    error: field.error || (failure ? t(failure) : undefined),
  }
}
function update(entry: SettingsEntry, field: SettingsField, value: SettingValue) {
  if (!alive || !props.entries.includes(entry) || !entry.isCurrent()) return
  const contribution = entry.contribution
  const scope = props.scope
  const updates = changes.get(contribution) ?? new Map<string, number>()
  changes.set(contribution, updates)
  const version = (updates.get(field.key) ?? 0) + 1
  updates.set(field.key, version)
  fieldErrors.value.get(contribution)?.delete(field.key)
  triggerRef(fieldErrors)
  const failed = (issue: unknown) => {
    if (
      alive &&
      scope === props.scope &&
      changes.get(contribution)?.get(field.key) === version &&
      props.entries.includes(entry) &&
      entry.isCurrent()
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
  if (!alive || !props.focusOwner) return
  const target = panel.value?.querySelector<HTMLElement>(`[data-plugin-id="${props.focusOwner}"]`)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'start' })
})
onBeforeUnmount(() => {
  alive = false
})
</script>

<template>
  <div ref="panel" class="settings-content">
    <template v-for="entry in entries" :key="registrationKey(entry.contribution)">
      <div v-if="entry.standalone" class="settings-view">
        <component :is="entry.contribution.component" />
      </div>
      <SettingGroup
        v-else
        class="settings-configuration"
        :class="{ 'plugin-configuration': entry.pluginId }"
        :data-plugin-id="entry.pluginId"
        :data-settings-id="entry.contribution.id"
        :title="entry.contribution.title"
        :description="entry.contribution.description"
        tabindex="-1"
      >
        <template v-if="entry.pluginId" #actions
          ><UiButton variant="ghost" @click="emit('details', entry.pluginId!)">{{
            t('插件说明')
          }}</UiButton></template
        >
        <UiNotice v-if="entry.contribution.error" tone="error">{{
          entry.contribution.error
        }}</UiNotice>
        <SettingField
          v-for="field in entry.contribution.fields"
          :key="field.key"
          v-bind="fieldProps(entry, field)"
          @update:model-value="update(entry, field, $event)"
        />
        <component v-if="entry.contribution.component" :is="entry.contribution.component" />
      </SettingGroup>
    </template>
    <UiNotice v-if="!entries.length">{{ t('此分类暂时没有可配置的选项。') }}</UiNotice>
  </div>
</template>

<style scoped>
.settings-configuration {
  scroll-margin-top: 4rem;
}
.settings-configuration:focus-visible {
  outline: 2px solid var(--ui-control-focus);
  outline-offset: 3px;
}
</style>
