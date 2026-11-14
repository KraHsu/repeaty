<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  appearance,
  defaultMaterialIcons,
  materialIconShapes,
  setAppearance,
  type MaterialIcon,
} from '../appearance'
import { t } from '../i18n'
import { SettingField, SettingGroup, UiButton, type SettingValue } from './ui'
import MaterialStateIcon from './MaterialStateIcon.vue'
const props = defineProps<{ isCurrent: () => boolean }>()
const state = ref<'pending' | 'scheduled' | 'archived'>('pending')
const kind = ref<'reading' | 'review'>('reading')
const settingsKey = computed(() => (kind.value === 'reading' ? 'materialIcons' : 'reviewIcons'))
const config = computed(() => appearance[settingsKey.value][state.value])
function update(key: keyof MaterialIcon, value: SettingValue) {
  if (props.isCurrent())
    setAppearance(settingsKey.value, {
      ...appearance[settingsKey.value],
      [state.value]: { ...config.value, [key]: value },
    })
}
</script>
<template>
  <SettingGroup
    :title="t('学习状态图标')"
    :description="t('用图形区分未安排、已安排和已归档的材料。文字名称始终保留。')"
  >
    <template #actions
      ><UiButton
        variant="ghost"
        @click="isCurrent() && setAppearance(settingsKey, defaultMaterialIcons)"
        >{{ t('恢复默认图标') }}</UiButton
      ></template
    >
    <div class="material-icon-preview">
      <MaterialStateIcon :state="state" :kind="kind" :size="28" /><span
        :style="{ opacity: config.textOpacity }"
        >{{ t(kind === 'reading' ? '学习材料' : '卡片') }}</span
      >
    </div>
    <SettingField
      type="select"
      :label="t('图标对象')"
      :model-value="kind"
      :options="[
        { value: 'reading', label: t('学习材料') },
        { value: 'review', label: t('卡片') },
      ]"
      @update:model-value="kind = $event as typeof kind"
    />
    <SettingField
      type="select"
      :label="t('材料状态')"
      :model-value="state"
      :options="[
        { value: 'pending', label: t(kind === 'reading' ? '未安排' : '新卡片') },
        { value: 'scheduled', label: t('已安排') },
        { value: 'archived', label: t(kind === 'reading' ? '已归档' : '暂停') },
      ]"
      @update:model-value="state = $event as typeof state"
    />
    <SettingField
      type="select"
      :label="t('图标形状')"
      :model-value="config.shape"
      :options="
        materialIconShapes.map((value, index) => ({
          value,
          label: t(
            ['文档', '叶片', '六边形', '菱形', '圆形', '正方形', '三角形', '自定义路径'][index]!,
          ),
        }))
      "
      @update:model-value="update('shape', $event)"
    />
    <SettingField
      :label="t('图标颜色')"
      :model-value="config.color"
      :placeholder="t('跟随文字颜色')"
      commit="change"
      @update:model-value="update('color', $event)"
    />
    <SettingField
      type="range"
      :label="t('图标大小')"
      :model-value="config.scale"
      :min="0.5"
      :max="2"
      :step="0.05"
      @update:model-value="update('scale', $event)"
    />
    <SettingField
      type="range"
      :label="t('描边宽度')"
      :model-value="config.lineWidth"
      :min="0.25"
      :max="4"
      :step="0.25"
      @update:model-value="update('lineWidth', $event)"
    />
    <SettingField
      type="switch"
      :label="t('双线图标')"
      :model-value="config.doubleLine"
      @update:model-value="update('doubleLine', $event)"
    />
    <template v-if="config.doubleLine"
      ><SettingField
        type="range"
        :label="t('内线比例')"
        :model-value="config.innerScale"
        :min="0.25"
        :max="0.95"
        :step="0.05"
        @update:model-value="update('innerScale', $event)" /><SettingField
        type="range"
        :label="t('内线宽度')"
        :model-value="config.innerWidth"
        :min="0"
        :max="4"
        :step="0.25"
        @update:model-value="update('innerWidth', $event)"
    /></template>
    <SettingField
      type="range"
      :label="t('图标不透明度')"
      :model-value="config.opacity"
      :min="0.2"
      :max="1"
      :step="0.05"
      @update:model-value="update('opacity', $event)"
    />
    <SettingField
      type="range"
      :label="t('名称不透明度')"
      :model-value="config.textOpacity"
      :min="0.3"
      :max="1"
      :step="0.05"
      @update:model-value="update('textOpacity', $event)"
    />
    <SettingField
      v-if="config.shape === 'custom'"
      type="textarea"
      :label="t('SVG 路径')"
      :description="t('填写 24×24 视框中的 path d 数据，不包含 SVG 标签或脚本。')"
      :model-value="config.path"
      :maxlength="8192"
      monospace
      commit="change"
      @update:model-value="update('path', $event)"
    />
  </SettingGroup>
</template>
<style scoped>
.material-icon-preview {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--ui-border);
  border-radius: var(--app-radius);
}
</style>
