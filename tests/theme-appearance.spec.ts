import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings } from './fixtures/settings-flow'
import { selectUiValue } from './fixtures/ui-flow'
import { browserWorkspaceFixture, directoryDigest } from './fixtures/browser-workspace'

async function chooseTheme(page: Page, theme: 'system' | 'light' | 'dark') {
  await openSettings(page, 'general.appearance')
  await selectUiValue(page.getByRole('combobox', { name: '颜色模式', exact: true }), theme)
}

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  const root = page.locator('html')
  if (theme === 'dark') await expect(root).toHaveClass(/\bdark\b/)
  else await expect(root).not.toHaveClass(/\bdark\b/)
  await expect(root).toHaveCSS('color-scheme', theme)
}

/** Resolve computed CSS colors (including color-mix/oklch) through the browser's sRGB canvas. */
async function appearance(element: Locator, pseudo?: '::placeholder') {
  return element.evaluate((element, pseudo) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    type Rgba = [number, number, number, number]
    function rgba(color: string): Rgba {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const data = context.getImageData(0, 0, 1, 1).data
      return [data[0]!, data[1]!, data[2]!, data[3]! / 255]
    }
    function over(foreground: Rgba, background: Rgba): Rgba {
      return [
        foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
        foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
        foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
        1,
      ]
    }
    function luminance(color: Rgba) {
      const channels = color.slice(0, 3).map((value) => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    }
    const ancestors: Element[] = []
    for (let current: Element | null = element; current; current = current.parentElement) {
      ancestors.unshift(current)
    }
    const background = ancestors.reduce<Rgba>(
      (color, ancestor) => over(rgba(getComputedStyle(ancestor).backgroundColor), color),
      [255, 255, 255, 1],
    )
    const style = getComputedStyle(element, pseudo)
    const foreground = rgba(style.color)
    foreground[3] *= Number(style.opacity)
    const backgroundLuminance = luminance(background)
    const foregroundLuminance = luminance(over(foreground, background))
    return {
      color: style.color,
      background,
      backgroundLuminance,
      contrast:
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
    }
  }, pseudo)
}

async function expectReadable(element: Locator, pseudo?: '::placeholder') {
  await expect(element).toBeVisible()
  await expect
    .poll(async () => (await appearance(element, pseudo)).contrast, {
      message: `${pseudo ?? 'Text'} must have at least 4.5:1 contrast against its rendered background`,
    })
    .toBeGreaterThanOrEqual(4.5)
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 1000 })
})

test('follows system by default, preserves explicit choices on reload, and resumes following system', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await expectTheme(page, 'dark')
  await openSettings(page, 'general.appearance')
  const choice = page.getByRole('combobox', { name: '颜色模式', exact: true })
  await expect(choice).toContainText('跟随系统')
  await page.emulateMedia({ colorScheme: 'light' })
  await expectTheme(page, 'light')

  await selectUiValue(choice, 'dark')
  await expectTheme(page, 'dark')
  await page.reload()
  await expectTheme(page, 'dark')
  await openSettings(page, 'general.appearance')
  await expect(choice).toContainText('深色')

  await selectUiValue(choice, 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expectTheme(page, 'light')
  await page.reload()
  await expectTheme(page, 'light')
  await openSettings(page, 'general.appearance')
  await expect(choice).toContainText('浅色')

  await selectUiValue(choice, 'system')
  await expectTheme(page, 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expectTheme(page, 'light')
  await page.reload()
  await expectTheme(page, 'light')
  await openSettings(page, 'general.appearance')
  await expect(choice).toContainText('跟随系统')
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} appearance keeps review buttons, select values, placeholders, and panel headings readable`, async ({
    page,
  }, info) => {
    // A contrary system preference must not leak into the explicit application choice.
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' })
    await page.goto('./')
    await chooseTheme(page, theme)
    await expectTheme(page, theme)
    const heading = page.locator('.settings-panel-heading h2')
    await expectReadable(heading)
    const panel = await appearance(heading)
    if (theme === 'light') expect(panel.backgroundLuminance).toBeGreaterThan(0.8)
    else expect(panel.backgroundLuminance).toBeLessThan(0.15)
    for (const label of ['界面语言', '颜色模式']) {
      const control = page.getByRole('combobox', { name: label, exact: true })
      await expectReadable(control.locator('[data-slot="value"], [data-slot="placeholder"]'))
    }

    await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
    await expectReadable(page.locator('.b-focus-card h2'))
    const start = page.getByRole('button', { name: '开始复习', exact: true })
    await expect(start).toBeEnabled()
    await expectReadable(start)
    await expectReadable(start.locator('svg'))
    await page.screenshot({
      path: info.outputPath(`${theme}-overview.png`),
      animations: 'disabled',
    })

    await page.locator('.main-nav').getByRole('button', { name: '全部卡片', exact: true }).click()
    await expectReadable(page.locator('.cards-page h1'))
    for (const label of ['筛选卡组', '筛选状态']) {
      const control = page.getByRole('combobox', { name: label, exact: true })
      await expectReadable(control.locator('[data-slot="value"], [data-slot="placeholder"]'))
    }
    const search = page.getByLabel('搜索卡片', { exact: true })
    await expect(search).toHaveValue('')
    await expectReadable(search, '::placeholder')
    await page.screenshot({ path: info.outputPath(`${theme}-cards.png`), animations: 'disabled' })

    await page.getByRole('button', { name: '专项练习', exact: true }).click()
    const advanced = page.locator('.collection-search-tools')
    const savedFilter = advanced.getByRole('combobox', { name: '常用筛选', exact: true })
    await expectReadable(savedFilter.locator('[data-slot="value"], [data-slot="placeholder"]'))
    const practiceMode = advanced.locator('.search-study-form').getByRole('combobox')
    await expectReadable(practiceMode.locator('[data-slot="value"], [data-slot="placeholder"]'))
    await expectReadable(advanced.getByRole('spinbutton', { name: '卡片数量上限', exact: true }))
    await expectReadable(advanced.getByRole('button', { name: '开始专项练习', exact: true }))
    await advanced.screenshot({
      path: info.outputPath(`${theme}-advanced-search.png`),
      animations: 'disabled',
    })

    await page.locator('.main-nav').getByRole('button', { name: '数据与备份', exact: true }).click()
    await page.getByRole('button', { name: '立即创建快照', exact: true }).click()
    const snapshot = page.locator('.snapshot-list li').first()
    await expectReadable(snapshot.locator('strong'))
    await expectReadable(snapshot.locator('div > span'))
    const snapshotSurface = await appearance(snapshot.locator('strong'))
    if (theme === 'light') expect(snapshotSurface.backgroundLuminance).toBeGreaterThan(0.8)
    else expect(snapshotSurface.backgroundLuminance).toBeLessThan(0.15)
    await page.locator('.snapshot-list').screenshot({
      path: info.outputPath(`${theme}-snapshots.png`),
      animations: 'disabled',
    })
  })
}

test.describe('read-only workspace appearance', () => {
  test.use({ serviceWorkers: 'block' })

  test('keeps the trial notice readable in dark and explicit light modes without changing the original folder', async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    const env = await browserWorkspaceFixture()
    try {
      const before = await directoryDigest(env.path)
      await page.addInitScript(() =>
        Object.defineProperty(window, 'showDirectoryPicker', {
          value: undefined,
          configurable: true,
        }),
      )
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.goto('./')
      await expectTheme(page, 'dark')
      await page.locator('.main-nav').getByRole('button', { name: '工作目录', exact: true }).click()
      await page.getByLabel('选择工作目录文件夹', { exact: true }).setInputFiles(env.path)
      await expect(page.getByRole('region', { name: '工作目录预览' })).toBeVisible({
        timeout: 30_000,
      })
      await page.getByRole('button', { name: '开始试用', exact: true }).click()
      const notice = page.getByRole('complementary', { name: '工作目录试用', exact: true })
      await expect(notice).toBeVisible()
      for (const theme of ['dark', 'light'] as const) {
        if (theme === 'light') await chooseTheme(page, 'light')
        await expectTheme(page, theme)
        await expectReadable(notice.locator('strong'))
        await expectReadable(notice.locator('p'))
        await expectReadable(notice.getByRole('button', { name: '工作目录', exact: true }))
        const surface = await appearance(notice.locator('p'))
        if (theme === 'light') expect(surface.backgroundLuminance).toBeGreaterThan(0.8)
        else expect(surface.backgroundLuminance).toBeLessThan(0.15)
        await notice.screenshot({
          path: info.outputPath(`${theme}-workspace-trial-notice.png`),
          animations: 'disabled',
        })
      }
      expect(await directoryDigest(env.path)).toEqual(before)
    } finally {
      await env.close()
    }
  })
})
