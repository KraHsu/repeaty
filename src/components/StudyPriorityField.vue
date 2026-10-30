<script setup lang="ts">
import { computed } from 'vue'
import { SettingField } from './ui'
import { t } from '../i18n'
const props = defineProps<{
  modelValue?: number
  inheritedValue: number
  inheritedFrom?: string
  disabled?: boolean
  label?: string
  id?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>()
const options = computed(() => [
  { value: 'inherit', label: `${t('继承上级')} · ${props.inheritedValue}` },
  { value: '0', label: t('0 · 绝对优先') },
  ...Array.from({ length: 9 }, (_, index) => ({
    value: String(index + 1),
    label:
      index === 0
        ? t('1 · 最高常规优先级')
        : index === 8
          ? t('9 · 最低常规优先级')
          : String(index + 1),
  })),
])
</script>
<template>
  <SettingField
    :id="id"
    :label="label ?? t('学习优先级')"
    type="select"
    :disabled="disabled"
    :model-value="modelValue === undefined ? 'inherit' : String(modelValue)"
    :options="options"
    :description="
      [
        inheritedFrom ? t('继承来源：{p0}。', { p0: inheritedFrom }) : '',
        t('0 为绝对优先，1–9 从高到低；选择继承时随上级设置变化。优先级不修改到期日期。'),
      ]
        .filter(Boolean)
        .join(' ')
    "
    @update:model-value="
      emit('update:modelValue', $event === 'inherit' ? undefined : Number($event))
    "
  />
</template>
