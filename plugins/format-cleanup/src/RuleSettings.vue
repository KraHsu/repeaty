<script setup lang="ts">
import { text } from './text'
import { SettingField, SettingSection, UiButton, UiNotice } from '@repeaty/plugin-api'
import type { CleanupSettings } from './settings'
import type { CleanupRule } from './cleanup'
const props = defineProps<{ settings: CleanupSettings }>()
function toggle(key: 'trimTrailing' | 'collapseBlankLines' | 'normalizeIndent', value: unknown) {
  props.settings.options[key] = Boolean(value)
  props.settings.save()
}
function update(index: number, change: Partial<CleanupRule>) {
  Object.assign(props.settings.options.rules[index]!, change)
  props.settings.save()
}
function add() {
  props.settings.options.rules.push({ kind: 'literal', find: '', replace: '', enabled: true })
  props.settings.save()
}
function remove(index: number) {
  props.settings.options.rules.splice(index, 1)
  props.settings.save()
}
</script>

<template>
  <div class="cleanup-rules">
    <UiNotice v-if="settings.error.value" tone="error">{{ text(settings.error.value) }}</UiNotice>
    <SettingField
      type="switch"
      :label="text('清理行尾空白')"
      :description="text('保留 Markdown 的两个空格换行标记。')"
      :model-value="settings.options.trimTrailing"
      @update:model-value="toggle('trimTrailing', $event)"
    />
    <SettingField
      type="switch"
      :label="text('合并连续空行')"
      :description="text('段落之间最多保留一个空行。')"
      :model-value="settings.options.collapseBlankLines"
      @update:model-value="toggle('collapseBlankLines', $event)"
    />
    <SettingField
      type="switch"
      :label="text('统一缩进')"
      :description="text('可编辑段落中的制表符转换为四个空格；代码缩进保持原样。')"
      :model-value="settings.options.normalizeIndent"
      @update:model-value="toggle('normalizeIndent', $event)"
    />
    <SettingSection
      :title="text('自定义替换')"
      :description="text('按顺序执行，始终保护代码、链接地址与 YAML。正则支持捕获组替换，如 $1。')"
    >
      <div v-for="(rule, index) in settings.options.rules" :key="index" class="cleanup-rule">
        <div class="cleanup-rule-head">
          <strong>{{ text('规则') }} {{ index + 1 }}</strong
          ><UiButton variant="ghost" @click="remove(index)">{{ text('删除') }}</UiButton>
        </div>
        <SettingField
          type="select"
          :label="text('匹配方式')"
          :model-value="rule.kind"
          :options="[
            { value: 'literal', label: text('文字') },
            { value: 'regex', label: text('正则表达式') },
          ]"
          @update:model-value="update(index, { kind: $event === 'regex' ? 'regex' : 'literal' })"
        />
        <SettingField
          type="text"
          :label="text('查找')"
          :model-value="rule.find"
          :maxlength="1000"
          monospace
          @update:model-value="update(index, { find: String($event) })"
        />
        <SettingField
          type="text"
          :label="text('替换为')"
          :model-value="rule.replace"
          :maxlength="1000"
          monospace
          :placeholder="text('留空表示删除')"
          @update:model-value="update(index, { replace: String($event) })"
        />
        <SettingField
          v-if="rule.kind === 'regex'"
          type="text"
          :label="text('正则标志')"
          :model-value="rule.flags ?? ''"
          :placeholder="text('i 忽略大小写；m 多行')"
          :maxlength="4"
          @update:model-value="update(index, { flags: String($event) })"
        />
        <SettingField
          type="switch"
          :label="text('启用此规则')"
          :model-value="rule.enabled !== false"
          @update:model-value="update(index, { enabled: Boolean($event) })"
        />
      </div>
      <UiButton variant="secondary" :disabled="settings.options.rules.length >= 32" @click="add">{{
        text('添加规则')
      }}</UiButton>
    </SettingSection>
  </div>
</template>

<style scoped>
.cleanup-rules,
.cleanup-rule {
  display: grid;
  gap: var(--space-md, 1rem);
}
.cleanup-rule {
  padding-block: var(--space-md, 1rem);
  border-top: 1px solid var(--ui-border);
}
.cleanup-rule-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
</style>
