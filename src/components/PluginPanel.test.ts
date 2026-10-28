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
  officialPluginBundles: vi.fn(async () => []),
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

it('renders README lazily and opens and focuses the requested plugin documentation', async () => {
  const props = reactive({ focusPlugin: undefined as string | undefined })
  app = createApp({ render: () => h(PluginPanel, props) })
  app.mount(host)
  await settle()
  expect(host.querySelector('.readme-rendered')).toBeNull()
  props.focusPlugin = 'example'
  await settle()
  const trigger = host.querySelector<HTMLButtonElement>('.plugin-readme-trigger')!
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(trigger)
  expect(host.querySelector('.readme-rendered')?.textContent).toContain('Example documentation')
  trigger.click()
  await settle()
  expect(host.querySelector('.readme-rendered')).toBeNull()
})
