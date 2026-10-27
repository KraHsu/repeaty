import { test, expect } from '@playwright/test'
import { sidebarDragFlow, sidebarKeyboardFlow } from './fixtures/sidebar-layout-flow'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('web sidebar supports pointer resizing, persistence, and restoring its default width', async ({
  page,
}) => {
  await sidebarDragFlow(page)
})

test('web icon sidebar keeps accessible navigation and keyboard width controls', async ({
  page,
}) => {
  await sidebarKeyboardFlow(page)
})

test('small web screens keep horizontal navigation instead of the desktop icon rail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('.sidebar-section-title button')).toBeEnabled()
  const separator = page.getByRole('separator', { name: '调整侧栏宽度', exact: true })
  await separator.press('End')
  await expect(separator).toHaveAttribute('aria-valuenow', '360')
  for (const width of [500, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(separator).toHaveCount(0)
    await expect(page.locator('.app-layout')).not.toHaveClass(/sidebar-collapsed/)
    const settings = page.locator('.main-nav').getByRole('button', { name: '设置', exact: true })
    await expect(settings.locator('.nav-label')).toBeVisible()
    await settings.click()
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(separator).toHaveAttribute('aria-valuenow', '360')
  await expect(page.locator('.desktop-titlebar')).toHaveCount(0)
})
