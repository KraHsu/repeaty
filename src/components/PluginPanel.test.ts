// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, shallowReactive, type App } from 'vue'
import PluginPanel from './PluginPanel.vue'
import type { OfficialPluginEntry, PackageEntry, PluginManager } from '../plugins/manager'
import type { PluginBundle } from '../plugins/package'
import { setLocale } from '../i18n'

const boundary = vi.hoisted(() => ({
  manager: {} as PluginManager,
  read: vi.fn(),
  catalog: vi.fn(),
  loadOfficial: vi.fn(),
  enabled: new Set<string>(),
  available: { value: true },
}))
vi.mock('@repeaty-platform', () => ({ workspaceAvailable: boundary.available }))
vi.mock('../plugins', () => ({
  usePlugins: () => ({
    installedPlugins: [],
    pluginEnabled: (id: string) => boundary.enabled.has(id),
    pluginPreferenceError: ref(''),
  }),
}))
vi.mock('../plugins/manager', () => ({
  usePluginManager: () => boundary.manager,
  officialPluginCatalog: boundary.catalog,
  loadOfficialPlugin: boundary.loadOfficial,
}))
vi.mock('../plugins/package', () => ({
  readPluginFile: boundary.read,
  pluginIssueMessage: (issue: unknown) => String(issue),
}))
vi.mock('./CardContent.vue', () => ({
  default: {
    props: ['text'],
    setup: (props: { text: string }) => () => h('div', { class: 'readme-rendered' }, props.text),
  },
}))

const bundle: PluginBundle = {
  manifest: {
    id: 'example',
    name: 'Example',
    author: 'test-author',
    version: '1.0.0',
    apiVersion: 1,
    dataVersion: 1,
    kind: 'frontend',
    permissions: { origins: ['https://example.invalid'], secrets: true },
  },
  main: 'export default {}',
  readme: '# Example documentation',
}
let app: App | undefined, host: HTMLDivElement
beforeEach(() => {
  setLocale('zh-CN')
  boundary.read.mockReset().mockResolvedValue(bundle)
  boundary.catalog.mockReset().mockResolvedValue([])
  boundary.loadOfficial.mockReset().mockResolvedValue(bundle)
  boundary.enabled.clear()
  boundary.available.value = true
  boundary.manager = {
    pluginPackages: shallowReactive<PackageEntry[]>([{ id: 'example', trusted: false, bundle }]),
    pluginScope: ref('first'),
    pluginManagerBusy: ref(false),
    pluginManagerError: ref(''),
    activePluginViews: ref(0),
    installPlugin: vi.fn(async () => {}),
    enablePlugin: vi.fn(async () => {}),
    removePlugin: vi.fn(async () => {}),
    reloadPlugins: vi.fn(async () => {}),
  } as unknown as PluginManager
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(async () => {
  app?.unmount()
  app = undefined
  await settle()
  host.remove()
})
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
async function mount(props = {}) {
  app = createApp(PluginPanel, props)
  app.mount(host)
  await settle()
}
async function choose() {
  const picker = host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: [new File(['package'], 'example.repeaty-plugin')],
  })
  picker.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}
const dialog = () => document.querySelector<HTMLElement>('[data-app-modal-content]')
const accept = () => dialog()!.querySelector<HTMLButtonElement>('[data-plugin-confirm]')!

it('confirms package installation and permissions without enabling its code and cancels cleanly', async () => {
  await mount()
  await choose()
  expect(dialog()?.textContent).toContain('确认安装 Example')
  expect(dialog()?.textContent).toContain('新插件默认关闭，更新保留原启停状态')
  expect(dialog()?.textContent).toContain('https://example.invalid')
  expect(dialog()?.textContent).toContain('设备凭据')
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
  dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click()
  await settle()
  expect(dialog()).toBeNull()
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
  await choose()
  accept().click()
  await settle()
  expect(boundary.manager.installPlugin).toHaveBeenCalledExactlyOnceWith(bundle)
  expect(boundary.manager.enablePlugin).not.toHaveBeenCalled()
})

it('settles stale confirmations false across workspace changes and ignores a late file read after unmount', async () => {
  await mount()
  await choose()
  const stale = accept()
  boundary.manager.pluginScope.value = 'second'
  await settle()
  stale.click()
  expect(dialog()).toBeNull()
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
  let finish!: (bundle: PluginBundle) => void
  boundary.read.mockImplementationOnce(
    () =>
      new Promise<PluginBundle>((resolve) => {
        finish = resolve
      }),
  )
  await choose()
  app!.unmount()
  app = undefined
  finish(bundle)
  await settle()
  expect(dialog()).toBeNull()
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
})

it('does not install after its accepted confirmation owner is disposed before continuation', async () => {
  await mount()
  await choose()
  accept().click()
  app!.unmount()
  app = undefined
  await settle()
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
})

it('ties enable and uninstall confirmation to the exact package entry and request', async () => {
  await mount()
  host.querySelector<HTMLButtonElement>('[role=switch]')!.click()
  await settle()
  expect(dialog()?.textContent).toContain('插件将在应用中执行代码')
  expect(dialog()?.textContent).toContain('https://example.invalid')
  const stale = accept()
  boundary.manager.pluginPackages.splice(0, 1, {
    id: 'example',
    trusted: false,
    bundle: { ...bundle, main: 'new code' },
  })
  await settle()
  expect(dialog()).toBeNull()
  host.querySelector<HTMLButtonElement>('[role=switch]')!.click()
  await settle()
  stale.click()
  expect(dialog()).not.toBeNull()
  expect(boundary.manager.enablePlugin).not.toHaveBeenCalled()
  accept().click()
  await settle()
  expect(boundary.manager.enablePlugin).toHaveBeenCalledExactlyOnceWith('example', true)
  ;[...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === '卸载插件')!
    .click()
  await settle()
  expect(dialog()?.textContent).toContain('题目、历史、设置和插件数据会保留')
  boundary.manager.pluginPackages.splice(0)
  await settle()
  expect(dialog()).toBeNull()
  expect(boundary.manager.removePlugin).not.toHaveBeenCalled()
})

it.each([false, true])(
  'explains shared storage at page level rather than repeating it in plugin details (embedded: %s)',
  async (embedded) => {
    await mount({ embedded })
    const description = host.querySelector(
      embedded ? '.plugin-storage-description' : '.app-page-header__description',
    )
    expect(description?.textContent).toContain('前端插件保存在此浏览器的独立副本中')
    expect(host.querySelector('.plugin-settings')?.textContent).not.toContain('插件安装与存储')
    expect(host.querySelector('.plugin-settings')?.textContent).not.toContain(
      description?.textContent,
    )
  },
)

it.each([
  ['test-author', '@test-author'],
  ['@community', '@community'],
  [undefined, '未声明作者'],
])(
  'shows declared third-party authors and keeps legacy packages readable (%s)',
  async (author, label) => {
    boundary.manager.pluginPackages[0]!.bundle = {
      ...bundle,
      manifest: { ...bundle.manifest, author },
    }
    await mount()
    expect(host.querySelector('.plugin-directory-item .plugin-author')?.textContent).toBe(label)
    expect(host.querySelector('.plugin-detail-title .plugin-author')?.textContent).toBe(label)
    expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
  },
)

it('identifies official catalog entries as @repeaty in the directory and details', async () => {
  offer(bundle)
  await mount()
  expect(officialRow('example').querySelector('.plugin-author')?.textContent).toBe('@repeaty')
  expect(host.querySelector('.plugin-detail-title .plugin-author')?.textContent).toBe('@repeaty')
})

it.each([false, true])(
  'opens and focuses requested plugin documentation (embedded: %s)',
  async (embedded) => {
    boundary.manager.pluginPackages.push({
      id: 'second',
      trusted: true,
      bundle: {
        ...bundle,
        manifest: { ...bundle.manifest, id: 'second', name: 'Second' },
        readme: '# Second documentation',
      },
    })
    const props = reactive({ embedded, focusPlugin: undefined as string | undefined })
    app = createApp({ render: () => h(PluginPanel, props) })
    app.mount(host)
    await settle()
    expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
    expect(host.querySelectorAll('.plugin-settings')).toHaveLength(1)
    host.querySelector<HTMLButtonElement>('[data-plugin-select="second"]')!.click()
    await settle()
    expect(host.querySelector('.readme-rendered')?.textContent).toContain('Second documentation')
    expect(host.querySelector('.plugin-settings')?.getAttribute('data-plugin-id')).toBe('second')
    props.focusPlugin = 'example'
    await settle()
    const trigger = host.querySelector<HTMLButtonElement>('.plugin-readme-trigger')!
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(trigger)
    expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
    trigger.click()
    await settle()
    expect(host.querySelector('.readme-rendered')).toBeNull()
  },
)

it('selects a current package after removal and resets selection when the workspace changes', async () => {
  boundary.manager.pluginPackages.push({ id: 'second', trusted: true, bundle })
  await mount()
  host.querySelector<HTMLButtonElement>('[data-plugin-select="second"]')!.click()
  await settle()
  expect(host.querySelector('.plugin-settings')?.getAttribute('data-plugin-id')).toBe('second')
  boundary.manager.pluginScope.value = 'second-workspace'
  await settle()
  expect(host.querySelector('.plugin-settings')?.getAttribute('data-plugin-id')).toBe('example')
  boundary.manager.pluginPackages.splice(0, 1)
  await settle()
  expect(host.querySelector('.plugin-settings')?.getAttribute('data-plugin-id')).toBe('second')
  boundary.manager.pluginPackages.splice(0)
  await settle()
  expect(host.querySelector('.plugin-settings')).toBeNull()
  await filterPlugins('已安装')
  expect(host.textContent).toContain('当前学习库尚未安装插件')
})

function catalogEntry(value: PluginBundle): OfficialPluginEntry {
  return { ...value.manifest, path: `plugins/${value.manifest.id}.repeaty-plugin` }
}
function offer(...bundles: PluginBundle[]) {
  boundary.catalog.mockResolvedValue(bundles.map(catalogEntry))
  boundary.loadOfficial.mockImplementation(async (entry: OfficialPluginEntry) => {
    const selected = bundles.find(
      ({ manifest }) => manifest.id === entry.id && manifest.version === entry.version,
    )
    if (!selected) throw new Error(`Unexpected package: ${entry.id}@${entry.version}`)
    return selected
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function button(label: string, container: ParentNode = host) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (value) => value.textContent?.trim() === label,
  )!
}
function officialRow(id: string) {
  return host.querySelector<HTMLElement>(`[data-official-plugin="${id}"]`)!
}
function officialButton(id: string) {
  return officialRow(id)?.querySelector<HTMLButtonElement>('.plugin-install-button') ?? null
}
function visibleIds() {
  return [...host.querySelectorAll<HTMLElement>('[data-plugin-select]')].map(
    (entry) => entry.dataset.pluginSelect,
  )
}
async function select(id: string) {
  host.querySelector<HTMLButtonElement>(`[data-plugin-select="${id}"]`)!.click()
  await settle()
}
function searchInput() {
  return host.querySelector<HTMLInputElement>('input[aria-label="搜索插件"]')!
}
async function search(value: string) {
  searchInput().value = value
  searchInput().dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
async function filterPlugins(label: string) {
  const tab = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(
    (value) => value.textContent?.trim() === label,
  )!
  tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  tab.click()
  await settle()
  expect(tab.getAttribute('aria-selected')).toBe('true')
}
function expectNoMutations() {
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
  expect(boundary.manager.enablePlugin).not.toHaveBeenCalled()
  expect(boundary.manager.removePlugin).not.toHaveBeenCalled()
}

it('installs only the selected official package and selects its details without changing other plugins', async () => {
  const official = { ...bundle, manifest: { ...bundle.manifest, id: 'official', name: 'Official' } }
  offer(bundle, official)
  vi.mocked(boundary.manager.installPlugin).mockImplementation(async (selected) => {
    boundary.manager.pluginPackages.push({
      id: selected.manifest.id,
      trusted: true,
      bundle: selected,
    })
  })
  await mount()
  expect(boundary.catalog).toHaveBeenCalledOnce()
  expect(boundary.loadOfficial).not.toHaveBeenCalled()
  expect(officialButton('example')).toBeNull()
  expect(officialRow('example').querySelector('.plugin-version-state')?.textContent).toBe('已安装')
  await search('Official')
  officialButton('official')!.click()
  await settle()
  expect(boundary.loadOfficial).toHaveBeenCalledExactlyOnceWith(catalogEntry(official))
  expect(boundary.manager.installPlugin).toHaveBeenCalledExactlyOnceWith(official)
  expect(boundary.manager.enablePlugin).not.toHaveBeenCalled()
  expect(dialog()).toBeNull()
  expect(searchInput().value).toBe('')
  expect(visibleIds()).toEqual(['example', 'official'])
  expect(host.querySelector('.plugin-settings')?.getAttribute('data-plugin-id')).toBe('official')
  expect(host.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('false')
  expect(boundary.manager.pluginPackages[0]!.bundle).toBe(bundle)
})

it.each([
  ['1.0.0', '1.0.0', '已安装', true],
  ['1.10.0', '1.2.0', '已安装较新版本', true],
  ['2.0.0', '2.0.0-beta.1', '已安装较新版本', true],
  ['1.0.0-beta.10', '1.0.0-beta.2', '已安装较新版本', true],
  ['1.0.0-beta.1', '1.0.0', '更新', false],
  ['1.0.0-beta.1', '1.0.0-beta.2', '更新', false],
  ['1.0.0', '1.0.1', '更新', false],
])(
  'prevents unintentional downgrade from %s to %s',
  async (installed, available, label, disabled) => {
    boundary.manager.pluginPackages[0]!.bundle = {
      ...bundle,
      manifest: { ...bundle.manifest, version: installed },
    }
    offer({ ...bundle, manifest: { ...bundle.manifest, version: available } })
    await mount()
    if (disabled) {
      expect(officialButton('example')).toBeNull()
      expect(officialRow('example').querySelector('.plugin-version-state')?.textContent).toBe(label)
      expect(boundary.loadOfficial).not.toHaveBeenCalled()
      expectNoMutations()
    } else {
      expect(officialButton('example')?.textContent).toBe(label)
      expect(officialButton('example')?.disabled).toBe(false)
    }
  },
)

it.each([false, true])(
  'updates an installed package without toggling its enabled state (%s)',
  async (enabled) => {
    const updated = { ...bundle, manifest: { ...bundle.manifest, version: '1.1.0' } }
    offer(updated)
    if (enabled) boundary.enabled.add('example')
    boundary.manager.pluginPackages[0]!.trusted = true
    vi.mocked(boundary.manager.installPlugin).mockImplementation(async (installed) => {
      boundary.manager.pluginPackages.splice(0, 1, {
        id: 'example',
        trusted: true,
        bundle: installed,
      })
    })
    await mount()
    expect(officialButton('example')?.textContent).toBe('更新')
    officialButton('example')!.click()
    await settle()
    expect(boundary.manager.installPlugin).toHaveBeenCalledExactlyOnceWith(updated)
    expect(boundary.manager.enablePlugin).not.toHaveBeenCalled()
    expect(host.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe(String(enabled))
    expect(officialRow('example').querySelector('.plugin-version-state')?.textContent).toBe(
      '已安装',
    )
  },
)

it('ignores catalog results after scope change and unmount', async () => {
  const first = deferred<OfficialPluginEntry[]>()
  const second = deferred<OfficialPluginEntry[]>()
  boundary.catalog.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  await mount()
  boundary.manager.pluginScope.value = 'second'
  await settle()
  expect(boundary.catalog).toHaveBeenCalledTimes(2)
  first.resolve([catalogEntry(bundle)])
  await settle()
  expect(host.querySelector('[data-official-plugin]')).toBeNull()
  app!.unmount()
  app = undefined
  second.resolve([catalogEntry(bundle)])
  await settle()
  expect(host.querySelector('[data-official-plugin]')).toBeNull()
  expect(dialog()).toBeNull()
  expectNoMutations()
})

it('discards installation and preview cache from an old entry when a pending catalog refresh replaces it', async () => {
  boundary.manager.pluginPackages.splice(0)
  offer(bundle)
  await mount()
  const catalog = deferred<OfficialPluginEntry[]>()
  const oldPackage = deferred<PluginBundle>()
  const updated = {
    ...bundle,
    manifest: { ...bundle.manifest, version: '2.0.0' },
    readme: '# Current catalog documentation',
  }
  boundary.catalog.mockReturnValueOnce(catalog.promise)
  boundary.loadOfficial.mockReturnValueOnce(oldPackage.promise).mockResolvedValueOnce(updated)
  button('重新扫描插件').click()
  await settle()
  expect(boundary.manager.reloadPlugins).toHaveBeenCalledOnce()
  expect(boundary.catalog).toHaveBeenCalledTimes(2)
  expect(officialButton('example')?.disabled).toBe(false)
  officialButton('example')!.click()
  await settle()
  expect(boundary.loadOfficial).toHaveBeenCalledExactlyOnceWith(catalogEntry(bundle))
  catalog.resolve([catalogEntry(updated)])
  await settle()
  oldPackage.resolve({ ...bundle, readme: '# Stale catalog documentation' })
  await settle()
  expectNoMutations()
  expect(host.textContent).not.toContain('Stale catalog documentation')
  await select('example')
  expect(boundary.loadOfficial).toHaveBeenCalledTimes(2)
  expect(boundary.loadOfficial).toHaveBeenLastCalledWith(catalogEntry(updated))
  expect(host.querySelector('.readme-rendered')?.textContent).toContain(
    'Current catalog documentation',
  )
  expect(host.textContent).not.toContain('Stale catalog documentation')
})

it('keeps the selected details and search after an install error and permits retry of the same package', async () => {
  boundary.manager.pluginPackages.splice(0)
  offer(bundle)
  vi.mocked(boundary.manager.installPlugin)
    .mockRejectedValueOnce(new Error('disk failed'))
    .mockImplementationOnce(async (installed) => {
      boundary.manager.pluginPackages.push({
        id: installed.manifest.id,
        trusted: true,
        bundle: installed,
      })
    })
  await mount()
  await search('Example')
  await select('example')
  officialButton('example')!.click()
  await settle()
  expect(host.textContent).toContain('disk failed')
  expect(searchInput().value).toBe('Example')
  expect(host.querySelector('.plugin-settings')?.getAttribute('data-plugin-id')).toBe('example')
  expect(officialButton('example')?.disabled).toBe(false)
  officialButton('example')!.click()
  await settle()
  expect(boundary.loadOfficial).toHaveBeenCalledOnce()
  expect(boundary.manager.installPlugin).toHaveBeenCalledTimes(2)
  expect(searchInput().value).toBe('')
  expect(host.textContent).not.toContain('disk failed')
  expect(dialog()).toBeNull()
})

it('shows catalog failures with a retry without losing installed plugin details', async () => {
  boundary.catalog
    .mockRejectedValueOnce(new Error('network failed'))
    .mockResolvedValueOnce([catalogEntry(bundle)])
  await mount()
  expect(host.textContent).toContain('network failed')
  expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
  button('重试', host.querySelector('.plugin-directory')!).click()
  await settle()
  expect(boundary.catalog).toHaveBeenCalledTimes(2)
  expect(host.textContent).not.toContain('network failed')
  expect(officialRow('example')).not.toBeNull()
  expect(boundary.loadOfficial).not.toHaveBeenCalled()
  expectNoMutations()
})

it('loads README packages only when selected and reuses them for browsing and installation', async () => {
  boundary.manager.pluginPackages.splice(0)
  const second = {
    ...bundle,
    manifest: { ...bundle.manifest, id: 'second', name: 'Second' },
    readme: '# Second documentation',
  }
  offer(bundle, second)
  await mount()
  expect(visibleIds()).toEqual(['example', 'second'])
  expect(host.querySelector('.plugin-settings')).toBeNull()
  expect(boundary.loadOfficial).not.toHaveBeenCalled()
  await search('second')
  expect(visibleIds()).toEqual(['second'])
  expect(boundary.loadOfficial).not.toHaveBeenCalled()
  await select('second')
  expect(boundary.loadOfficial).toHaveBeenCalledExactlyOnceWith(catalogEntry(second))
  expect(host.querySelector('.readme-rendered')?.textContent).toContain('Second documentation')
  expectNoMutations()
  await search('')
  await select('example')
  await select('second')
  expect(boundary.loadOfficial).toHaveBeenCalledTimes(2)
  officialButton('second')!.click()
  await settle()
  expect(boundary.loadOfficial).toHaveBeenCalledTimes(2)
  expect(boundary.manager.installPlugin).toHaveBeenCalledExactlyOnceWith(second)
})

it('searches names, ids and descriptions and filters installed and available updates without mutations', async () => {
  const updated = { ...bundle, manifest: { ...bundle.manifest, version: '1.1.0' } }
  const heatmap = {
    ...bundle,
    manifest: {
      ...bundle.manifest,
      id: 'heatmap',
      name: '复习热力图',
      description: 'Track study activity',
    },
  }
  offer(updated, heatmap)
  boundary.manager.pluginPackages.push({
    id: 'local-only',
    trusted: true,
    bundle: {
      ...bundle,
      manifest: { ...bundle.manifest, id: 'local-only', name: 'Local only' },
    },
  })
  await mount()
  expect(visibleIds()).toEqual(['example', 'local-only', 'heatmap'])
  await filterPlugins('已安装')
  expect(visibleIds()).toEqual(['example', 'local-only'])
  await filterPlugins('可更新')
  expect(visibleIds()).toEqual(['example'])
  await filterPlugins('全部插件')
  for (const term of ['热力', 'HEATMAP', 'STUDY ACTIVITY']) {
    await search(term)
    expect(visibleIds()).toEqual(['heatmap'])
  }
  await search('missing')
  expect(visibleIds()).toEqual([])
  expect(host.textContent).toContain('没有找到匹配的插件')
  await search('')
  expect(visibleIds()).toEqual(['example', 'local-only', 'heatmap'])
  expect(boundary.loadOfficial).not.toHaveBeenCalled()
  expectNoMutations()
})

it('reveals a focused installed plugin through search and update filters', async () => {
  const props = reactive({ focusPlugin: undefined as string | undefined })
  offer(bundle)
  app = createApp({ render: () => h(PluginPanel, props) })
  app.mount(host)
  await settle()
  await filterPlugins('可更新')
  await search('missing')
  expect(visibleIds()).toEqual([])
  props.focusPlugin = 'example'
  await settle()
  expect(searchInput().value).toBe('')
  expect(visibleIds()).toEqual(['example'])
  expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('全部插件')
  expect(document.activeElement).toBe(host.querySelector('.plugin-readme-trigger'))
  expectNoMutations()
})

it('shows a README fetch failure in its details and permits retry without installation', async () => {
  boundary.manager.pluginPackages.splice(0)
  offer(bundle)
  boundary.loadOfficial.mockRejectedValueOnce(new Error('README download failed'))
  await mount()
  await select('example')
  expect(host.querySelector('.plugin-settings')?.textContent).toContain('README download failed')
  button('重试', host.querySelector('.plugin-settings')!).click()
  await settle()
  expect(boundary.loadOfficial).toHaveBeenCalledTimes(2)
  expect(host.textContent).not.toContain('README download failed')
  expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
  expectNoMutations()
})

it('ignores a stale detail failure after selecting a different plugin', async () => {
  boundary.manager.pluginPackages.splice(0)
  const second = {
    ...bundle,
    manifest: { ...bundle.manifest, id: 'second', name: 'Second' },
    readme: '# Second documentation',
  }
  offer(bundle, second)
  const first = deferred<PluginBundle>()
  boundary.loadOfficial.mockReturnValueOnce(first.promise)
  await mount()
  await select('example')
  await select('second')
  first.reject(new Error('stale failure'))
  await settle()
  expect(host.querySelector('.readme-rendered')?.textContent).toContain('Second documentation')
  expect(host.textContent).not.toContain('stale failure')
  expectNoMutations()
})

it.each(['preview', 'install'] as const)(
  'discards a late %s package after switching workspaces',
  async (action) => {
    boundary.manager.pluginPackages.splice(0)
    offer(bundle)
    const stale = deferred<PluginBundle>()
    boundary.loadOfficial.mockReturnValueOnce(stale.promise)
    await mount()
    if (action === 'preview') await select('example')
    else {
      officialButton('example')!.click()
      await settle()
    }
    boundary.manager.pluginScope.value = 'second'
    await settle()
    stale.resolve({ ...bundle, readme: '# Stale workspace documentation' })
    await settle()
    expect(host.textContent).not.toContain('Stale workspace documentation')
    expectNoMutations()
    await select('example')
    expect(boundary.loadOfficial).toHaveBeenCalledTimes(2)
    expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
  },
)

it.each(['preview', 'install'] as const)(
  'discards a late %s package after unmount',
  async (action) => {
    boundary.manager.pluginPackages.splice(0)
    offer(bundle)
    const stale = deferred<PluginBundle>()
    boundary.loadOfficial.mockReturnValueOnce(stale.promise)
    await mount()
    if (action === 'preview') await select('example')
    else {
      officialButton('example')!.click()
      await settle()
    }
    app!.unmount()
    app = undefined
    stale.resolve(bundle)
    await settle()
    expect(host.children).toHaveLength(0)
    expectNoMutations()
  },
)

it.each(['workspace', 'active-view'] as const)(
  'does not install a downloaded package after mutation becomes locked by %s',
  async (reason) => {
    boundary.manager.pluginPackages.splice(0)
    offer(bundle)
    const pending = deferred<PluginBundle>()
    boundary.loadOfficial.mockReturnValueOnce(pending.promise)
    await mount()
    officialButton('example')!.click()
    await settle()
    if (reason === 'workspace') boundary.available.value = false
    else boundary.manager.activePluginViews.value = 1
    pending.resolve(bundle)
    await settle()
    expectNoMutations()
  },
)

it('checks the current installed version again after downloading an update', async () => {
  const updated = { ...bundle, manifest: { ...bundle.manifest, version: '1.1.0' } }
  offer(updated)
  const pending = deferred<PluginBundle>()
  boundary.loadOfficial.mockReturnValueOnce(pending.promise)
  await mount()
  officialButton('example')!.click()
  await settle()
  boundary.manager.pluginPackages.splice(0, 1, {
    id: 'example',
    trusted: true,
    bundle: { ...bundle, manifest: { ...bundle.manifest, version: '2.0.0' } },
  })
  pending.resolve(updated)
  await settle()
  expect(officialButton('example')).toBeNull()
  expect(officialRow('example').querySelector('.plugin-version-state')?.textContent).toBe(
    '已安装较新版本',
  )
  expectNoMutations()
})

it.each(['workspace', 'busy', 'active-view'] as const)(
  'allows browsing but blocks installation while locked by %s',
  async (reason) => {
    boundary.manager.pluginPackages.splice(0)
    offer(bundle)
    if (reason === 'workspace') boundary.available.value = false
    if (reason === 'busy') boundary.manager.pluginManagerBusy.value = true
    if (reason === 'active-view') boundary.manager.activePluginViews.value = 1
    await mount()
    await search('Example')
    await select('example')
    expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
    expect(searchInput().disabled).toBe(false)
    expect(officialButton('example')?.disabled).toBe(true)
    officialButton('example')!.click()
    button('安装插件包').click()
    await settle()
    expect(dialog()).toBeNull()
    expectNoMutations()
  },
)
