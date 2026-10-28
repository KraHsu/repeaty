import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { openSettings } from './settings-flow'

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
}

/** Check drawn paths against actual text geometry, rather than CSS class names. */
export async function settingsAlignmentFlow(page: Page, info: TestInfo, narrowWidth: number) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openSettings(page)
  const menu = page.locator('.settings-categories')
  const general = menu.locator('[data-category-key="general"]')
  const toggle = general.locator('..').locator('.branched-menu__toggle')
  for (const [width, scale] of [
    [1440, 1],
    [narrowWidth, 1],
    [1440, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = `${value * 100}%`
    }, scale)
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    await expect(general).toHaveAttribute('aria-expanded', 'true')
    await expect
      .poll(() =>
        menu.evaluate((element) => {
          const nav = element.getBoundingClientRect()
          const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
          const root = element
            .querySelector<HTMLElement>('[data-category-key="general"] .branched-menu__label')!
            .getBoundingClientRect()
          const group = element.querySelector<HTMLElement>('[id$="branch-general"]')!
          const labels = ['general.appearance', 'general.notifications'].map((key) =>
            element
              .querySelector<HTMLElement>(`[data-category-key="${key}"] .branched-menu__label`)!
              .getBoundingClientRect(),
          )
          const paths = [
            ...group.querySelectorAll<SVGPathElement>(':scope > svg > .branched-menu__base'),
          ].slice(1)
          const differences = labels.map((label, index) => {
            const path = paths[index]!
            const point = path.getPointAtLength(path.getTotalLength())
            const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
            return Math.max(
              Math.abs(screen.y - (label.y + label.height / 2)),
              Math.abs(label.x - screen.x - 0.5 * rem),
              Math.abs(label.x - root.x - 2.5 * rem),
            )
          })
          return Math.max(Math.abs(root.x - nav.x - 0.875 * rem), ...differences)
        }),
      )
      .toBeLessThanOrEqual(1)
    const down = await toggle.locator('svg').evaluate((svg: SVGSVGElement) => {
      const box = svg.getBBox()
      return box.width > box.height
    })
    expect(down).toBe(true)
    await noPageOverflow(page)
    await page.screenshot({
      path: info.outputPath(`settings-alignment-${width}-${scale}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await toggle.click()
    await expect(general).toHaveAttribute('aria-expanded', 'false')
    expect(
      await toggle.locator('svg').evaluate((svg: SVGSVGElement) => {
        const box = svg.getBBox()
        return box.height > box.width
      }),
    ).toBe(true)
  }
}

async function centeredIcon(button: Locator, scale: number) {
  await expect(button).toBeVisible()
  const metrics = await button.evaluate((element) => {
    const button = element.getBoundingClientRect()
    const icon = element.querySelector('svg')!.getBoundingClientRect()
    return {
      width: button.width,
      height: button.height,
      dx: Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2),
      dy: Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2),
    }
  })
  expect(metrics.width).toBeGreaterThanOrEqual(44 * scale)
  expect(metrics.height).toBeGreaterThanOrEqual(44 * scale)
  expect(metrics.dx).toBeLessThanOrEqual(1)
  expect(metrics.dy).toBeLessThanOrEqual(1)
}

export async function dashboardAndBackupAlignmentFlow(
  page: Page,
  info: TestInfo,
  narrowWidth: number,
) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const overview = page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true })
  await overview.click()
  if (!(await page.locator('.deck-review').count())) {
    await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
    await expect(page.locator('.deck-review').first()).toBeVisible()
  }
  for (const [width, scale] of [
    [1440, 1],
    [narrowWidth, 1],
    [1440, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = `${value * 100}%`
    }, scale)
    await overview.click()
    await centeredIcon(page.locator('.deck-review').first(), scale)
    await centeredIcon(
      page.locator('.topbar').getByRole('button', { name: '快捷键', exact: true }),
      scale,
    )
    await noPageOverflow(page)
    const dashboard = await page.locator('.dashboard').boundingBox()
    await page.screenshot({
      path: info.outputPath(`dashboard-alignment-${width}-${scale}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await page.locator('.main-nav').getByRole('button', { name: '数据与备份', exact: true }).click()
    const backup = page.locator('.data-page')
    await expect(backup).toBeVisible()
    const bounds = (await backup.boundingBox())!
    expect(Math.abs(bounds.x - dashboard!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(bounds.width - dashboard!.width)).toBeLessThanOrEqual(1)
    const differences = await backup.evaluate((element) => {
      const page = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const left = page.left + Number.parseFloat(style.paddingLeft)
      const width =
        page.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      return [
        ...element.querySelectorAll<HTMLElement>(
          '.storage-banner, .backup-grid, .about-core, .snapshot-section',
        ),
      ].map((child) => {
        const box = child.getBoundingClientRect()
        return Math.max(Math.abs(box.left - left), Math.abs(box.width - width))
      })
    })
    expect(differences.length).toBeGreaterThanOrEqual(4)
    for (const difference of differences) expect(difference).toBeLessThanOrEqual(1)
    await noPageOverflow(page)
    await page.screenshot({
      path: info.outputPath(`backup-alignment-${width}-${scale}.png`),
      fullPage: true,
      animations: 'disabled',
    })
  }
}
