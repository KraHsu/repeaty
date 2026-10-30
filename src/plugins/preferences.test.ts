// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../settings-store'
import { createPluginPreferences, PLUGIN_PREFERENCES_KEY } from './preferences'

afterEach(() => useSettingsStore(localStorage))

it('waits for the default settings adapter without publishing preferences before scope checks', async () => {
  const values = new Map<string, string>()
  let finish!: () => void
  useSettingsStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      values.set(key, value)
    },
  })
  const preferences = createPluginPreferences()
  const complete = vi.fn()
  const saving = preferences.persistPluginPreferences({ sample: false }).then(complete)
  expect(complete).not.toHaveBeenCalled()
  expect(values.size).toBe(0)
  finish()
  await saving
  expect(complete).toHaveBeenCalledOnce()
  expect(preferences.pluginPreferences.value).toEqual({})
  preferences.restorePluginPreferences()
  expect(preferences.pluginPreferences.value).toEqual({ sample: false })
})

it('keeps custom durable writes with the same adapter that restores preferences', async () => {
  const otherStore = vi.fn()
  useSettingsStore({ getItem: () => null, setItem: otherStore })
  const values = new Map<string, string>()
  const bestEffort = vi.fn()
  const preferences = createPluginPreferences({
    read: (key) => values.get(key) ?? null,
    write: bestEffort,
    persist: (key, value) => {
      values.set(key, value)
    },
  })
  await preferences.persistPluginPreferences({ sample: false })
  expect(otherStore).not.toHaveBeenCalled()
  expect(bestEffort).not.toHaveBeenCalled()
  expect(values.get(PLUGIN_PREFERENCES_KEY)).toBe('{"sample":false}')
  preferences.restorePluginPreferences()
  expect(preferences.pluginPreferences.value.sample).toBe(false)
})

it('propagates durable failure without overwriting current in-memory preferences', async () => {
  let reject!: (issue: Error) => void
  const preferences = createPluginPreferences({
    read: () => '{"other":true}',
    write: vi.fn(),
    persist: () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail
      }),
  })
  preferences.restorePluginPreferences()
  const saving = preferences.persistPluginPreferences({ other: true, sample: false })
  const failed = expect(saving).rejects.toThrow('disk failed')
  reject(new Error('disk failed'))
  await failed
  expect(preferences.pluginPreferences.value).toEqual({ other: true })
})

it('does not interpret a fire-and-forget writer as a durable persister', async () => {
  const bestEffort = vi.fn()
  const globalWrite = vi.fn()
  useSettingsStore({ getItem: () => null, setItem: globalWrite })
  const preferences = createPluginPreferences({ read: () => null, write: bestEffort })
  await expect(preferences.persistPluginPreferences({ sample: false })).rejects.toThrow(
    '无法保存插件启停状态',
  )
  expect(bestEffort).not.toHaveBeenCalled()
  expect(globalWrite).not.toHaveBeenCalled()
})

it('preserves the existing best-effort enable toggle and its visible save error', () => {
  const preferences = createPluginPreferences({
    read: () => null,
    write: (_key, _value, fail) => {
      fail?.()
    },
  })
  preferences.savePluginPreference('sample', true)
  expect(preferences.pluginPreferences.value.sample).toBe(true)
  expect(preferences.pluginPreferenceError.value).toContain('插件开关已生效，但未能保存')
})
