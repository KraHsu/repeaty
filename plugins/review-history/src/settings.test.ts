import { beforeEach, expect, it, vi } from 'vitest'
import type { PluginSettingsContribution, ReviewPanelPlugin } from '@repeaty/plugin-api'

const host = vi.hoisted(() => ({
  locale: { value: 'zh-CN' as 'zh-CN' | 'en' },
  settings: new Map<string, string>(),
  registrations: [] as PluginSettingsContribution[],
  fail: false,
}))
vi.mock('@repeaty/plugin-api', () => ({
  locale: host.locale,
  t: (value: string | Error) => (value instanceof Error ? value.message : value),
  readSetting: (key: string) => host.settings.get(key) ?? null,
  writeSetting: (key: string, value: string) => {
    if (host.fail) throw new Error('Storage unavailable')
    host.settings.set(key, value)
  },
  registerSettings: (contribution: PluginSettingsContribution) => {
    host.registrations.push(contribution)
    return () => {
      const index = host.registrations.indexOf(contribution)
      if (index !== -1) host.registrations.splice(index, 1)
    }
  },
}))

let activate: () => ReviewPanelPlugin
beforeEach(async () => {
  vi.resetModules()
  host.settings.clear()
  host.registrations.splice(0)
  host.locale.value = 'zh-CN'
  host.fail = false
  activate = (await import('./index')).default
})

it('registers declarative settings with existing saved preferences instead of an embedded settings view', () => {
  host.settings.set('preferences', JSON.stringify({ historyLength: 23, historyAfterReveal: false }))
  const definition = activate()
  expect(definition).not.toHaveProperty('settings')
  expect(host.registrations).toHaveLength(1)
  const contribution = host.registrations[0]!
  expect(contribution.id).toBe('display')
  expect(contribution.category?.map(({ id }) => id)).toEqual(['study', 'review'])
  expect(contribution.title).toBe('答题历史')
  expect(contribution.component).toBeUndefined()
  expect(contribution.fields?.map(({ key, modelValue }) => ({ key, modelValue }))).toEqual([
    { key: 'historyLength', modelValue: 23 },
    { key: 'historyAfterReveal', modelValue: false },
  ])
})

it('maps host field edits to the original preference record and rejects wrong value types', () => {
  activate()
  const [length, afterReveal] = host.registrations[0]!.fields!
  length!.onChange(7)
  afterReveal!.onChange(false)
  expect(length!.modelValue).toBe(7)
  expect(afterReveal!.modelValue).toBe(false)
  const saved = JSON.stringify({ historyLength: 7, historyAfterReveal: false })
  expect(host.settings.get('preferences')).toBe(saved)
  length!.onChange('20')
  length!.onChange(51)
  afterReveal!.onChange('true')
  expect(host.settings.get('preferences')).toBe(saved)
  expect([...host.settings.keys()]).toEqual(['preferences'])
})

it('keeps registered labels, values and save errors reactive to the plugin state and host language', () => {
  activate()
  const contribution = host.registrations[0]!
  const length = contribution.fields![0]!
  expect(length.label).toBe('显示条数')
  host.locale.value = 'en'
  expect(contribution.title).toBe('Review history')
  expect(contribution.category?.map(({ title }) => title)).toEqual(['Study', 'Review'])
  expect(length.label).toBe('Number of ratings')
  host.fail = true
  length.onChange(15)
  expect(length.modelValue).toBe(15)
  expect(contribution.error).toContain('could not be saved')
  expect(host.settings.size).toBe(0)
  host.fail = false
  length.onChange(20)
  expect(contribution.error).toBeUndefined()
})
