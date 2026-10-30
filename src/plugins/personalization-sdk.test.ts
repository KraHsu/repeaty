import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPluginApi } from './sdk'
import { useSettingsStore, type SettingsStore } from '../settings-store'
import { locale, setLocale, t } from '../i18n'

vi.mock('@repeaty-plugin-host', () => ({
  callPluginHost: vi.fn(async () => ({})),
  readPluginData: vi.fn(),
  writePluginData: vi.fn(),
}))

const cleanups: (() => void)[] = []
function memoryStore() {
  const values = new Map<string, string>()
  const adapter: SettingsStore = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
  return { values, adapter }
}
function activation(id = 'lookup') {
  let current = true
  const disposers: (() => void)[] = []
  const api = createPluginApi(
    {
      id,
      name: id,
      version: '1.0.0',
      kind: 'frontend',
      apiVersion: 1,
      dataVersion: 1,
    },
    'library-a',
    disposers,
    () => current,
  )
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    disposers.forEach((stop) => stop())
  }
  cleanups.push(dispose)
  return {
    api,
    dispose,
    switchLibrary: () => {
      current = false
    },
  }
}
function deferred() {
  let resolve!: () => void, reject!: (reason: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  useSettingsStore(memoryStore().adapter)
  setLocale('en')
})
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  useSettingsStore(memoryStore().adapter)
  setLocale('zh-CN')
  vi.clearAllMocks()
})

it('persists to plugin-owned keys and preserves values across a replacement activation', async () => {
  const store = memoryStore()
  useSettingsStore(store.adapter)
  const first = activation('lookup'),
    second = activation('translator')
  await first.api.persistSetting('targets', '["first"]')
  await second.api.persistSetting('targets', '["second"]')
  expect(first.api.readSetting('targets')).toBe('["first"]')
  expect(second.api.readSetting('targets')).toBe('["second"]')
  expect(store.values).toEqual(
    new Map([
      ['plugin:lookup:targets', '["first"]'],
      ['plugin:translator:targets', '["second"]'],
    ]),
  )
  first.dispose()
  expect(activation('lookup').api.readSetting('targets')).toBe('["first"]')
})

it('does not report success before the current settings adapter commits, and propagates save failure', async () => {
  const store = memoryStore(),
    saved = deferred(),
    failure = new Error('disk-full')
  useSettingsStore({
    ...store.adapter,
    async setItem(key, value) {
      await saved.promise
      store.values.set(key, value)
    },
  })
  const { api } = activation()
  const completed = vi.fn()
  const result = api.persistSetting('targets', 'new').then(completed, (error: unknown) => error)
  await Promise.resolve()
  expect(completed).not.toHaveBeenCalled()
  expect(api.readSetting('targets')).toBeNull()
  saved.reject(failure)
  expect(await result).toBe(failure)
  expect(completed).not.toHaveBeenCalled()
  expect(store.values.size).toBe(0)
})

it('turns synchronous adapter exceptions into rejected save promises', async () => {
  const failure = new Error('read-only-store')
  useSettingsStore({
    getItem: () => 'retained',
    setItem: () => {
      throw failure
    },
  })
  const { api } = activation()
  await expect(api.persistSetting('targets', 'replacement')).rejects.toBe(failure)
  expect(api.readSetting('targets')).toBe('retained')
})

it('finishes an already-started write only in its original library and rejects its late success', async () => {
  const first = memoryStore(),
    second = memoryStore(),
    pending = deferred()
  useSettingsStore({
    ...first.adapter,
    async setItem(key, value) {
      await pending.promise
      first.values.set(key, value)
    },
  })
  const active = activation()
  const result = active.api.persistSetting('targets', 'library-a').catch((error: unknown) => error)
  active.switchLibrary()
  useSettingsStore(second.adapter)
  pending.resolve()
  expect(await result).toBeInstanceOf(Error)
  expect(first.values.get('plugin:lookup:targets')).toBe('library-a')
  expect(second.values.size).toBe(0)
  await expect(active.api.persistSetting('targets', 'must-not-write-b')).rejects.toThrow(
    '学习库已切换',
  )
  expect(second.values.size).toBe(0)
})

it('rejects a save completing after uninstall and never invokes the adapter for later writes', async () => {
  const pending = deferred(),
    write = vi.fn(() => pending.promise)
  useSettingsStore({ getItem: () => null, setItem: write })
  const active = activation()
  const result = active.api.persistSetting('targets', 'old').catch((error: unknown) => error)
  active.dispose()
  pending.resolve()
  expect(await result).toBeInstanceOf(Error)
  await expect(active.api.persistSetting('targets', 'later')).rejects.toThrow('插件已卸载')
  expect(write).toHaveBeenCalledOnce()
})

it('keeps each plugin translation catalog independent and reacts to the shared locale without replacing host text', () => {
  const first = activation('first').api.createTranslator({
    en: { 保存: 'Save in first', welcome: 'Hello {name}', firstOnly: 'First only' },
    ja: { welcome: '{name} さん' },
  })
  const second = activation('second').api.createTranslator({
    en: { 保存: 'Save in second', welcome: 'Welcome {name}' },
    ja: { welcome: 'ようこそ {name}' },
  })
  expect(first('保存')).toBe('Save in first')
  expect(second('保存')).toBe('Save in second')
  expect(t('保存')).toBe('Save')
  setLocale('ja')
  expect(locale.value).toBe('ja')
  expect(first('welcome', { name: '{private}' })).toBe('{private} さん')
  expect(second('welcome', { name: 'Alex' })).toBe('ようこそ Alex')
  expect(second('firstOnly')).toBe('firstOnly')
  expect(first('保存')).toBe('Save in first')
  expect(t('保存')).not.toBe('Save in first')
  expect(t('保存')).not.toBe('Save in second')
})

it('uses an explicit fallback and own message/parameter keys without recursively expanding user text', () => {
  const catalog = Object.assign(
    Object.create({ inherited: 'do not expose' }) as Record<string, string>,
    {
      message: '{name} / {missing} / {{c1::text}}',
      zero: '{count}',
    },
  )
  const translate = activation().api.createTranslator({ 'zh-CN': catalog }, 'zh-CN')
  setLocale('fr')
  const parameters = Object.assign(
    Object.create({ missing: 'inherited secret' }) as Record<string, string>,
    { name: '{missing}' },
  )
  expect(translate('message', parameters)).toBe('{missing} / {missing} / {{c1::text}}')
  expect(translate('zero', { count: 0 })).toBe('0')
  expect(translate('inherited')).toBe('inherited')
  expect(translate('constructor')).toBe('constructor')
})
