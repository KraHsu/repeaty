import { expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { validateSettingsContribution, type PluginSettingsContribution } from './settings'

function contribution(): PluginSettingsContribution {
  return {
    id: 'display',
    title: 'Display',
    fields: [
      {
        key: 'historyLength',
        type: 'number',
        label: 'Length',
        modelValue: 10,
        min: 1,
        max: 50,
        onChange: vi.fn(),
      },
    ],
  }
}

it('accepts reactive field getters without copying values or invoking change handlers', () => {
  const state = reactive({ value: 10 })
  const entry = contribution()
  entry.fields = [
    {
      ...entry.fields![0]!,
      get modelValue() {
        return state.value
      },
    },
  ]
  expect(() => validateSettingsContribution(entry)).not.toThrow()
  state.value = 12
  expect(entry.fields[0]!.modelValue).toBe(12)
  expect(entry.fields[0]!.onChange).not.toHaveBeenCalled()
})

it('rejects ambiguous, empty and duplicate settings definitions', () => {
  for (const entry of [
    { id: undefined, title: 'Display', component: {} },
    { id: 'invalid id', title: 'Display', component: {} },
    { id: 'display', title: ' ', component: {} },
    { id: 'display', title: 'Display' },
    { ...contribution(), component: {} },
    { ...contribution(), fields: [] },
    { ...contribution(), fields: [contribution().fields![0]!, contribution().fields![0]!] },
  ])
    expect(() =>
      validateSettingsContribution(entry as unknown as PluginSettingsContribution),
    ).toThrow()
})

it('checks field values and ranges before exposing host-rendered controls', () => {
  for (const invalid of [
    { type: 'switch', modelValue: 'true' },
    { type: 'range', modelValue: NaN },
    { type: 'multiselect', modelValue: 'one' },
    { type: 'select', modelValue: 1 },
    { type: 'number', min: 5, max: 2 },
    { type: 'number', step: 0 },
    { options: [{ value: 'one', label: 42 }] },
    { onChange: undefined },
  ]) {
    const entry = contribution()
    entry.fields = [{ ...entry.fields![0]!, ...invalid }] as PluginSettingsContribution['fields']
    expect(() => validateSettingsContribution(entry)).toThrow()
  }
})
