// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, shallowReactive, type App } from 'vue'
import PluginPanel from './PluginPanel.vue'
import type { PackageEntry, PluginManager } from '../plugins/manager'
import type { PluginBundle } from '../plugins/package'
import { setLocale } from '../i18n'

const boundary = vi.hoisted(() => ({
  manager: {} as PluginManager,
  read: vi.fn(),
  official: vi.fn(),
  available: { value: true },
}))
vi.mock('@repeaty-platform', () => ({ workspaceAvailable: boundary.available }))
vi.mock('../plugins', () => ({
  usePlugins: () => ({
    installedPlugins: [],
    pluginEnabled: () => false,
    pluginPreferenceError: ref(''),
  }),
}))
vi.mock('../plugins/manager', () => ({
  usePluginManager: () => boundary.manager,
  officialPluginBundles: boundary.official,
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
  boundary.official.mockReset().mockResolvedValue([])
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

it('uses explicit code and permission confirmation for installation and cancels cleanly', async () => {
  await mount()
  await choose()
  expect(dialog()?.textContent).toContain('插件将在应用中执行代码')
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
  expect(host.textContent).toContain('当前学习库尚未安装插件')
})

async function browseOfficial() {
  ;[...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === '安装或更新官方插件')!
    .click()
  await settle()
}
function officialButton(id: string) {
  return document.querySelector<HTMLButtonElement>(`[data-official-plugin="${id}"] button`)!
}

it('installs only the selected official package and selects its details without changing other plugins', async () => {
  const official = { ...bundle, manifest: { ...bundle.manifest, id: 'official', name: 'Official' } }
  boundary.official.mockResolvedValue([bundle, official])
  vi.mocked(boundary.manager.installPlugin).mockImplementation(async (selected) => {
    boundary.manager.pluginPackages.push({
      id: selected.manifest.id,
      trusted: true,
      bundle: selected,
    })
  })
  await mount()
  await browseOfficial()
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
  expect(officialButton('example').disabled).toBe(true)
  expect(officialButton('example').textContent).toBe('已安装')
  officialButton('official').click()
  await settle()
  expect(boundary.manager.installPlugin).toHaveBeenCalledExactlyOnceWith(official)
  expect(dialog()).toBeNull()
  expect(host.querySelector('.plugin-settings')?.getAttribute('data-plugin-id')).toBe('official')
  expect(boundary.manager.pluginPackages[0]!.bundle).toBe(bundle)
})

it.each([
  ['1.0.0', '1.0.0', '已安装', true],
  ['1.10.0', '1.2.0', '已安装较新版本', true],
  ['2.0.0', '2.0.0-beta.1', '已安装较新版本', true],
  ['1.0.0-beta.10', '1.0.0-beta.2', '已安装较新版本', true],
  ['1.0.0-beta.1', '1.0.0', '更新并启用', false],
  ['1.0.0-beta.1', '1.0.0-beta.2', '更新并启用', false],
  ['1.0.0', '1.0.1', '更新并启用', false],
])(
  'prevents unintentional downgrade from %s to %s',
  async (installed, available, label, disabled) => {
    boundary.manager.pluginPackages[0]!.bundle = {
      ...bundle,
      manifest: { ...bundle.manifest, version: installed },
    }
    boundary.official.mockResolvedValue([
      { ...bundle, manifest: { ...bundle.manifest, version: available } },
    ])
    await mount()
    await browseOfficial()
    expect(officialButton('example').textContent).toBe(label)
    expect(officialButton('example').disabled).toBe(disabled)
    if (disabled) {
      officialButton('example').click()
      await settle()
      expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
    }
  },
)

it('ignores catalog results after close, scope change, and unmount', async () => {
  let finish!: (bundles: PluginBundle[]) => void
  boundary.official.mockImplementation(
    () =>
      new Promise<PluginBundle[]>((resolve) => {
        finish = resolve
      }),
  )
  await mount()
  await browseOfficial()
  dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click()
  await settle()
  finish([bundle])
  await settle()
  expect(dialog()).toBeNull()
  await browseOfficial()
  const stale = finish
  boundary.manager.pluginScope.value = 'second'
  await settle()
  await browseOfficial()
  stale([bundle])
  await settle()
  expect(document.querySelector('[data-official-plugin]')).toBeNull()
  app!.unmount()
  app = undefined
  finish([bundle])
  await settle()
  expect(dialog()).toBeNull()
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
})

it('keeps official install errors inside the chooser and permits retry of the same package', async () => {
  boundary.manager.pluginPackages.splice(0)
  boundary.official.mockResolvedValue([bundle])
  vi.mocked(boundary.manager.installPlugin)
    .mockRejectedValueOnce(new Error('disk failed'))
    .mockResolvedValueOnce(undefined)
  await mount()
  await browseOfficial()
  officialButton('example').click()
  await settle()
  expect(dialog()?.textContent).toContain('disk failed')
  expect(officialButton('example').disabled).toBe(false)
  officialButton('example').click()
  await settle()
  expect(boundary.manager.installPlugin).toHaveBeenCalledTimes(2)
  expect(dialog()).toBeNull()
})

it('shows catalog failures with a retry and disables mutation when the workspace becomes unavailable', async () => {
  boundary.manager.pluginPackages.splice(0)
  boundary.official
    .mockRejectedValueOnce(new Error('network failed'))
    .mockResolvedValueOnce([bundle])
  await mount()
  await browseOfficial()
  expect(dialog()?.textContent).toContain('network failed')
  ;[...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === '重试')!
    .click()
  await settle()
  expect(officialButton('example').disabled).toBe(false)
  boundary.available.value = false
  await nextTick()
  officialButton('example').click()
  await settle()
  expect(boundary.manager.installPlugin).not.toHaveBeenCalled()
})
