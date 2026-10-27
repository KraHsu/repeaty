import { test, expect, storedLibrary } from './fixture'
import type { Page } from '@playwright/test'

interface WindowFixture {
  calls: string[]
  failNext: string
  update(state: { maximized?: boolean; focused?: boolean }): void
}
const windowFixture = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __repeatyTestWindow: WindowFixture }).__repeatyTestWindow.calls,
  )

for (const [width, height] of [
  [1280, 720],
  [900, 600],
  [720, 560],
] as const) {
  test(`custom titlebar leaves the desktop workspace accessible at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    const titlebar = page.locator('.desktop-titlebar')
    await expect(titlebar).toBeVisible()
    await expect(page.locator('.app-layout')).toHaveClass(/desktop-window/)
    const bar = (await titlebar.boundingBox())!
    expect(bar.y).toBe(0)
    expect(bar.height).toBe(36)
    expect(bar.width).toBe(width)
    for (const selector of ['.sidebar', '.topbar']) {
      const box = (await page.locator(selector).boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(bar.height)
    }
    for (const name of ['最小化窗口', '最大化窗口', '关闭窗口']) {
      const control = titlebar.getByRole('button', { name, exact: true })
      await expect(control).toBeVisible()
      const box = (await control.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(bar.height)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    await expect(titlebar.locator('[data-tauri-drag-region]')).toBeVisible()
    expect(await titlebar.locator('button[data-tauri-drag-region]').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.getByRole('button', { name: '工作目录', exact: true }).click()
    await expect(page.locator('.workspace-manager')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`titlebar-${width}.png`), fullPage: true })
  })
}

test('window controls follow native state events, support keyboard input and keep the learning library intact', async ({
  page,
}) => {
  const before = await storedLibrary(page)
  const titlebar = page.locator('.desktop-titlebar')
  const minimize = titlebar.getByRole('button', { name: '最小化窗口', exact: true })
  await minimize.focus()
  await expect(minimize).toBeFocused()
  await minimize.press('Enter')
  await expect.poll(() => windowFixture(page)).toEqual(['minimize'])
  const maximize = titlebar.getByRole('button', { name: '最大化窗口', exact: true })
  await maximize.focus()
  await maximize.press('Space')
  await expect(titlebar.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible()
  await expect.poll(() => windowFixture(page)).toEqual(['minimize', 'toggle_maximize'])
  await page.evaluate(() =>
    (window as unknown as { __repeatyTestWindow: WindowFixture }).__repeatyTestWindow.update({
      maximized: false,
      focused: false,
    }),
  )
  await expect(titlebar.getByRole('button', { name: '最大化窗口', exact: true })).toBeVisible()
  await expect(titlebar).toHaveClass(/is-unfocused/)
  await page.evaluate(() =>
    (window as unknown as { __repeatyTestWindow: WindowFixture }).__repeatyTestWindow.update({
      focused: true,
    }),
  )
  await expect(titlebar).not.toHaveClass(/is-unfocused/)
  await page.locator('.language-picker select').selectOption('en')
  await expect(titlebar.getByRole('button', { name: 'Minimize window', exact: true })).toBeVisible()
  await expect(titlebar.getByRole('button', { name: 'Maximize window', exact: true })).toBeVisible()
  await titlebar.getByRole('button', { name: 'Close window', exact: true }).click()
  await expect.poll(() => windowFixture(page)).toEqual(['minimize', 'toggle_maximize', 'close'])
  expect(await storedLibrary(page)).toEqual(before)
  await expect(page.locator('.main-content')).toBeVisible()
})

test('a failed window request is visible and can be retried without leaving the workspace', async ({
  page,
}) => {
  await page.evaluate(() => {
    ;(window as unknown as { __repeatyTestWindow: WindowFixture }).__repeatyTestWindow.failNext =
      'minimize'
  })
  const titlebar = page.locator('.desktop-titlebar')
  await titlebar.getByRole('button', { name: '最小化窗口', exact: true }).click()
  await expect(titlebar.getByRole('alert')).toHaveText('窗口操作失败，请重试。')
  await titlebar.getByRole('button', { name: '最小化窗口', exact: true }).click()
  await expect(titlebar.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => windowFixture(page)).toEqual(['minimize', 'minimize'])
  await expect(page.locator('.app-layout')).toBeVisible()
})

test('the same window controls remain accessible inside modal and nested dialogs', async ({
  page,
}) => {
  await page.getByRole('button', { name: '快捷键', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  const controls = page.locator('.desktop-titlebar')
  await expect(controls).toHaveCount(1)
  await expect(modal.locator('.desktop-titlebar')).toBeVisible()
  await controls.getByRole('button', { name: '最小化窗口', exact: true }).click()
  await controls.getByRole('button', { name: '最大化窗口', exact: true }).click()
  await expect(controls.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible()
  await expect(modal).toBeVisible()
  await page.evaluate(() => {
    const nested = document.createElement('dialog')
    nested.setAttribute('aria-label', 'Nested window controls check')
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close nested dialog'
    close.addEventListener('click', () => {
      nested.close()
      nested.remove()
    })
    nested.append(close)
    document.body.append(nested)
    nested.showModal()
  })
  const nested = page.getByRole('dialog', { name: 'Nested window controls check', exact: true })
  await expect(nested.locator('.desktop-titlebar')).toBeVisible()
  await expect(controls).toHaveCount(1)
  await controls.getByRole('button', { name: '还原窗口', exact: true }).click()
  await expect(controls.getByRole('button', { name: '最大化窗口', exact: true })).toBeVisible()
  await nested.getByRole('button', { name: 'Close nested dialog', exact: true }).click()
  await expect(nested).toHaveCount(0)
  await expect(modal.locator('.desktop-titlebar')).toBeVisible()
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(controls).toHaveCount(1)
  expect(await controls.evaluate((element) => Boolean(element.closest('dialog')))).toBe(false)
  await controls.getByRole('button', { name: '最小化窗口', exact: true }).click()
  await expect
    .poll(() => windowFixture(page))
    .toEqual(['minimize', 'toggle_maximize', 'toggle_maximize', 'minimize'])
})
