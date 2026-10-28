import { test, expect, storedLibrary } from './fixture'
import {
  sidebarDragFlow,
  sidebarKeyboardFlow,
  sidebarToggleFlow,
} from '../fixtures/sidebar-layout-flow'

test.beforeEach(async ({ page }) => {
  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
})

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

test('desktop sidebar toggle stays anchored while help and navigation groups remain identifiable', async ({
  page,
}) => {
  const before = await storedLibrary(page)
  await sidebarToggleFlow(page)
  expect(await storedLibrary(page)).toEqual(before)
})

test('a 500px desktop window clamps its vertical rail and restores the preferred width on expansion', async ({
  page,
}, info) => {
  const separator = page.getByRole('separator', { name: '调整侧栏宽度', exact: true })
  await expect(page.getByRole('button', { name: '创建卡组', exact: true }).first()).toBeEnabled()
  await separator.press('End')
  await expect(separator).toHaveAttribute('aria-valuenow', '360')
  await page.setViewportSize({ width: 500, height: 400 })
  await expect(separator).toBeVisible()
  await expect(separator).toHaveAttribute('aria-valuenow', '100')
  await expect(page.locator('.app-layout')).toHaveClass(/sidebar-collapsed/)
  await expect(page.locator('.sidebar-toggle')).toHaveCount(0)
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
  await expect(page.locator('.sidebar-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.app-layout')).not.toHaveClass(/sidebar-collapsed/)
  await page.screenshot({ path: info.outputPath('settings-general-wide.png'), fullPage: true })
})
