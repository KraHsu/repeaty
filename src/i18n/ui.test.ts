// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import App from '../App.vue'
import { createRepository } from '../core/storage'
import { emptyLibrary } from '../core/model'
import { initI18n, LOCALE_STORAGE_KEY, setLocale, t } from '.'

let app: VueApp | undefined
let host: HTMLDivElement
function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const result = [...scope.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )
  if (!result) throw new Error(`Missing button: ${text}`)
  return result
}
async function input(selector: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function language(value: string) {
  const select = host.querySelector<HTMLSelectElement>('.language-picker select')!
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}
async function start() {
  initI18n()
  app = createApp(App)
  app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('.dashboard')).not.toBeNull())
  // Loading the library reveals the dashboard before snapshot metadata finishes.
  // Native .click() on a disabled button is a no-op; wait for the actual action.
  await vi.waitFor(() => expect(button(t('创建卡组')).disabled).toBe(false), { timeout: 5000 })
}
async function submitForm() {
  host
    .querySelector('dialog form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(host.querySelector('dialog')).toBeNull())
}
beforeEach(async () => {
  if (!document.doctype)
    document.insertBefore(
      document.implementation.createDocumentType('html', '', ''),
      document.documentElement,
    )
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

it('switches the mounted app, document metadata, and persists the explicit choice on reload', async () => {
  await start()
  expect(host.querySelector('h1')!.textContent).toContain('Overview')
  expect(document.documentElement.lang).toBe('en')
  expect(document.querySelector('link[rel="manifest"]')!.getAttribute('href')).toContain(
    'manifest.en.webmanifest',
  )
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
  await language('zh-CN')
  expect(host.querySelector('h1')!.textContent).toContain('学习概览')
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(document.title).toBe('Repeaty · 卡片与间隔复习')
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN')
  app!.unmount()
  await start()
  expect(host.querySelector<HTMLSelectElement>('.language-picker select')!.value).toBe('zh-CN')
  expect(host.querySelector('h1')!.textContent).toContain('学习概览')
})

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
  expect(host.querySelector<HTMLInputElement>('#card-front')!.value).toBe('学习空间')
  expect(host.querySelector('dialog')!.textContent).toContain('保存卡片')
  setLocale('en')
  await submitForm()
  await vi.waitFor(() => expect(host.querySelector('tbody')!.textContent).toContain('学习空间'))
  expect(host.querySelector('.status-chip')!.textContent).toBe('New')
  button('Review').click()
  await vi.waitFor(() =>
    expect(host.querySelector('.card-question')!.textContent!.trim()).toBe('学习空间'),
  )
  button('Show answer').click()
  await vi.waitFor(() =>
    expect(host.querySelector('.card-answer')!.textContent).toContain('中文答案'),
  )
  await language('zh-CN')
  expect(host.querySelector('.card-answer')!.textContent).toContain('中文答案')
  expect(host.querySelector('.grade-title')!.textContent).toContain('重来')
  await language('en')
  expect(host.querySelector('.grade-title')!.textContent).toContain('Again')
  expect(host.querySelector('.review-context')!.textContent).toContain('我的卡组')
  expect(host.querySelector('.grade-button strong')!.textContent).toBe('1 minute')
})

it('translates an already visible backup error and legacy snapshot labels without changing data', async () => {
  await start()
  button('Add starter deck').click()
  await vi.waitFor(
    () => {
      const deck = host.querySelector('.sidebar-deck')
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
  expect(host.querySelector('.sidebar-deck')!.textContent).toContain('Start here: FSRS & Repeaty')
  button('立即创建快照').click()
  await vi.waitFor(() =>
    expect(host.querySelector('.snapshot-list')!.textContent).toContain('手动快照'),
  )
  await language('en')
  expect(host.querySelector('.snapshot-list')!.textContent).toContain('Manual snapshot')
  expect(host.querySelector('.backup-meta')!.textContent).toContain('Cards: 27')
})

it('keeps persisted filter values and typed search terms unchanged across UI languages', async () => {
  await start()
  button('Add starter deck').click()
  await vi.waitFor(() => expect(host.querySelector('.sidebar-deck')).not.toBeNull())
  const cardsNav = [...host.querySelectorAll<HTMLButtonElement>('.main-nav button')].find(
    (button) => button.textContent?.trim().startsWith('All cards'),
  )!
  cardsNav.click()
  await nextTick()
  const state = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]')!
  state.value = '新卡片'
  state.dispatchEvent(new Event('change', { bubbles: true }))
  await input('.search-field input', 'type:basic')
  expect(state.selectedOptions[0]!.textContent!.trim()).toBe('New')
  await language('zh-CN')
  expect(state.value).toBe('新卡片')
  expect(state.selectedOptions[0]!.textContent!.trim()).toBe('新卡片')
  expect(host.querySelector<HTMLInputElement>('.search-field input')!.value).toBe('type:basic')
  await vi.waitFor(() => expect(host.querySelectorAll('tbody tr')).toHaveLength(20))
})
