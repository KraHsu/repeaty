import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../settings-store'
import {
  parseLanguagePack,
  saveLanguagePack,
  languagePacks,
  restoreLanguagePacks,
} from './language-packs'
import { translateCatalog } from './locales'
const store = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
beforeEach(() => useSettingsStore({ getItem: store.read, setItem: store.save }))
afterEach(() => {
  vi.resetAllMocks()
  languagePacks.value = {}
})
it('validates known keys and exact named placeholders without rejecting literal cloze syntax', () => {
  expect(
    parseLanguagePack(JSON.stringify({ version: 1, locale: 'ja', messages: { 保存: '保存する' } }))
      .messages['保存'],
  ).toBe('保存する')
  expect(() =>
    parseLanguagePack(
      JSON.stringify({ version: 1, locale: 'fr', messages: { '打开卡组 {p0}': 'Ouvrir' } }),
    ),
  ).toThrow('占位符')
  expect(() =>
    parseLanguagePack('{"version":1,"locale":"fr","messages":{"__proto__":"unsafe"}}'),
  ).toThrow('未知')
})
it('does not replace active translations after failure or a workspace switch', async () => {
  store.save.mockRejectedValueOnce(new Error('disk full'))
  const pack = { version: 1 as const, locale: 'ja' as const, messages: { 保存: '保存する' } }
  await expect(saveLanguagePack(pack)).rejects.toThrow()
  expect(languagePacks.value).toEqual({})
  let done!: () => void
  store.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        done = resolve
      }),
  )
  const pending = saveLanguagePack(pack)
  restoreLanguagePacks()
  done()
  await pending
  expect(languagePacks.value).toEqual({})
})
it('keeps plugin catalogs and user parameters separate from each other and host content', () => {
  const first = {
    en: { greeting: 'Hello {name}', onlyFirst: 'First' },
    ja: { greeting: '{name} さん' },
  }
  const second = { en: { greeting: 'Welcome {name}' } }
  expect(translateCatalog(first, 'ja', 'greeting', { name: '{secret}' })).toBe('{secret} さん')
  expect(translateCatalog(second, 'ja', 'greeting', { name: 'A' })).toBe('Welcome A')
  expect(translateCatalog(second, 'ja', 'onlyFirst')).toBe('onlyFirst')
  expect(translateCatalog(first, 'en', 'constructor')).toBe('constructor')
})
