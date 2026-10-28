import { expect, test, type Page } from '@playwright/test'
import { openSettings } from './fixtures/settings-flow'

// Playwright's Chromium defaults include --hide-scrollbars. These checks and
// screenshots exercise the rails users actually see in Chrome and WebView.
test.use({
  launchOptions: {
    ignoreDefaultArgs: ['--hide-scrollbars'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  },
})

async function settings(page: Page) {
  await page.goto('./')
  await expect(page.locator('.sidebar-section-title button')).toBeEnabled()
  await openSettings(page)
  for (const close of await page.getByRole('button', { name: '关闭提示', exact: true }).all())
    await close.click()
}

async function typography(page: Page) {
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toHaveCSS(
    'font-size',
    '28px',
  )
  await expect(page.getByRole('heading', { name: '界面', exact: true })).toHaveCSS(
    'font-size',
    '20px',
  )
  await expect(page.getByText('界面语言', { exact: true })).toHaveCSS('font-size', '16px')
  await expect(page.getByRole('combobox', { name: '界面语言', exact: true })).toHaveCSS(
    'font-size',
    '16px',
  )
  await expect(page.locator('.ui-setting-group__description')).toHaveCSS('font-size', '14px')
  await expect(page.locator('.ui-setting-field [data-slot="description"]').first()).toHaveCSS(
    'font-size',
    '14px',
  )
  const family = await page
    .getByRole('combobox', { name: '界面语言', exact: true })
    .evaluate((el) => getComputedStyle(el).fontFamily)
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toHaveCSS(
    'font-family',
    family,
  )
}

test('settings shares typography roles, visible hover feedback and a responsive layout', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 950 })
  await settings(page)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 950 })
    await typography(page)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
  }
  await page.setViewportSize({ width: 1280, height: 950 })
  const select = page.getByRole('combobox', { name: '界面语言', exact: true })
  await page.mouse.move(0, 0)
  const normal = await select.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    shadow: getComputedStyle(el).boxShadow,
  }))
  await select.hover()
  await expect
    .poll(() =>
      select.evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        shadow: getComputedStyle(el).boxShadow,
      })),
    )
    .not.toEqual(normal)
  await page.mouse.move(0, 0)
  await expect
    .poll(() =>
      select.evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        shadow: getComputedStyle(el).boxShadow,
      })),
    )
    .toEqual(normal)
  await page.screenshot({ path: info.outputPath('settings-general-wide.png'), fullPage: true })
})

test('shared scrollbars remain usable and settings respect high contrast and larger fonts', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await settings(page)
  expect(
    await page.evaluate(
      () => document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight,
    ),
  ).toBe(true)
  await page.locator('.settings-page').hover({ position: { x: 20, y: 80 } })
  await page.mouse.wheel(0, 400)
  await expect
    .poll(() => page.evaluate(() => document.scrollingElement!.scrollTop))
    .toBeGreaterThan(0)
  await page.mouse.move(-10, -10)
  const documentRail = await page.evaluate(() => {
    const rail = getComputedStyle(document.documentElement, '::-webkit-scrollbar')
    const thumb = getComputedStyle(document.documentElement, '::-webkit-scrollbar-thumb')
    return { width: rail.width, color: thumb.backgroundColor, radius: thumb.borderRadius }
  })
  expect(documentRail.width).toBe('10px')
  expect(documentRail.color).toBe('rgb(184, 196, 177)')
  expect(parseFloat(documentRail.radius)).toBeGreaterThan(10)
  await page.screenshot({ path: info.outputPath('settings-document-scrollbar.png') })

  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  const textarea = dialog.getByLabel('正面 · 问题', { exact: true })
  await textarea.fill(
    Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 行：验证内嵌编辑区仍可滚动。`).join('\n'),
  )
  await textarea.press('Control+Home')
  const editorStart = await textarea.evaluate((el) => el.scrollTop)
  expect(editorStart).toBeLessThan(await textarea.evaluate((el) => el.clientHeight / 2))
  await textarea.hover()
  await page.mouse.wheel(0, 400)
  await expect.poll(() => textarea.evaluate((el) => el.scrollTop)).toBeGreaterThan(editorStart)
  await page.mouse.move(-10, -10)
  const editorRail = await textarea.evaluate((el) => {
    const rail = getComputedStyle(el, '::-webkit-scrollbar')
    const thumb = getComputedStyle(el, '::-webkit-scrollbar-thumb')
    return { width: rail.width, color: thumb.backgroundColor, radius: thumb.borderRadius }
  })
  expect(editorRail).toEqual(documentRail)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await openSettings(page)

  await page.emulateMedia({ forcedColors: 'active' })
  await expect(page.getByRole('switch', { name: '信息通知', exact: true })).toHaveCSS(
    'opacity',
    '1',
  )
  const notificationSwitch = page.getByRole('switch', { name: '信息通知', exact: true })
  const checked = await notificationSwitch.getAttribute('aria-checked')
  await notificationSwitch.focus()
  await notificationSwitch.press('Space')
  await expect(notificationSwitch).toHaveAttribute(
    'aria-checked',
    checked === 'true' ? 'false' : 'true',
  )
  await notificationSwitch.press('Space')
  await expect(notificationSwitch).toHaveAttribute('aria-checked', checked!)
  expect(
    await page.evaluate(() => ({
      width: getComputedStyle(document.documentElement).getPropertyValue('scrollbar-width'),
      color: getComputedStyle(document.documentElement).getPropertyValue('scrollbar-color'),
    })),
  ).toEqual({ width: 'auto', color: 'auto' })

  await page.emulateMedia({ forcedColors: 'none' })
  await page.setViewportSize({ width: 1280, height: 950 })
  const select = page.getByRole('combobox', { name: '界面语言', exact: true })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await expect(select).toHaveCSS('font-size', '32px')
  await select.click()
  await expect(page.getByRole('option', { name: 'English', exact: true })).toHaveCSS(
    'font-size',
    '32px',
  )
  await page.keyboard.press('Escape')
  await expect(page.getByText('界面语言', { exact: true })).toHaveCSS('font-size', '32px')
  await expect(page.locator('.ui-setting-field [data-slot="description"]').first()).toHaveCSS(
    'font-size',
    '28px',
  )
  const field = page.locator('.ui-setting-field').filter({ has: select })
  expect(await field.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(
    await select.evaluate(
      (el) =>
        el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 1,
    ),
  ).toBe(true)
})
