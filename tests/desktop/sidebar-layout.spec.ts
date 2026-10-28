import { test, expect, storedLibrary } from './fixture'
import { sidebarDragFlow, sidebarKeyboardFlow } from '../fixtures/sidebar-layout-flow'

test('desktop sidebar supports pointer resizing, persistence, and restoring its default width', async ({
  page,
}, info) => {
  const before = await storedLibrary(page)
  await sidebarDragFlow(page)
  expect(await storedLibrary(page)).toEqual(before)
  await page.screenshot({ path: info.outputPath('sidebar-expanded-1280.png') })
})

test('desktop icon sidebar keeps accessible navigation and keyboard width controls', async ({
  page,
}, info) => {
  await sidebarKeyboardFlow(page)
  await page.locator('.main-nav').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('separator', { name: '调整侧栏宽度', exact: true }).press('Home')
  await page.getByRole('treeitem', { name: '通用', exact: true }).click()
  await page.screenshot({ path: info.outputPath('sidebar-icons-72.png') })
})

test('a 500px desktop window clamps its vertical rail and restores the preferred width on expansion', async ({
  page,
}, info) => {
  const separator = page.getByRole('separator', { name: '调整侧栏宽度', exact: true })
  await expect(page.locator('.sidebar-section-title button')).toBeEnabled()
  await separator.press('End')
  await expect(separator).toHaveAttribute('aria-valuenow', '360')
  await page.setViewportSize({ width: 500, height: 400 })
  await expect(separator).toBeVisible()
  await expect(separator).toHaveAttribute('aria-valuenow', '100')
  await expect(page.locator('.app-layout')).toHaveClass(/sidebar-collapsed/)
  const sidebar = (await page.locator('.sidebar').boundingBox())!
  expect(sidebar.y).toBeGreaterThanOrEqual(36)
  expect(sidebar.width).toBe(100)
  const settings = page.locator('.main-nav').getByRole('button', { name: '设置', exact: true })
  await expect(settings.locator('.nav-label')).toBeHidden()
  await settings.click()
  await expect(page.getByRole('combobox', { name: '界面语言', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('settings-500x400.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(separator).toHaveAttribute('aria-valuenow', '360')
  await expect(page.locator('.app-layout')).not.toHaveClass(/sidebar-collapsed/)
  await page.screenshot({ path: info.outputPath('settings-general-wide.png'), fullPage: true })
})
