import { beforeEach, expect, it } from 'vitest'
import {
  navigationPreferences,
  orderedNavigation,
  restoreNavigationPreferences,
  setNavigationPreference,
} from './navigation-preferences'
import { useSettingsStore } from './settings-store'
let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  useSettingsStore({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  })
  restoreNavigationPreferences()
})
it('keeps recovery entries visible and preserves choices on reload', () => {
  setNavigationPreference('hidden', ['cards', 'settings', 'help'])
  setNavigationPreference('icons', { cards: 'star' })
  restoreNavigationPreferences()
  expect(navigationPreferences.hidden).toEqual(['cards'])
  expect(navigationPreferences.icons.cards).toBe('star')
})
it('only reorders currently available entries and retains stable order for new plugins', () => {
  setNavigationPreference('order', ['plugin:removed/page', 'cards', 'overview'])
  expect(
    orderedNavigation([
      { id: 'overview' },
      { id: 'cards' },
      { id: 'plugin:new/page' },
      { id: 'settings' },
    ]).map((x) => x.id),
  ).toEqual(['cards', 'overview', 'plugin:new/page', 'settings'])
})
it('restores separate library choices without persisting defaults', () => {
  setNavigationPreference('hidden', ['cards'])
  data = new Map()
  restoreNavigationPreferences()
  expect(navigationPreferences.hidden).toEqual([])
  expect(data.size).toBe(0)
})
