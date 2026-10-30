import { installApplicationState } from '../stores'
// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import App from '../App.vue'
import { createRepository } from '../core/storage'
import { emptyLibrary } from '../core/model'
import { initI18n, LOCALE_STORAGE_KEY, setLocale, t } from '.'

let app: VueApp | undefined
let host: HTMLDivElement
function languageInput() {
  const field = [...host.querySelectorAll<HTMLElement>('.ui-setting-field')].find((element) =>
    /^(界面语言|Interface language)$/.test(
      element.querySelector('label')?.textContent?.trim() ?? '',
    ),
  )
  return field?.querySelector<HTMLButtonElement>('[role="combobox"]')
}
async function chooseOption(control: HTMLElement, label: string) {
  control.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
  )
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (element) => element.textContent?.trim() === label,
  )!
  expect(option).toBeDefined()
  option.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const result = [...scope.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )
  if (!result) throw new Error(`Missing button: ${text}`)
  return result
}
async function input(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function language(value: string) {
  // Changing the locale is reactive even while a dialog or review is mounted.
  // The Settings UI itself is covered separately below: navigating there ends review.
  setLocale(value === 'en' ? 'en' : 'zh-CN')
  await nextTick()
}
async function start() {
  initI18n()
  app = createApp(App)
  installApplicationState(app)
  app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('.dashboard')).not.toBeNull())
  // Loading the library reveals the dashboard before snapshot metadata finishes.
  // Native .click() on a disabled button is a no-op; wait for the actual action.
  await vi.waitFor(() => expect(button(t('创建卡组')).disabled).toBe(false), { timeout: 5000 })
}
async function openLanguageSettings() {
  button(t('设置')).click()
  // Follow the category containing this control. Waiting for every dynamic import
  // also waits for unrelated gesture, language-pack and plugin settings in the parent
  // category; those panels have their own tests and need not mount for this flow.
  const category = '[data-category-key="general.appearance"]'
  await vi.waitFor(() => expect(host.querySelector(category)).not.toBeNull())
  host.querySelector<HTMLButtonElement>(category)!.click()
  await vi.waitFor(() => expect(languageInput()).toBeInstanceOf(HTMLButtonElement))
}
async function submitForm() {
  document
    .querySelector('[role="dialog"] form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
}
function ensureStandardsMode() {
  if (!document.doctype)
    document.insertBefore(
      document.implementation.createDocumentType('html', '', ''),
      document.documentElement,
    )
}
beforeAll(async () => {
  ensureStandardsMode()
  // This suite checks mounted localization and navigation, not Vite's cold module
  // compilation time. Prepare the real panels used below before the interactions;
  // mounting, navigation and installation state still run through the real app.
  // Appearance is also rendered alongside the language field in its category.
  await Promise.all([
    import('../components/PluginPanel.vue'),
    import('../components/SettingsPage.vue'),
    import('../components/AppearanceSettings.vue'),
  ])
})
beforeEach(async () => {
  ensureStandardsMode()
  localStorage.clear()
  vi.stubGlobal('navigator', { languages: ['en-US'] })
  document.head.innerHTML =
    '<meta name="description"><link rel="manifest" href="/manifest.webmanifest">'
  host = document.createElement('div')
  document.body.append(host)
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('repeaty')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  const repository = createRepository()
  await repository.load()
  await repository.save(emptyLibrary(), 0)
  await repository.close()
})
afterEach(async () => {
  app?.unmount()
  app = undefined
  await nextTick()
  host.remove()
  setLocale('zh-CN')
  vi.unstubAllGlobals()
})

// This integration mounts the real app twice and renders settings in both languages.
// Keep the per-transition waits bounded below, but give the complete reload flow its
// own budget: it exceeds the default 5s under the full suite's worker contention.
it('switches the mounted app, document metadata, and persists the explicit choice on reload', async () => {
  await start()
  expect(host.querySelector('h1')!.textContent).toContain('Overview')
  expect(document.documentElement.lang).toBe('en')
  expect(document.querySelector('link[rel="manifest"]')!.getAttribute('href')).toContain(
    'manifest.en.webmanifest',
  )
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
  expect(host.querySelector('.topbar select')).toBeNull()
  await openLanguageSettings()
  const languageSelect = languageInput()!
  expect(languageSelect.textContent).toContain('Follow system')
  await chooseOption(languageSelect, '中文（简体）')
  await nextTick()
  expect(host.querySelector('h1')!.textContent).toContain('设置')
  button('学习概览').click()
  await nextTick()
  expect(host.querySelector('h1')!.textContent).toContain('学习概览')
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(document.title).toBe('Repeaty · 卡片与间隔复习')
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN')
  app!.unmount()
  await start()
  expect(host.querySelector('h1')!.textContent).toContain('学习概览')
  await openLanguageSettings()
  expect(languageInput()!.textContent).toContain('中文（简体）')
}, 10_000)

it('opens plugin management separately from the shared settings categories', async () => {
  await start()
  button('Plugins').click()
  await vi.waitFor(() => expect(button('Plugins').getAttribute('aria-current')).toBe('page'))
  await vi.waitFor(
    () => {
      const diagnostic = `Active page: ${host.querySelector('.main-nav [aria-current="page"]')?.getAttribute('aria-label')}; main: ${host.querySelector('main')?.textContent?.slice(0, 300)}`
      expect(host.querySelector('.plugin-manager'), diagnostic).not.toBeNull()
    },
    { timeout: 5000 },
  )
  expect(host.querySelector('h1')?.textContent).toBe('Plugins')
  expect(host.querySelector('.plugin-manager')).not.toBeNull()
  expect(host.querySelector('.settings-categories')).toBeNull()
  expect(host.querySelector('.settings-configuration')).toBeNull()
  await openLanguageSettings()
  expect(host.querySelector('.settings-categories [data-category-key="plugins"]')).toBeNull()
  expect(host.querySelector('.plugin-manager')).toBeNull()
}, 10_000)

it('keeps drafts and revealed answers while translating authoring, statuses, and review controls', async () => {
  await start()
  button('Create deck').click()
  await nextTick()
  await input('#deck-name', '我的卡组')
  await submitForm()
  button('Add card').click()
  await nextTick()
  await input('#card-front', '学习空间')
  await input('#card-back', '中文答案')
  setLocale('zh-CN')
  await nextTick()
  expect(document.querySelector<HTMLInputElement>('#card-front')!.value).toBe('学习空间')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('保存卡片')
  setLocale('en')
  await submitForm()
  // Saving opens the lazy card table; wait for its import before checking the translated row.
  await vi.dynamicImportSettled()
  await vi.waitFor(() => expect(host.querySelector('tbody')?.textContent).toContain('学习空间'), {
    timeout: 5000,
  })
  expect(host.querySelector('.status-chip')!.textContent).toBe('New')
  button('Review').click()
  await nextTick()
  // The review shell appears before its lazy card renderer. Wait for those
  // imports explicitly; cold CI workers can take longer than waitFor's 1s default.
  await vi.dynamicImportSettled()
  await vi.waitFor(
    () => expect(host.querySelector('.card-question')!.textContent!.trim()).toBe('学习空间'),
    { timeout: 5000 },
  )
  button('Show answer').click()
  await vi.dynamicImportSettled()
  await vi.waitFor(() =>
    expect(host.querySelector('.card-answer')!.textContent).toContain('中文答案'),
  )
  await language('zh-CN')
  expect(host.querySelector('.card-answer')!.textContent).toContain('中文答案')
  expect(host.querySelector('.grade-title')!.textContent).toContain('重来')
  await language('en')
  expect(host.querySelector('.grade-title')!.textContent).toContain('Again')
  expect(host.querySelector('.b-review-deck')!.textContent).toContain('我的卡组')
  expect(host.querySelector('.grade-button strong')!.textContent).toBe('1 minute')
})

it('translates an already visible backup error and legacy snapshot labels without changing data', async () => {
  await start()
  button('Add starter deck').click()
  await vi.waitFor(
    () => {
      const deck = host.querySelector('.deck-title')
      expect(deck).not.toBeNull()
      expect(deck!.textContent).toContain('Start here: FSRS & Repeaty')
    },
    { timeout: 5000 },
  )
  button('Data & backups').click()
  await nextTick()
  const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(fileInput, 'files', {
    value: [new File(['{'], 'invalid.json', { type: 'application/json' })],
  })
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() =>
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('not valid JSON'),
  )
  await language('zh-CN')
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('不是有效的 JSON')
  await vi.waitFor(() => expect(button('立即创建快照').disabled).toBe(false))
  button('立即创建快照').click()
  await vi.waitFor(() =>
    expect(host.querySelector('.snapshot-list')!.textContent).toContain('手动快照'),
  )
  await language('en')
  expect(host.querySelector('.snapshot-list')!.textContent).toContain('Manual snapshot')
  expect(host.querySelector('.backup-meta')!.textContent).toContain('Cards: 27')
  const repository = createRepository()
  expect((await repository.load()).library.decks[0]!.name).toContain('Start here: FSRS & Repeaty')
  await repository.close()
})

it('keeps persisted filter values and typed search terms unchanged across UI languages', async () => {
  await start()
  button('Add starter deck').click()
  await vi.waitFor(() => expect(host.querySelector('.deck-title')).not.toBeNull())
  const cardsNav = [...host.querySelectorAll<HTMLButtonElement>('.main-nav button')].find(
    (button) => button.textContent?.trim().startsWith('All cards'),
  )!
  cardsNav.click()
  await vi.dynamicImportSettled()
  await vi.waitFor(() =>
    expect(host.querySelector('[role="combobox"][aria-label="Filter by status"]')).not.toBeNull(),
  )
  const state = host.querySelector<HTMLElement>('[role="combobox"][aria-label="Filter by status"]')!
  await chooseOption(state, 'New')
  await input('.search-field input', 'type:basic')
  expect(state.textContent!.trim()).toBe('New')
  await language('zh-CN')
  expect(state.textContent!.trim()).toBe('新卡片')
  expect(host.querySelector<HTMLInputElement>('.search-field input')!.value).toBe('type:basic')
  await vi.waitFor(() => expect(host.querySelectorAll('tbody tr')).toHaveLength(20))
})
