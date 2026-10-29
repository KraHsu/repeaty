// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import type { MaterialSearchPage } from '@repeaty/plugin-api'
import MaterialSearch from './MaterialSearch.vue'
import SearchSynonymSettings from './SearchSynonymSettings.vue'
import SourceLinks from './SourceLinks.vue'
import type { MaterialKnowledge } from '../composables/material-knowledge'
import { useSettingsStore } from '../settings-store'
import { MATERIAL_SYNONYMS_KEY, readSynonyms } from '../material-search-settings'
import { prepareSource } from '../core/sources'

const mocks = vi.hoisted(() => ({
  manager: { pluginRuntime: { installations: [] as unknown[] }, searchMaterialProvider: vi.fn() },
}))
vi.mock('../plugins/manager', () => ({ usePluginManager: () => mocks.manager }))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  mocks.manager.pluginRuntime.installations = []
  vi.clearAllMocks()
  useSettingsStore(localStorage)
  localStorage.clear()
})
function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render })
  app.mount(host)
  return host
}
async function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
const found = {
  sourceId: 'material-one',
  versionId: 'v1',
  title: 'Found by text',
  snippet: 'Body context',
  locator: {
    schemaVersion: 1 as const,
    kind: 'text' as const,
    sourceId: 'material-one',
    versionId: 'v1',
    start: 0,
    end: 4,
    quote: 'Body',
  },
}

it('searches full text from the regular material UI and opens the version-bound result', async () => {
  const search = vi.fn(async () => ({ hits: [found] })),
    open = vi.fn(),
    settings = vi.fn()
  const knowledge = { search, rebuild: vi.fn() } as unknown as MaterialKnowledge
  const host = mount(() =>
    h(MaterialSearch, { scope: 'one', knowledge, onOpen: open, onSettings: settings }),
  )
  await fill(host.querySelector('input')!, 'Body')
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(host.textContent).toContain('Found by text'))
  const result = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Found by text'),
  )!
  result.click()
  expect(open).toHaveBeenCalledWith(found)
  expect(search).toHaveBeenCalledWith(
    'Body',
    [],
    true,
    0,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
  ;[...host.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === '同义词设置')!
    .click()
  expect(settings).toHaveBeenCalledOnce()
})
it('offers plugin providers through the shared select and routes the query to the selected provider', async () => {
  mocks.manager.pluginRuntime.installations = [
    {
      plugin: { id: 'example' },
      searchProviders: [{ id: 'body', title: 'Example document search' }],
    },
  ]
  mocks.manager.searchMaterialProvider.mockResolvedValue({ hits: [found] })
  const search = vi.fn()
  const host = mount(() =>
    h(MaterialSearch, { scope: 'one', knowledge: { search } as unknown as MaterialKnowledge }),
  )
  host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click()
  await vi.waitFor(() =>
    expect(document.querySelector('[data-select-value="example:body"]')).not.toBeNull(),
  )
  document
    .querySelector<HTMLElement>('[data-select-value="example:body"]')!
    .closest('[role="option"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await vi.waitFor(() =>
    expect(host.querySelector('[role="combobox"]')?.textContent).toContain(
      'Example document search',
    ),
  )
  await fill(host.querySelector('input')!, 'Body')
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(mocks.manager.searchMaterialProvider).toHaveBeenCalled())
  expect(mocks.manager.searchMaterialProvider.mock.calls[0]?.slice(0, 3)).toEqual([
    'example',
    'body',
    { text: 'Body', limit: 20, cursor: undefined },
  ])
  expect(search).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(host.textContent).toContain('Found by text'))
})
it('clears old-library search results and rejects a late successful response', async () => {
  let finish!: (value: MaterialSearchPage) => void
  const search = vi.fn<MaterialKnowledge['search']>(
    () =>
      new Promise<MaterialSearchPage>((resolve) => {
        finish = resolve
      }),
  )
  const state = reactive({ scope: 'one' })
  const host = mount(() =>
    h(MaterialSearch, {
      scope: state.scope,
      knowledge: { search } as unknown as MaterialKnowledge,
    }),
  )
  await fill(host.querySelector('input')!, 'Body')
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(search).toHaveBeenCalledOnce())
  const signal = search.mock.calls[0]![4]!.signal as AbortSignal
  state.scope = 'other'
  await nextTick()
  expect(signal.aborted).toBe(true)
  finish({ hits: [found] })
  await nextTick()
  await nextTick()
  expect(host.textContent).not.toContain('Found by text')
})
it('keeps external plugin search providers available without the built-in index', async () => {
  mocks.manager.pluginRuntime.installations = [
    { plugin: { id: 'search-plugin' }, searchProviders: [{ id: 'provider', title: 'External' }] },
  ]
  mocks.manager.searchMaterialProvider.mockResolvedValue({ hits: [found] })
  const host = mount(() => h(MaterialSearch, { scope: 'one' }))
  await fill(host.querySelector('input')!, 'Body')
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() =>
    expect(mocks.manager.searchMaterialProvider).toHaveBeenCalledWith(
      'search-plugin',
      'provider',
      expect.objectContaining({ text: 'Body' }),
      expect.anything(),
    ),
  )
  await vi.waitFor(() => expect(host.textContent).toContain('Found by text'))
})
it('persists validated synonym rules and leaves existing rules intact after invalid input or a failed write', async () => {
  const values = new Map<string, string>(),
    write = vi.fn((key: string, value: string) => {
      values.set(key, value)
    })
  useSettingsStore({ getItem: (key) => values.get(key) ?? null, setItem: write })
  const host = mount(() => h(SearchSynonymSettings))
  await fill(host.querySelector('textarea')!, '记忆, memory')
  ;[...host.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === '保存规则')!
    .click()
  await vi.waitFor(() => expect(host.textContent).toContain('同义词规则已保存'))
  expect(readSynonyms().groups).toEqual([['记忆', 'memory']])
  await fill(host.querySelector('textarea')!, 'memory, MEMORY')
  ;[...host.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === '保存规则')!
    .click()
  await vi.waitFor(() => expect(host.textContent).toContain('同义词重复'))
  expect(values.get(MATERIAL_SYNONYMS_KEY)).toBe('记忆, memory')
  useSettingsStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: () => Promise.reject(new Error('disk full')),
  })
  await fill(host.querySelector('textarea')!, '间隔, interval')
  ;[...host.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === '保存规则')!
    .click()
  await vi.waitFor(() => expect(host.textContent).toContain('同义词未能保存'))
  expect(host.querySelector('textarea')!.value).toBe('间隔, interval')
})
it('shows explicit choices for ambiguous Wiki links independently of expanded backlinks', async () => {
  const source = prepareSource({
    title: 'Reader',
    url: '',
    format: 'markdown',
    content: '[[Same]]',
  }).source
  const preview = vi.fn(async (id: string) => ({ ...found, sourceId: id, title: 'Same' })),
    open = vi.fn()
  const knowledge = {
    resolve: () => [{ id: 'first' }, { id: 'second' }],
    preview,
    context: vi.fn(async () => ({ outgoing: [], incoming: [] })),
  } as unknown as MaterialKnowledge
  const host = mount(() => h(SourceLinks, { source, knowledge, target: 'Same', onOpen: open }))
  await vi.waitFor(() => expect(host.textContent).toContain('有多个同名材料'))
  const choices = [...host.querySelectorAll('button')].filter((button) =>
    button.textContent?.includes('Same'),
  )
  expect(choices).toHaveLength(2)
  choices[1]!.click()
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'second' }))
  const details = host.querySelector('details')!
  details.open = true
  details.dispatchEvent(new Event('toggle'))
  await vi.waitFor(() => expect(host.textContent).toContain('还没有材料链接到这里。'))
  details.open = false
  details.dispatchEvent(new Event('toggle'))
  await vi.waitFor(() =>
    expect(host.querySelectorAll('.wiki-preview .wiki-result')).toHaveLength(2),
  )
})
