import type { Component } from 'vue'
import type { SettingFieldProps, SettingValue } from '../components/ui/types'

/** The host renders each field through its shared SettingField component. */
export interface PluginSettingField extends SettingFieldProps {
  key: string
  onChange: (value: SettingValue) => void | Promise<void>
}

/** Getters may read plugin-owned reactive state; the host does not copy preference values. */
export interface PluginSettingsContribution {
  id: string
  title: string
  description?: string
  fields?: readonly PluginSettingField[]
  component?: Component
  error?: string
}

export type RegisterPluginSettings = (contribution: PluginSettingsContribution) => () => void

const fieldTypes = new Set([
  'text',
  'password',
  'textarea',
  'number',
  'select',
  'radio',
  'multiselect',
  'range',
  'switch',
  'checkbox',
])
const valueIsValid = (value: unknown): value is SettingValue =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'))

export function validateSettingsContribution(contribution: PluginSettingsContribution) {
  if (
    !contribution ||
    typeof contribution !== 'object' ||
    typeof contribution.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(contribution.id) ||
    typeof contribution.title !== 'string' ||
    !contribution.title.trim()
  )
    throw new Error('插件设置定义无效。')
  if ((contribution.fields !== undefined) === (contribution.component !== undefined))
    throw new Error('插件设置必须提供字段或自定义视图。')
  if (
    contribution.component !== undefined &&
    (!contribution.component ||
      Array.isArray(contribution.component) ||
      !['object', 'function'].includes(typeof contribution.component))
  )
    throw new Error('插件设置视图无效。')
  if (contribution.description !== undefined && typeof contribution.description !== 'string')
    throw new Error('插件设置说明无效。')
  if (contribution.error !== undefined && typeof contribution.error !== 'string')
    throw new Error('插件设置错误信息无效。')
  if (contribution.fields === undefined) return
  if (!Array.isArray(contribution.fields) || contribution.fields.length === 0)
    throw new Error('插件设置字段不能为空。')
  const keys = new Set<string>()
  for (const field of contribution.fields as readonly PluginSettingField[]) {
    if (
      !field ||
      typeof field !== 'object' ||
      typeof field.key !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(field.key) ||
      keys.has(field.key) ||
      typeof field.label !== 'string' ||
      !field.label.trim() ||
      (field.type !== undefined && !fieldTypes.has(field.type)) ||
      typeof field.onChange !== 'function' ||
      !valueIsValid(field.modelValue)
    )
      throw new Error('插件设置字段无效或标识重复。')
    keys.add(field.key)
    const type = field.type ?? 'text'
    const value = field.modelValue
    if (
      (['switch', 'checkbox'].includes(type) && typeof value !== 'boolean') ||
      (['number', 'range'].includes(type) && typeof value !== 'number') ||
      (type === 'multiselect' && !Array.isArray(value)) ||
      (['text', 'password', 'textarea', 'select', 'radio'].includes(type) &&
        typeof value !== 'string')
    )
      throw new Error('插件设置字段的值与类型不一致。')
    for (const bound of [field.min, field.max])
      if (bound !== undefined && !Number.isFinite(bound)) throw new Error('插件设置范围无效。')
    if (
      (field.min !== undefined && field.max !== undefined && field.min > field.max) ||
      (field.step !== undefined &&
        field.step !== 'any' &&
        (!Number.isFinite(field.step) || field.step <= 0))
    )
      throw new Error('插件设置范围无效。')
    if (
      field.options !== undefined &&
      (!Array.isArray(field.options) ||
        field.options.some(
          (option) =>
            !option || typeof option.value !== 'string' || typeof option.label !== 'string',
        ))
    )
      throw new Error('插件设置选项无效。')
  }
}
