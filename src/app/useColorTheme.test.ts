// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useColorTheme } from './useColorTheme'
import {
  listenPreferences,
  PREFERENCES_KEY,
  preferenceError,
  preferences,
  restorePreferences,
  setPreference,
} from '../preferences'
import { useSettingsStore } from '../settings-store'

const cleanups: (() => void)[] = []
let values: Map<string, string>

beforeEach(() => {
  values = new Map()
  useSettingsStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  })
  preferenceError.value = ''
  restorePreferences()
})

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.documentElement.classList.remove('dark')
  document.documentElement.style.removeProperty('color-scheme')
  vi.restoreAllMocks()
})

function mockSystemTheme(dark: boolean) {
  const media = Object.assign(new EventTarget(), {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
  })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  return {
    media,
    change(dark: boolean) {
      media.matches = dark
      media.dispatchEvent(new Event('change'))
    },
  }
}

function mountTheme() {
  const scope = effectScope()
  scope.run(useColorTheme)
  cleanups.push(() => scope.stop())
  return () => scope.stop()
}

function expectTheme(theme: 'light' | 'dark') {
  expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
  expect(document.documentElement.style.colorScheme).toBe(theme)
}

it('defaults to the system appearance, tracks changes, and lets explicit choices override them', () => {
  const system = mockSystemTheme(true)
  mountTheme()
  expect(preferences.theme).toBe('system')
  expectTheme('dark')
  system.change(false)
  expectTheme('light')

  setPreference('theme', 'dark')
  expectTheme('dark')
  system.change(false)
  expectTheme('dark')
  setPreference('theme', 'light')
  system.change(true)
  expectTheme('light')

  setPreference('theme', 'system')
  expectTheme('dark')
  expect(JSON.parse(values.get(PREFERENCES_KEY)!)).toMatchObject({ theme: 'system' })
})

it('restores saved choices at startup and after settings hydration without writing defaults', () => {
  mockSystemTheme(false)
  values.set(PREFERENCES_KEY, JSON.stringify({ theme: 'dark', popupWarning: false }))
  restorePreferences()
  mountTheme()
  expectTheme('dark')
  expect(preferences.popupWarning).toBe(false)

  // Desktop hydration replaces the active settings records before restoring preferences.
  values = new Map([[PREFERENCES_KEY, JSON.stringify({ theme: 'light' })]])
  restorePreferences()
  expectTheme('light')
  expect(preferences.popupWarning).toBe(true)

  values.clear()
  restorePreferences()
  expect(preferences.theme).toBe('system')
  expectTheme('light')
  expect(values.size).toBe(0)
})

it('accepts storage changes and falls back to system for missing, invalid, or corrupt preferences', () => {
  mockSystemTheme(true)
  mountTheme()
  cleanups.push(listenPreferences())
  values.set(PREFERENCES_KEY, JSON.stringify({ theme: 'light' }))
  window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCES_KEY }))
  expectTheme('light')
  for (const record of ['{}', '{"theme":"sepia"}', '{broken']) {
    values.set(PREFERENCES_KEY, record)
    window.dispatchEvent(new StorageEvent('storage', { key: PREFERENCES_KEY }))
    expect(preferences.theme).toBe('system')
    expectTheme('dark')
  }
})

it('cleans up system listeners and preference watchers when the application scope is disposed', () => {
  const system = mockSystemTheme(false)
  const added = vi.spyOn(system.media, 'addEventListener')
  const removed = vi.spyOn(system.media, 'removeEventListener')
  const unmount = mountTheme()
  unmount()
  system.change(true)
  setPreference('theme', 'dark')
  expectTheme('light')
  expect(removed).toHaveBeenCalledWith('change', added.mock.calls[0]![1])

  const unmountAgain = mountTheme()
  expectTheme('dark')
  expect(added).toHaveBeenCalledTimes(2)
  unmountAgain()
  expect(removed).toHaveBeenCalledTimes(2)
})

it('applies a choice immediately and reports failure when its setting cannot be saved', async () => {
  mockSystemTheme(false)
  mountTheme()
  useSettingsStore({
    getItem: () => null,
    setItem: () => Promise.reject(new Error('disk unavailable')),
  })
  expect(setPreference('theme', 'dark')).toBe(true)
  expectTheme('dark')
  await Promise.resolve()
  expect(preferenceError.value).toBe('设置已生效，但未能保存；下次打开时可能恢复默认设置。')
})
