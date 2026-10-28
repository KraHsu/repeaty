import { test, expect, storedLibrary } from './fixture'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { fixture } from '../../src/core/test-fixtures'
import type { PluginBundle } from '../../src/plugins/package'
import { openPluginManager, openPluginSettings, openSettings } from '../fixtures/settings-flow'

function standaloneBundle(version = '1.0.0', id = 'external-check'): PluginBundle {
  const color = version === '1.0.0' ? 'rgb(17, 34, 51)' : 'rgb(51, 68, 85)'
  return {
    manifest: {
      id,
      name: 'External Check',
      version,
      apiVersion: 1,
      dataVersion: 1,
      kind: 'frontend',
    },
    styles: `.external-check-view { color: ${color} }`,
    // This package is created by the running test, after the host was built.
    main: `
const host = globalThis.__REPEATY_PLUGIN_HOST__;
const { h, ref, onUnmounted } = host.vue;
const api = host.current;
if (!api) throw new Error('missing shared SDK');
const version = ${JSON.stringify(version)};
const id = ${JSON.stringify(id)};
const metrics = globalThis.__externalPluginMetrics ??= {};
const counters = metrics[id] ??= { disposed: 0, cleaned: 0, unmounted: 0, executed: [] };
counters.executed.push(version);
api.onDispose(() => { counters.cleaned++; });
const Settings = {
  setup() {
    const saved = ref(api.readSetting('marker') ?? '');
    onUnmounted(() => { counters.unmounted++; });
    return () => h('div', { class: 'external-check-view' }, [
      h('output', { 'data-testid': 'external-version' }, version),
      h('span', { 'data-testid': 'external-saved' }, saved.value),
      h('button', { type: 'button', onClick() { api.writeSetting('marker', 'saved-' + version); saved.value = 'saved-' + version; } }, 'Save external marker'),
    ]);
  },
};
if (id === 'external-check') api.registerSettings({ id: 'main', title: 'External Check', component: Settings });
export default {
  id, label: 'External Check', kind: 'frontend', version: 1,
  ...(id === 'external-check' ? {} : { settings: Settings }),
  reviewPanel: { props: ['card'], setup(props) { return () => h('aside', { 'data-testid': 'external-review' }, version + ': ' + props.card.front); } },
  dispose() { counters.disposed++; },
};
`,
  }
}
async function workspace(page: Page) {
  return page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__.invoke
    return (await invoke('workspace_status')) as { active: { path: string; token: string } }
  })
}
async function value(page: Page, namespace: string, id: string) {
  return page.evaluate(
    async ({ namespace, id }) => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
          }
        }
      ).__TAURI_INTERNALS__.invoke
      const { active } = (await invoke('workspace_status')) as { active: { token: string } }
      return invoke('workspace_read', {
        token: active.token,
        request: { type: 'value', namespace, id },
      })
    },
    { namespace, id },
  )
}
async function install(page: Page, bundle: PluginBundle) {
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.plugin-actions input[type=file]').setInputFiles({
    name: `${bundle.manifest.id}.repeaty-plugin`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  })
}
const panel = (page: Page) =>
  page.locator('.plugin-settings').filter({
    has: page.getByRole('heading', { name: 'External Check', exact: true }),
  })
const configuration = (page: Page, id = 'external-check') =>
  page.locator(`.plugin-configuration[data-plugin-id="${id}"]`)

test('installs independent code, reloads versions and retains records and private data after uninstall', async ({
  page,
}) => {
  const library = fixture({ front: 'External plugin review check', back: 'An answer' })
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'external-runtime.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const original = await storedLibrary(page)
  await openPluginManager(page)
  await install(page, standaloneBundle())
  await expect(panel(page).getByTestId('external-version')).toHaveCount(0)
  await openPluginSettings(page, 'external-check')
  await expect(configuration(page).getByTestId('external-version')).toHaveText('1.0.0')
  await expect(configuration(page).locator('.external-check-view')).toHaveCSS(
    'color',
    'rgb(17, 34, 51)',
  )
  expect(await storedLibrary(page)).toEqual(original)
  const directory = (await workspace(page)).active.path
  const packageDirectory = join(directory, '.repeaty', 'plugins', 'external-check')
  expect(JSON.parse(await readFile(join(packageDirectory, 'manifest.json'), 'utf8')).version).toBe(
    '1.0.0',
  )
  expect(await readFile(join(packageDirectory, 'main.js'), 'utf8')).toContain('missing shared SDK')

  await configuration(page).getByRole('button', { name: 'Save external marker' }).click()
  await expect
    .poll(() => value(page, 'settings', 'plugin:external-check:marker'))
    .toBe('saved-1.0.0')
  await openPluginManager(page)
  await panel(page).getByRole('switch', { name: '启用 External Check' }).click()
  await openSettings(page)
  await expect(configuration(page)).toHaveCount(0)
  await expect(page.locator('style[data-repeaty-plugin="external-check"]')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as unknown as {
              __externalPluginMetrics: Record<string, { disposed: number; cleaned: number }>
            }
          ).__externalPluginMetrics['external-check'],
      ),
    )
    .toMatchObject({ disposed: 1, cleaned: 1 })
  await openPluginManager(page)
  await panel(page).getByRole('switch', { name: '启用 External Check' }).click()
  await openPluginSettings(page, 'external-check')
  await expect(configuration(page).getByTestId('external-version')).toHaveText('1.0.0')
  await expect(configuration(page).getByTestId('external-saved')).toHaveText('saved-1.0.0')

  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByTestId('external-review')).toContainText(
    '1.0.0: External plugin review check',
  )
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  const studied = await storedLibrary(page)
  expect(studied.reviews).toHaveLength(1)
  await openPluginManager(page)
  await install(page, standaloneBundle('2.0.0'))
  await openPluginSettings(page, 'external-check')
  await expect(configuration(page).getByTestId('external-version')).toHaveText('2.0.0')
  await expect(configuration(page).locator('.external-check-view')).toHaveCSS(
    'color',
    'rgb(51, 68, 85)',
  )
  await expect(page.locator('style[data-repeaty-plugin="external-check"]')).toHaveCount(1)

  const broken = standaloneBundle('3.0.0')
  broken.main = 'throw new Error("external-update-rejected")'
  await openPluginManager(page)
  await install(page, broken)
  await expect(
    page.getByRole('alert').filter({ hasText: 'external-update-rejected' }),
  ).toBeVisible()
  await openPluginSettings(page, 'external-check')
  await expect(configuration(page).getByTestId('external-version')).toHaveText('2.0.0')
  expect(JSON.parse(await readFile(join(packageDirectory, 'manifest.json'), 'utf8')).version).toBe(
    '2.0.0',
  )
  expect(await readFile(join(packageDirectory, 'main.js'), 'utf8')).toBe(
    standaloneBundle('2.0.0').main,
  )
  expect(await storedLibrary(page)).toEqual(studied)
  await configuration(page).getByRole('button', { name: 'Save external marker' }).click()
  await expect
    .poll(() => value(page, 'settings', 'plugin:external-check:marker'))
    .toBe('saved-2.0.0')
  await page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__.invoke
    const { active } = (await invoke('workspace_status')) as { active: { token: string } }
    await invoke('workspace_write', {
      token: active.token,
      request: {
        type: 'value',
        namespace: 'plugin:external-check',
        id: 'saved-data',
        value: { preserve: true },
      },
    })
  })
  await openPluginManager(page)
  page.once('dialog', (dialog) => dialog.accept())
  await panel(page).getByRole('button', { name: '卸载插件', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await openSettings(page)
  await expect(configuration(page)).toHaveCount(0)
  await expect(page.locator('style[data-repeaty-plugin="external-check"]')).toHaveCount(0)
  expect(await storedLibrary(page)).toEqual(studied)
  expect(await value(page, 'settings', 'plugin:external-check:marker')).toBe('saved-2.0.0')
  expect(await value(page, 'plugin:external-check', 'saved-data')).toEqual({ preserve: true })
  await expect(readFile(join(packageDirectory, 'main.js'), 'utf8')).rejects.toMatchObject({
    code: 'ENOENT',
  })
  await page.reload()
  await openPluginManager(page)
  await expect(panel(page)).toHaveCount(0)
  expect(await storedLibrary(page)).toEqual(studied)
})

test('discovers copied package files without executing them until their exact content is trusted', async ({
  page,
}) => {
  const directory = (await workspace(page)).active.path
  const packageDirectory = join(directory, '.repeaty', 'plugins', 'manual-check')
  await mkdir(packageDirectory, { recursive: true })
  const copied = standaloneBundle('1.0.0', 'manual-check')
  copied.readme =
    '# Manual plugin documentation\n\nReadable before trusting code.\n\n<script>globalThis.__untrustedReadmeExecuted = true</script>\n<a href="javascript:globalThis.__untrustedReadmeExecuted=true" onclick="globalThis.__untrustedReadmeExecuted=true">Unsafe link</a>\n<img src="missing.png" onerror="globalThis.__untrustedReadmeExecuted=true">'
  await writeFile(join(packageDirectory, 'manifest.json'), JSON.stringify(copied.manifest))
  await writeFile(join(packageDirectory, 'main.js'), copied.main)
  await writeFile(join(packageDirectory, 'styles.css'), copied.styles!)
  await writeFile(join(packageDirectory, 'README.md'), copied.readme)
  const before = await storedLibrary(page)
  await openPluginManager(page)
  await page.getByRole('button', { name: '重新扫描插件', exact: true }).click()
  await expect(panel(page)).toContainText('此设备尚未信任此插件包')
  await expect(panel(page).getByRole('switch')).not.toBeChecked()
  const documentation = panel(page).locator('.plugin-readme')
  await documentation.locator('summary').click()
  await expect(
    documentation.getByRole('heading', { name: 'Manual plugin documentation', exact: true }),
  ).toBeVisible()
  await expect(documentation).toContainText('Readable before trusting code.')
  await expect(
    documentation.locator('script, [onerror], [onclick], a[href^="javascript:"]'),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { __untrustedReadmeExecuted?: boolean })
          .__untrustedReadmeExecuted,
    ),
  ).toBeUndefined()
  await expect(panel(page).getByTestId('external-version')).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __externalPluginMetrics?: Record<string, unknown>
          }
        ).__externalPluginMetrics?.['manual-check'],
    ),
  ).toBeUndefined()
  page.once('dialog', (dialog) => dialog.accept())
  await panel(page).getByRole('switch').click()
  await openPluginSettings(page, 'manual-check')
  await expect(configuration(page, 'manual-check').getByTestId('external-version')).toHaveText(
    '1.0.0',
  )
  const replacement = standaloneBundle('2.0.0', 'manual-check')
  replacement.readme = copied.readme
  await writeFile(join(packageDirectory, 'manifest.json'), JSON.stringify(replacement.manifest))
  await writeFile(join(packageDirectory, 'main.js'), replacement.main)
  await writeFile(join(packageDirectory, 'styles.css'), replacement.styles!)
  await openPluginManager(page)
  await page.getByRole('button', { name: '重新扫描插件', exact: true }).click()
  await expect(panel(page)).toContainText('此设备尚未信任此插件包')
  await expect(panel(page).getByTestId('external-version')).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __externalPluginMetrics: Record<string, { executed: string[] }>
          }
        ).__externalPluginMetrics['manual-check']!.executed,
    ),
  ).toEqual(['1.0.0'])
  page.once('dialog', (dialog) => dialog.accept())
  await panel(page).getByRole('switch').click()
  await openPluginSettings(page, 'manual-check')
  await expect(configuration(page, 'manual-check').getByTestId('external-version')).toHaveText(
    '2.0.0',
  )
  expect(await storedLibrary(page)).toEqual(before)
})
