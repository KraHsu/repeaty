<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUp, ArrowDown } from '@lucide/vue'
import { t } from '../i18n'
import { usePluginManager } from '../plugins/manager'
import { inputDefaults } from '../input/defaults'
import {
  arrangeMenu,
  defaultMenus,
  readingActionDefinitions,
  useMenuPreferences,
  type MenuSurface,
} from '../input/menus'
import { SettingGroup, SettingField, UiButton, UiNotice, UiCheckbox } from './ui'
defineProps<{ isCurrent: () => boolean }>()
const menus = useMenuPreferences()
const plugins = usePluginManager()
const surface = ref<MenuSurface>('reading-selection')
const titles = {
  'reading-toolbar': '阅读工具栏',
  'reading-selection': '选区工具栏',
  'reading-context': '阅读右键菜单',
  'review-menu': '复习菜单',
}
const actions = computed(() =>
  surface.value === 'review-menu'
    ? inputDefaults
        .filter((entry) =>
          ['app.add', 'review.edit', 'review.delete', 'review.bury', 'review.suspend'].includes(
            entry.id,
          ),
        )
        .map((entry) => ({
          id: entry.id,
          title: t(entry.title),
          essential: entry.id === 'review.edit',
        }))
    : [
        ...readingActionDefinitions.map(([id, title]) => ({
          id,
          title: t(title),
          essential: id === 'material.copy' && surface.value === 'reading-context',
        })),
        ...plugins.pluginRuntime.installations.flatMap((owner) =>
          (owner.commands ?? []).map((command) => ({
            id: `plugin:${owner.plugin.id}:${command.id}`,
            title: `${owner.plugin.label} · ${command.title}`,
            essential: false,
          })),
        ),
      ],
)
const ordered = computed(() =>
  arrangeMenu(actions.value, {
    order: menus?.value.value.surfaces[surface.value].order ?? [],
    hidden: [],
  }),
)
function change(id: string, visible: boolean) {
  if (!menus) return
  const value = JSON.parse(JSON.stringify(menus.value.value)) as typeof menus.value.value
  const hidden = new Set(value.surfaces[surface.value].hidden)
  if (visible) hidden.delete(id)
  else hidden.add(id)
  value.surfaces[surface.value].hidden = [...hidden]
  void menus.save(value)
}
function move(index: number, offset: number) {
  if (!menus) return
  const order = ordered.value.map((entry) => entry.id)
  const moved = order.splice(index, 1)[0]
  if (!moved) return
  order.splice(index + offset, 0, moved)
  void menus.save({
    ...menus.value.value,
    surfaces: {
      ...menus.value.value.surfaces,
      [surface.value]: { ...menus.value.value.surfaces[surface.value], order },
    },
  })
}
</script>
<template>
  <SettingGroup
    :title="t('菜单与工具栏')"
    :description="t('按使用习惯调整阅读操作。停用插件后，其操作自动移除；重新启用会恢复原有排序。')"
    v-if="menus"
  >
    <template #actions
      ><UiButton
        variant="ghost"
        :disabled="!isCurrent() || menus.saving.value"
        @click="menus.save(defaultMenus())"
        >{{ t('恢复默认') }}</UiButton
      ></template
    >
    <UiNotice v-if="menus.error.value" tone="error">{{ t(menus.error.value) }}</UiNotice>
    <SettingField
      type="switch"
      :label="t('显示选区工具栏')"
      :model-value="menus.value.value.selectionEnabled"
      :disabled="!isCurrent() || menus.saving.value"
      @update:model-value="menus.save({ ...menus.value.value, selectionEnabled: !!$event })"
    />
    <SettingField
      type="range"
      :label="t('选区工具栏不透明度')"
      :model-value="menus.value.value.selectionOpacity"
      :min="30"
      :max="100"
      :step="5"
      unit="%"
      :disabled="!isCurrent() || menus.saving.value"
      @update:model-value="menus.save({ ...menus.value.value, selectionOpacity: Number($event) })"
    />
    <SettingField
      type="select"
      :label="t('配置位置')"
      :model-value="surface"
      :options="Object.entries(titles).map(([value, label]) => ({ value, label: t(label) }))"
      @update:model-value="surface = $event as MenuSurface"
    />
    <ul class="menu-settings-list" :aria-label="t(titles[surface])">
      <li v-for="(action, index) in ordered" :key="action.id">
        <UiCheckbox
          :model-value="
            action.essential || !menus.value.value.surfaces[surface].hidden.includes(action.id)
          "
          :label="action.title"
          :disabled="action.essential || !isCurrent() || menus.saving.value"
          @update:model-value="change(action.id, !!$event)"
        />
        <div class="menu-order-buttons">
          <UiButton
            icon
            variant="ghost"
            :aria-label="t('上移 {name}', { name: action.title })"
            :disabled="!index || !isCurrent() || menus.saving.value"
            @click="move(index, -1)"
            ><ArrowUp :size="16"
          /></UiButton>
          <UiButton
            icon
            variant="ghost"
            :aria-label="t('下移 {name}', { name: action.title })"
            :disabled="index === ordered.length - 1 || !isCurrent() || menus.saving.value"
            @click="move(index, 1)"
            ><ArrowDown :size="16"
          /></UiButton>
        </div>
      </li>
    </ul>
  </SettingGroup>
</template>
<style scoped>
.menu-settings-list {
  padding: 0;
  margin: 0;
  list-style: none;
}
.menu-settings-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--ui-border);
}
.menu-order-buttons {
  display: flex;
  flex-shrink: 0;
  gap: 0.25rem;
}
</style>
