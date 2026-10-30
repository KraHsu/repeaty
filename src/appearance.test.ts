// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest'
import { effectScope } from 'vue'
import {
  appearance,
  appearanceError,
  APPEARANCE_KEY,
  appearanceVariables,
  contrastRatio,
  defaultMaterialIcons,
  readableInk,
  resetAppearance,
  restoreAppearance,
  setAppearance,
} from './appearance'
import { restorePreferences } from './preferences'
import { useSettingsStore } from './settings-store'
import { useColorTheme } from './app/useColorTheme'
let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  useSettingsStore({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  })
  restorePreferences()
})
it('persists validated appearance and restores the selected library without saving defaults', () => {
  expect(data.size).toBe(0)
  setAppearance('readingSize', 24)
  setAppearance('readingWidth', 600)
  setAppearance('readingFont', 'Noto Serif SC')
  restoreAppearance()
  expect(appearance).toMatchObject({
    readingSize: 24,
    readingWidth: 600,
    readingFont: 'Noto Serif SC',
  })
  data = new Map()
  restorePreferences()
  expect(appearance).toMatchObject({ readingSize: 18, readingWidth: 800, readingFont: '' })
  expect(data.size).toBe(0)
})
it('rejects CSS injection and invalid ranges without altering saved values', () => {
  expect(setAppearance('readingFont', 'Arial; background:url(https://example.com)')).toBe(false)
  expect(setAppearance('interfaceScale', 1000)).toBe(false)
  expect(setAppearance('light', { ...appearance.light, accent: 'url(x)' })).toBe(false)
  expect(data.size).toBe(0)
  expect(appearanceError.value).not.toBe('')
})
it('recovers from corrupt records and malformed nested palettes', () => {
  data.set(APPEARANCE_KEY, '{bad')
  restoreAppearance()
  expect(appearance.readingSize).toBe(18)
  data.set(APPEARANCE_KEY, JSON.stringify({ readingSize: 22, light: { accent: 'red' } }))
  restoreAppearance()
  expect(appearance.readingSize).toBe(22)
  expect(appearance.light.accent).toBe('#34674d')
})
it('selects legible button ink for dark and light accents', () => {
  expect(readableInk('#34674d')).toBe('#ffffff')
  expect(readableInk('#a2c7a3')).toBe('#14271f')
  expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  expect(appearanceVariables(appearance, false)['--ui-text-inverted']).toBe('#ffffff')
  expect(appearanceVariables(appearance, true)['--ui-text-inverted']).toBe('#14271f')
})
it('clears custom CSS on reset and applies changes to the shared root', () => {
  const scope = effectScope()
  scope.run(useColorTheme)
  setAppearance('font', 'Noto Sans')
  setAppearance('readingSize', 24)
  expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe('Noto Sans, sans-serif')
  expect(document.documentElement.style.getPropertyValue('--font-size-reading')).toBe('1.5rem')
  resetAppearance()
  expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe('')
  expect(document.documentElement.style.getPropertyValue('--font-size-reading')).toBe('1.125rem')
  scope.stop()
})
it('keeps old asynchronous storage errors out of the next library', async () => {
  let fail!: (error: Error) => void
  useSettingsStore({
    getItem: () => null,
    setItem: () =>
      new Promise<void>((_, reject) => {
        fail = reject
      }),
  })
  setAppearance('readingSize', 22)
  restoreAppearance()
  fail(new Error('old disk'))
  await Promise.resolve()
  expect(appearanceError.value).toBe('')
})
it('reports current persistence failure while preserving the session choice', async () => {
  useSettingsStore({ getItem: () => null, setItem: () => Promise.reject(new Error('disk')) })
  setAppearance('readingSize', 22)
  await Promise.resolve()
  expect(appearance.readingSize).toBe(22)
  expect(appearanceError.value).toContain('未能保存')
})
it('allows bounded SVG path geometry without accepting markup or external resources', () => {
  expect(
    setAppearance('materialIcons', {
      ...defaultMaterialIcons,
      pending: { ...defaultMaterialIcons.pending, shape: 'custom', path: 'M2 2L22 22Z' },
    }),
  ).toBe(true)
  const saved = data.get(APPEARANCE_KEY)
  expect(
    setAppearance('materialIcons', {
      ...defaultMaterialIcons,
      pending: { ...defaultMaterialIcons.pending, path: '<svg onload="alert(1)">' },
    }),
  ).toBe(false)
  expect(data.get(APPEARANCE_KEY)).toBe(saved)
})
