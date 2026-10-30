<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUp, ArrowDown } from '@lucide/vue'
import { useApplication } from '../app/context'
import { t } from '../i18n'
import {
  navigationPreferences,
  navigationError,
  navigationIcons,
  orderedNavigation,
  resetNavigationPreferences,
  setNavigationPreference,
} from '../navigation-preferences'
import { SettingGroup, SettingField, UiButton, UiNotice } from './ui'
const props = defineProps<{ isCurrent: () => boolean }>()
const { pluginPages } = useApplication()
const items = computed(() =>
  orderedNavigation([
    ...[
      ['overview', '学习概览'],
      ['cards', '全部卡片'],
      ['sources', '学习材料'],
      ['history', '练习历史'],
      ['workspace', '工作目录'],
      ['data', '数据与备份'],
    ].map(([id, label]) => ({ id: id!, label: label! })),
    ...pluginPages.value.map((entry) => ({
      id: `plugin:${entry.pluginId}/${entry.contribution.id}`,
      label: entry.contribution.title,
    })),
    ...[
      ['plugins', '插件'],
      ['settings', '设置'],
      ['help', '帮助'],
    ].map(([id, label]) => ({ id: id!, label: label! })),
  ]),
)
const icons = computed(() =>
  navigationIcons.map((value, index) => ({
    value,
    label: t(
      [
        '默认图标',
        '牌组',
        '文件',
        '书本',
        '文件夹',
        '历史',
        '数据库',
        '拼图',
        '齿轮',
        '星标',
        '图表',
        '网格',
      ][index]!,
    ),
  })),
)
function move(index: number, delta: number) {
  if (!props.isCurrent()) return
  const order = items.value.map((item) => item.id)
  const other = index + delta
  if (other < 0 || other >= order.length) return
  ;[order[index], order[other]] = [order[other]!, order[index]!]
  setNavigationPreference('order', order)
}
function hide(id: string, visible: boolean) {
  if (props.isCurrent())
    setNavigationPreference(
      'hidden',
      visible
        ? navigationPreferences.hidden.filter((item) => item !== id)
        : [...navigationPreferences.hidden, id],
    )
}
</script>
<template>
  <SettingGroup
    :title="t('导航入口')"
    :description="t('调整入口的顺序、图标和显示状态。设置和帮助始终保留；正在使用的页面也会显示。')"
  >
    <template #actions
      ><UiButton variant="ghost" @click="isCurrent() && resetNavigationPreferences()">{{
        t('恢复默认侧栏')
      }}</UiButton></template
    >
    <UiNotice v-if="navigationError" tone="warning">{{ t(navigationError) }}</UiNotice>
    <SettingField
      type="select"
      :label="t('侧栏文字')"
      :model-value="navigationPreferences.labels"
      :options="[
        { value: 'auto', label: t('窄栏仅显示图标') },
        { value: 'always', label: t('始终显示文字') },
      ]"
      @update:model-value="
        isCurrent() && setNavigationPreference('labels', $event as 'auto' | 'always')
      "
    />
    <SettingField
      type="select"
      :label="t('侧栏密度')"
      :model-value="navigationPreferences.density"
      :options="[
        { value: 'comfortable', label: t('舒适') },
        { value: 'compact', label: t('紧凑') },
      ]"
      @update:model-value="
        isCurrent() && setNavigationPreference('density', $event as 'comfortable' | 'compact')
      "
    />
    <ol class="navigation-settings-list">
      <li v-for="(item, index) in items" :key="item.id">
        <SettingField
          type="switch"
          :label="t(item.label)"
          :model-value="!navigationPreferences.hidden.includes(item.id)"
          :disabled="item.id === 'settings' || item.id === 'help'"
          @update:model-value="hide(item.id, !!$event)"
        />
        <SettingField
          type="select"
          class="navigation-icon-field"
          :label="t('图标') + ' · ' + t(item.label)"
          :model-value="navigationPreferences.icons[item.id] ?? 'default'"
          :options="icons"
          @update:model-value="
            isCurrent() &&
            setNavigationPreference('icons', {
              ...navigationPreferences.icons,
              [item.id]: $event as (typeof navigationIcons)[number],
            })
          "
        />
        <div class="navigation-settings-move">
          <UiButton
            variant="ghost"
            icon
            :disabled="index === 0"
            :aria-label="t('上移') + ' · ' + t(item.label)"
            @click="move(index, -1)"
            ><ArrowUp :size="18" /></UiButton
          ><UiButton
            variant="ghost"
            icon
            :disabled="index === items.length - 1"
            :aria-label="t('下移') + ' · ' + t(item.label)"
            @click="move(index, 1)"
            ><ArrowDown :size="18"
          /></UiButton>
        </div>
      </li>
    </ol>
  </SettingGroup>
</template>
<style scoped>
.navigation-settings-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.navigation-settings-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(7rem, 10rem) auto;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--ui-border-muted);
}
.navigation-settings-list :deep(.ui-setting-field) {
  padding: 0;
  border: 0;
  min-height: 0;
}
.navigation-icon-field :deep([data-slot='wrapper']) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.navigation-settings-list :deep(.navigation-icon-field > :last-child) {
  width: 100%;
  flex: 1 1 100%;
  max-width: none;
}
.navigation-settings-move {
  display: flex;
}
@media (max-width: 800px) {
  .navigation-settings-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .navigation-settings-list li > :nth-child(2) {
    grid-column: 1;
    grid-row: 2;
  }
  .navigation-settings-move {
    grid-column: 2;
    grid-row: 1 / 3;
  }
}
</style>
