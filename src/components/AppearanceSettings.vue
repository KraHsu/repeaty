<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import {
  appearance,
  appearanceError,
  paletteSchema,
  contrastRatio,
  defaultPalettes,
  resetAppearance,
  setAppearance,
  type Appearance,
  type Palette,
} from '../appearance'
import { SettingField, SettingGroup, UiButton, UiNotice, type SettingValue } from './ui'
import MaterialIconSettings from './MaterialIconSettings.vue'
const props = defineProps<{ isCurrent: () => boolean }>()
const mode = ref<'light' | 'dark'>('light')
const favoriteName = ref('')
const transfer = ref('')
const transferError = ref('')
const palette = computed(() => appearance[mode.value])
const colorLabels: [keyof Palette, string][] = [
  ['accent', '强调色'],
  ['text', '文字'],
  ['canvas', '页面背景'],
  ['surface', '内容背景'],
  ['sidebar', '侧栏背景'],
  ['selection', '选区颜色'],
  ['highlight', '高亮颜色'],
  ['cloze', '挖空颜色'],
]
const scales: {
  key: keyof Appearance
  label: string
  min: number
  max: number
  step: number
  unit: string
}[] = [
  { key: 'interfaceScale', label: '界面缩放', min: 75, max: 200, step: 5, unit: '%' },
  { key: 'navigationScale', label: '导航文字缩放', min: 75, max: 150, step: 5, unit: '%' },
  { key: 'listScale', label: '列表文字缩放', min: 75, max: 150, step: 5, unit: '%' },
  { key: 'readingSize', label: '正文字号', min: 12, max: 36, step: 1, unit: 'px' },
  { key: 'readingWidth', label: '阅读行宽', min: 360, max: 1400, step: 20, unit: 'px' },
  { key: 'readingLineHeight', label: '阅读行高', min: 1.3, max: 2.5, step: 0.05, unit: '' },
  { key: 'paragraphSpacing', label: '段落间距', min: 0, max: 2, step: 0.05, unit: 'em' },
]
const contrast = computed(() =>
  Math.min(
    ...[palette.value.surface, palette.value.canvas, palette.value.sidebar].map((background) =>
      contrastRatio(palette.value.text, background),
    ),
  ),
)
function update(key: keyof Appearance, value: SettingValue) {
  if (props.isCurrent()) setAppearance(key, value as never)
}
function updateColor(key: keyof Palette, value: SettingValue) {
  if (props.isCurrent() && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
    setAppearance(mode.value, { ...palette.value, [key]: value })
}
function saveFavorite() {
  if (!props.isCurrent() || !favoriteName.value.trim()) return
  setAppearance(
    'favorites',
    [
      ...appearance.favorites.filter((item) => item.name !== favoriteName.value.trim()),
      {
        name: favoriteName.value.trim(),
        light: { ...appearance.light },
        dark: { ...appearance.dark },
      },
    ].slice(-12),
  )
  favoriteName.value = ''
}
function importPalette() {
  if (!props.isCurrent()) return
  transferError.value = ''
  try {
    const input = JSON.parse(transfer.value)
    const light = paletteSchema.strict().parse(input.light)
    const dark = paletteSchema.strict().parse(input.dark)
    setAppearance('light', light)
    setAppearance('dark', dark)
  } catch {
    transferError.value = t('配色格式无效，请使用导出的 JSON。')
  }
}
</script>
<template>
  <div class="appearance-settings">
    <UiNotice v-if="appearanceError" tone="warning">{{ t(appearanceError) }}</UiNotice>
    <SettingGroup
      :title="t('阅读排版')"
      :description="t('调整显示，不改动材料正文。字体使用此设备上已安装的字体。')"
    >
      <template #actions
        ><UiButton variant="ghost" @click="isCurrent() && resetAppearance()">{{
          t('恢复默认外观')
        }}</UiButton></template
      >
      <article class="appearance-reading-preview markdown-content" :aria-label="t('阅读排版预览')">
        <h3>{{ t('让阅读保持舒适') }}</h3>
        <p>{{ t('文字、行宽和留白共同决定阅读的节奏。这里即时预览你的设置。') }}</p>
        <p>
          <mark>{{ t('高亮重点') }}</mark> · <code>repeaty.study()</code>
        </p>
      </article>
      <SettingField
        v-for="[key, label] in [
          ['font', '界面字体'],
          ['readingFont', '阅读字体'],
          ['monoFont', '等宽字体'],
        ] as const"
        :key="key"
        :label="t(label)"
        :model-value="appearance[key]"
        :placeholder="t('系统默认')"
        :maxlength="120"
        commit="change"
        @update:model-value="update(key, $event)"
      />
      <SettingField
        v-for="field in scales"
        :key="field.key"
        type="range"
        :label="t(field.label)"
        :model-value="Number(appearance[field.key])"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :unit="field.unit"
        @update:model-value="update(field.key, $event)"
      />
    </SettingGroup>
    <SettingGroup
      :title="t('配色')"
      :description="t('浅色与深色分别保存，应用和插件使用相同的颜色。')"
    >
      <SettingField
        type="radio"
        :label="t('编辑配色')"
        :model-value="mode"
        :options="[
          { value: 'light', label: t('浅色') },
          { value: 'dark', label: t('深色') },
        ]"
        @update:model-value="mode = $event as 'light' | 'dark'"
      />
      <UiNotice v-if="contrast < 4.5" tone="warning"
        >{{ t('当前文字与背景的对比度偏低，建议至少达到 4.5:1。') }}
        {{ contrast.toFixed(2) }}:1</UiNotice
      >
      <div class="appearance-palette-grid">
        <div v-for="[key, label] in colorLabels" :key="key" class="appearance-color-row">
          <span
            class="appearance-swatch"
            :style="{ background: palette[key] }"
            aria-hidden="true"
          />
          <SettingField
            :label="t(label)"
            :model-value="palette[key]"
            :maxlength="7"
            placeholder="#34674d"
            commit="change"
            :error="undefined"
            @update:model-value="updateColor(key, $event)"
          />
        </div>
      </div>
      <SettingField
        type="range"
        :label="t('分隔线强度')"
        :model-value="appearance.dividerStrength"
        :min="0"
        :max="100"
        :step="1"
        unit="%"
        @update:model-value="update('dividerStrength', $event)"
      />
      <UiButton
        variant="secondary"
        @click="isCurrent() && setAppearance(mode, { ...defaultPalettes[mode] })"
        >{{ t('恢复此配色') }}</UiButton
      >
      <div class="appearance-favorite-save">
        <SettingField
          :label="t('配色名称')"
          :model-value="favoriteName"
          :maxlength="60"
          @update:model-value="favoriteName = String($event)"
        /><UiButton variant="secondary" :disabled="!favoriteName.trim()" @click="saveFavorite">{{
          t('保存配色')
        }}</UiButton>
      </div>
      <ul v-if="appearance.favorites.length" class="appearance-favorites">
        <li v-for="favorite in appearance.favorites" :key="favorite.name">
          <span>{{ favorite.name }}</span
          ><UiButton
            variant="ghost"
            @click="
              isCurrent() &&
              (setAppearance('light', { ...favorite.light }),
              setAppearance('dark', { ...favorite.dark }))
            "
            >{{ t('应用') }}</UiButton
          ><UiButton
            variant="ghost"
            @click="
              isCurrent() &&
              setAppearance(
                'favorites',
                appearance.favorites.filter((item) => item.name !== favorite.name),
              )
            "
            >{{ t('删除') }}</UiButton
          >
        </li>
      </ul>
      <details>
        <summary>{{ t('导入或导出配色') }}</summary>
        <SettingField
          type="textarea"
          :label="t('配色 JSON')"
          :model-value="transfer"
          monospace
          :error="transferError"
          @update:model-value="transfer = String($event)"
        />
        <div class="appearance-transfer-actions">
          <UiButton
            variant="secondary"
            @click="
              transfer = JSON.stringify({ light: appearance.light, dark: appearance.dark }, null, 2)
            "
            >{{ t('导出配色') }}</UiButton
          ><UiButton variant="secondary" :disabled="!transfer.trim()" @click="importPalette">{{
            t('应用配色')
          }}</UiButton>
        </div>
      </details>
    </SettingGroup>
    <SettingGroup :title="t('阅读与辅助功能')">
      <SettingField
        type="switch"
        :label="t('深色模式下降低图片亮度')"
        :model-value="appearance.dimImages"
        @update:model-value="update('dimImages', $event)"
      />
      <SettingField
        type="select"
        :label="t('PDF 显示模式')"
        :model-value="appearance.pdfMode"
        :options="[
          { value: 'original', label: t('原始颜色') },
          { value: 'warm', label: t('暖色纸张') },
          { value: 'inverted', label: t('反色阅读') },
        ]"
        @update:model-value="update('pdfMode', $event)"
      />
      <SettingField
        type="select"
        :label="t('字体平滑')"
        :model-value="appearance.fontSmoothing"
        :options="[
          { value: 'system', label: t('系统默认') },
          { value: 'antialiased', label: t('平滑') },
        ]"
        @update:model-value="update('fontSmoothing', $event)"
      />
      <SettingField
        type="switch"
        :label="t('增强文字和分隔线对比度')"
        :model-value="appearance.strongContrast"
        @update:model-value="update('strongContrast', $event)"
      />
      <SettingField
        type="switch"
        :label="t('减少动态效果')"
        :description="t('系统开启减少动态效果时，始终遵从系统设置。')"
        :model-value="appearance.reduceMotion"
        @update:model-value="update('reduceMotion', $event)"
      />
    </SettingGroup>
    <MaterialIconSettings :is-current="isCurrent" />
  </div>
</template>
<style scoped>
.appearance-settings {
  display: grid;
  gap: 1.5rem;
  min-width: 0;
}
.appearance-reading-preview {
  padding: 1.25rem;
  border: 1px solid var(--ui-border);
  border-radius: var(--app-radius);
  font-size: var(--font-size-reading);
  max-width: min(100%, var(--reading-width));
  overflow-wrap: anywhere;
}
.appearance-reading-preview h3 {
  font-size: 1.15em;
  margin: 0 0 var(--reading-paragraph-spacing);
}
.appearance-palette-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
  gap: 0.75rem 1.5rem;
}
.appearance-color-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  min-width: 0;
}
.appearance-color-row > :last-child {
  flex: 1;
  min-width: 0;
}
.appearance-swatch {
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  flex-shrink: 0;
}
.appearance-favorite-save,
.appearance-transfer-actions {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.appearance-favorite-save > :first-child {
  flex: 1;
  min-width: min(100%, 16rem);
}
.appearance-favorites {
  list-style: none;
  margin: 0;
  padding: 0;
}
.appearance-favorites li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  border-bottom: 1px solid var(--ui-border-muted);
}
.appearance-favorites li > span {
  flex: 1;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  padding: 0.5rem 0;
}
</style>
