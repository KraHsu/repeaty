import { beforeEach, expect, it, vi } from 'vitest'
import {
  preferences,
  preferenceError,
  restorePreferences,
  initializePreferences,
  setPreference,
} from './preferences'

const host = vi.hoisted(() => ({ settings: new Map<string, string>(), fail: false }))
vi.mock('@repeaty/plugin-api', () => ({
  readSetting: (key: string) => host.settings.get(key) ?? null,
  writeSetting: (key: string, value: string) => {
    if (host.fail) throw new Error('Storage unavailable')
    host.settings.set(key, value)
  },
}))
beforeEach(() => {
  host.settings.clear()
  host.fail = false
  restorePreferences()
})

it('restores plugin-owned preferences and safely replaces malformed values with defaults', () => {
  host.settings.set('preferences', JSON.stringify({ historyLength: 25, historyAfterReveal: false }))
  restorePreferences()
  expect(preferences).toEqual({ historyLength: 25, historyAfterReveal: false })
  host.settings.set(
    'preferences',
    JSON.stringify({ historyLength: 51, historyAfterReveal: 'false' }),
  )
  restorePreferences()
  expect(preferences).toEqual({ historyLength: 10, historyAfterReveal: true })
  host.settings.set('preferences', 'broken JSON')
  restorePreferences()
  expect(preferences).toEqual({ historyLength: 10, historyAfterReveal: true })
})

it('keeps invalid edits out of persistence while saving both settings together', () => {
  expect(setPreference('historyLength', 0)).toBe(false)
  expect(setPreference('historyLength', 1.5)).toBe(false)
  expect(host.settings.size).toBe(0)
  expect(setPreference('historyLength', 50)).toBe(true)
  expect(setPreference('historyAfterReveal', false)).toBe(true)
  expect(JSON.parse(host.settings.get('preferences')!)).toEqual({
    historyLength: 50,
    historyAfterReveal: false,
  })
})

it('keeps the active display setting and reports when the host cannot persist it', () => {
  host.fail = true
  expect(setPreference('historyLength', 15)).toBe(true)
  expect(preferences.historyLength).toBe(15)
  initializePreferences()
  expect(preferences.historyLength).toBe(15)
  expect(preferenceError.value).toContain('未能保存')
  expect(host.settings.size).toBe(0)
  host.fail = false
  expect(setPreference('historyLength', 20)).toBe(true)
  expect(preferenceError.value).toBe('')
})
