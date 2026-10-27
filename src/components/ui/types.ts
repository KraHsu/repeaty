export type SettingValue = string | number | boolean | string[]
export type SettingFieldType =
  | 'text'
  | 'password'
  | 'textarea'
  | 'number'
  | 'select'
  | 'radio'
  | 'multiselect'
  | 'range'
  | 'switch'
  | 'checkbox'

export interface SettingOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export interface SettingFieldProps {
  id?: string
  type?: SettingFieldType
  label: string
  description?: string
  error?: string
  modelValue: SettingValue
  options?: readonly SettingOption[]
  disabled?: boolean
  readonly?: boolean
  placeholder?: string
  min?: number
  max?: number
  step?: number | 'any'
  unit?: string
  rows?: number
  autocomplete?: string
  autocapitalize?: string
  maxlength?: number
  inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url'
  spellcheck?: boolean
  monospace?: boolean
  commit?: 'input' | 'change'
  layout?: 'row' | 'stack'
}
