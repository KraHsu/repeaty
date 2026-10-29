import { expect, type Page, type TestInfo } from '@playwright/test'
import { resolve } from 'node:path'
import { buildPlugin } from '../../packages/plugin-api/build.mjs'
import { fixture } from '../../src/core/test-fixtures'
import type { PluginBundle } from '../../src/plugins/package'
import { storedLibrary } from './stored-library'
import { confirmPluginAction, openPluginManager, selectPlugin } from './settings-flow'

const pluginId = 'page-lifecycle-check'
const nav = (page: Page, title: string) =>
  page.locator('.main-nav').getByRole('button', { name: title, exact: true })

async function install(page: Page, bundle: PluginBundle) {
  await openPluginManager(page)
  await page.locator('.plugin-actions input[type=file]').setInputFiles({
    name: `${pluginId}.repeaty-plugin`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  })
  await confirmPluginAction(page)
  await selectPlugin(page, pluginId)
  await expect(nav(page, 'Plugin notebook')).toBeVisible()
}

async function probe(page: Page) {
  return page.evaluate(
    () =>
      (
        globalThis as unknown as {
          __pagePluginProbe: {
            mounted: number
            unmounted: number
            timers: number
            disposed: number
          }
        }
      ).__pagePluginProbe,
  )
}

async function headerFrame(page: Page) {
  return page.locator('.app-page-header').evaluate((header) => {
    const box = header.getBoundingClientRect()
    const container = header.closest('.page')!.getBoundingClientRect()
    return { left: box.left, width: box.width, top: box.top - container.top }
  })
}

async function containedNavigation(page: Page) {
  const entries = await page.locator('.main-nav .nav-link').evaluateAll((entries) =>
    entries.map((entry) => {
      const button = entry.getBoundingClientRect()
      const navigation = entry.closest('.main-nav')!.getBoundingClientRect()
      const label = entry.querySelector('.nav-label')?.getBoundingClientRect()
      return {
        name: entry.getAttribute('aria-label') || entry.textContent,
        buttonFits: button.left >= navigation.left - 1 && button.right <= navigation.right + 1,
        labelFits:
          !label?.width || (label.left >= button.left - 1 && label.right <= button.right + 1),
      }
    }),
  )
  for (const entry of entries) {
    expect(entry.buttonFits, `${entry.name} stays inside the navigation`).toBe(true)
    expect(entry.labelFits, `${entry.name} stays inside its button`).toBe(true)
  }
}

export async function pluginPagesFlow(page: Page, info: TestInfo, edition: 'web' | 'desktop') {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Build through the public SDK after the host artifact, then install using the actual UI.
  const bundle = await buildPlugin(resolve('tests/fixtures/page-plugin'), {
    outdir: info.outputPath('external-plugin'),
  })
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'plugin-pages-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify(fixture({ front: 'Plugin widget review', back: 'A sample answer' })),
    ),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await install(page, bundle)

  await nav(page, '学习概览').click()
  await expect(page.getByTestId('widget-review-count')).toHaveText('0')
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await nav(page, '学习概览').click()
  await expect(page.getByTestId('widget-review-count')).toHaveText('1')
  const learningRecords = await storedLibrary(page)
  await page.getByRole('button', { name: 'Remove widget', exact: true }).click()
  await expect(page.getByTestId('plugin-review-widget')).toHaveCount(0)

  await nav(page, 'Plugin notebook').click()
  await expect(page.getByTestId('plugin-page-scope')).not.toHaveText('')
  await page
    .getByRole('textbox', { name: 'Plugin note', exact: true })
    .fill('saved in original library')
  await page.getByRole('button', { name: 'Save plugin note', exact: true }).click()
  await expect(page.getByTestId('saved-plugin-note')).toHaveText('saved in original library')
  await expect(page.getByTestId('private-plugin-note')).toHaveText('saved in original library')
  const originalScope = await page.getByTestId('plugin-page-scope').textContent()
  await page.getByRole('button', { name: 'Restore widget', exact: true }).click()

  // Both rail modes retain a proper accessible button and the same selection layer.
  for (const collapsed of [false, true]) {
    if (
      (await page.locator('.app-layout').getAttribute('class'))!.includes('sidebar-collapsed') !==
      collapsed
    )
      await page.locator('.sidebar-toggle').click()
    await expect(page.locator('.sidebar-toggle')).toHaveAttribute(
      'aria-expanded',
      String(!collapsed),
    )
    const entry = nav(page, 'Plugin notebook')
    await expect(entry).toHaveAttribute('aria-current', 'page')
    await expect(entry).toHaveAttribute('title', /Plugin notebook/)
    if (collapsed) await expect(entry.locator('.nav-label')).toBeHidden()
    else await expect(entry.locator('.nav-label')).toBeVisible()
    await expect(page.locator('.sidebar-nav-selection')).toHaveAttribute('data-on', '')
    await containedNavigation(page)
  }

  for (const [width, scale, theme] of [
    [1440, 1, 'light'],
    [edition === 'desktop' ? 500 : 390, 1, 'dark'],
    [1440, 2, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = `${value * 100}%`
    }, scale)
    await nav(page, '设置').click()
    await expect(page.locator('.app-page-header h1')).toHaveText('设置')
    await expect.poll(async () => (await probe(page)).timers).toBe(0)
    const host = await headerFrame(page)
    await nav(page, 'Plugin notebook').click()
    await expect(page.locator('.app-page-header h1')).toHaveText('Plugin notebook')
    await expect(page.locator('.main-content .page')).toHaveCount(1)
    const plugin = await headerFrame(page)
    expect(Math.abs(plugin.left - host.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(plugin.width - host.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(plugin.top - host.top)).toBeLessThanOrEqual(1)
    await expect(page.getByRole('button', { name: 'Save plugin note', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await containedNavigation(page)
    await page.screenshot({ path: info.outputPath(`plugin-page-${width}-${scale}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%'
  })
  await nav(page, 'Custom workspace').click()
  await expect(page.locator('.external-custom-page')).toBeVisible()
  await expect(page.locator('.main-content .app-page-header')).toHaveCount(0)
  await expect.poll(async () => (await probe(page)).timers).toBe(0)
  await page.getByRole('button', { name: 'Remove this page', exact: true }).click()
  await expect(nav(page, 'Custom workspace')).toHaveCount(0)
  await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
  await nav(page, 'Plugin notebook').click()
  await page.getByRole('button', { name: 'Restore custom page', exact: true }).click()
  await expect(nav(page, 'Custom workspace')).toBeVisible()

  await nav(page, 'Recoverable page').click()
  await expect(page.getByText('插件页面暂时无法显示。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重新加载页面', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Recovered plugin page', exact: true }),
  ).toBeVisible()

  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  const details = page.locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)
  await details.getByRole('switch', { name: '启用 Page Lifecycle Check', exact: true }).click()
  await expect(nav(page, 'Plugin notebook')).toHaveCount(0)
  await expect(nav(page, 'Custom workspace')).toHaveCount(0)
  await expect.poll(async () => (await probe(page)).timers).toBe(0)
  await expect.poll(async () => (await probe(page)).disposed).toBeGreaterThanOrEqual(1)
  await nav(page, '学习概览').click()
  await expect(page.getByTestId('plugin-review-widget')).toHaveCount(0)
  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await details.getByRole('switch', { name: '启用 Page Lifecycle Check', exact: true }).click()
  await nav(page, 'Plugin notebook').click()
  await expect(page.getByTestId('private-plugin-note')).toHaveText('saved in original library')

  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await details.getByRole('button', { name: '卸载插件', exact: true }).click()
  await confirmPluginAction(page)
  await expect(nav(page, 'Plugin notebook')).toHaveCount(0)
  expect(await storedLibrary(page)).toEqual(learningRecords)
  await install(page, bundle)
  await nav(page, 'Plugin notebook').click()
  await expect(page.getByRole('textbox', { name: 'Plugin note', exact: true })).toHaveValue(
    'saved in original library',
  )
  await expect(page.getByTestId('private-plugin-note')).toHaveText('saved in original library')

  if (edition === 'desktop') {
    await nav(page, '工作目录').click()
    await expect.poll(async () => (await probe(page)).timers).toBe(0)
    const originalPath = await page.locator('.workspace-active .workspace-path').textContent()
    await page.getByRole('button', { name: '创建学习库', exact: true }).click()
    // A successful library switch resets navigation to overview and unmounts the directory page.
    await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
    await expect(nav(page, 'Plugin notebook')).toHaveCount(0)
    // Native workspace changes may reload the document, which also releases its plugin timers.
    await expect.poll(async () => (await probe(page))?.timers ?? 0).toBe(0)
    await install(page, bundle)
    await nav(page, 'Plugin notebook').click()
    await expect(page.getByTestId('plugin-page-scope')).not.toHaveText(originalScope!)
    await expect(page.getByRole('textbox', { name: 'Plugin note', exact: true })).toHaveValue('')
    await expect(page.getByTestId('private-plugin-note')).toHaveText('')
    await nav(page, '工作目录').click()
    await page.locator('.workspace-recent-entry').filter({ hasText: originalPath! }).click()
    await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
    await nav(page, 'Plugin notebook').click()
    await expect(page.getByTestId('plugin-page-scope')).toHaveText(originalScope!)
    await expect(page.getByTestId('private-plugin-note')).toHaveText('saved in original library')
    expect(await storedLibrary(page)).toEqual(learningRecords)
  }
}
