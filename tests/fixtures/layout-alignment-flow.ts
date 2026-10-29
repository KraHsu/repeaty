import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { openSettings, selectSettingsCategory } from './settings-flow'

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
    await page.evaluate(async (value) => {
      document.documentElement.style.fontSize = `${value * 100}%`
      // The sidebar's responsive margin transition can cross a container-query
      // breakpoint after the viewport has changed. Choose a layout only once it
      // settles, then allow container queries and ResizeObserver measurements to paint.
      await Promise.allSettled(
        document
          .querySelector('.main-content')!
          .getAnimations()
          .map((animation) => animation.finished),
      )
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    }, scale)
    const compactCategory = page.locator('.settings-mobile-category').getByRole('combobox')
    if (await compactCategory.isVisible()) {
      await expect(menu).toBeHidden()
      await selectSettingsCategory(page, 'general.notifications')
      await expect(page.locator('[data-settings-id="notifications"]')).toBeVisible()
      await expect(page.locator('[data-settings-id="appearance"]')).toHaveCount(0)
      await selectSettingsCategory(page, 'general.appearance')
      await expect(page.getByRole('combobox', { name: '界面语言', exact: true })).toBeVisible()
      await expect(page.locator('[data-settings-id="notifications"]')).toHaveCount(0)
      await noPageOverflow(page)
      const bounds = (await compactCategory.boundingBox())!
      expect(bounds.width).toBeGreaterThan(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      await page.screenshot({
        path: info.outputPath(`settings-alignment-${width}-${scale}.png`),
        fullPage: true,
        animations: 'disabled',
      })
      await selectSettingsCategory(page, 'general')
      continue
    }
    await expect(menu).toBeVisible()
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
          const rootRow = element
            .querySelector<HTMLElement>('[data-category-key="general"]')!
            .parentElement!.getBoundingClientRect()
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
          return Math.max(
            Math.abs(root.x - nav.x - 0.875 * rem),
            Math.abs(root.x - rootRow.x - 0.5 * rem),
            ...differences,
          )
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

async function centeredIcon(button: Locator) {
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
  expect(metrics.width).toBeGreaterThanOrEqual(44)
  expect(metrics.height).toBeGreaterThanOrEqual(44)
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
  if (!(await page.locator('.b-deck-tile').count())) {
    await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
    await expect(page.locator('.b-deck-tile').first()).toBeVisible()
  }
  // Selecting a deck changes the central review object without navigating away.
  const selectedTile = page.locator('.b-deck-tile').last()
  const selectedName = await selectedTile.locator('.deck-title').innerText()
  await selectedTile.click()
  await expect(selectedTile).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.b-focus-card h2')).toHaveText(selectedName)
  await expect(page.locator('.dashboard')).toBeVisible()
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
    const primary = page.locator('.b-start-review')
    await expect(primary).toBeVisible()
    const focusMetrics = await page.locator('.b-focus-stage').evaluate((element) => {
      const stage = element.getBoundingClientRect()
      const dashboard = element.closest('.dashboard')!.getBoundingClientRect()
      const primary = element.querySelector('.b-start-review')!
      const button = primary.getBoundingClientRect()
      const arrow = primary.querySelector('svg')!.getBoundingClientRect()
      return {
        center: Math.abs(stage.x + stage.width / 2 - dashboard.x - dashboard.width / 2),
        arrowCenter: Math.abs(button.y + button.height / 2 - arrow.y - arrow.height / 2),
        buttonHeight: button.height,
        whitespace: getComputedStyle(primary).whiteSpace,
        contained: button.left >= stage.left && button.right <= stage.right,
      }
    })
    expect(focusMetrics.center).toBeLessThanOrEqual(1)
    expect(focusMetrics.arrowCenter).toBeLessThanOrEqual(1)
    expect(focusMetrics.buttonHeight).toBeGreaterThanOrEqual(44 * scale)
    expect(focusMetrics.whitespace).toBe('nowrap')
    expect(focusMetrics.contained).toBe(true)
    const tiles = await page.locator('.b-deck-tile').evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect()
        const title = element.querySelector('.deck-title')!.getBoundingClientRect()
        return (
          title.left >= bounds.left && title.right <= bounds.right && title.bottom <= bounds.bottom
        )
      }),
    )
    expect(tiles.every(Boolean)).toBe(true)
    const help = page.locator('.sidebar-help')
    await expect(help).toHaveAccessibleName('帮助')
    if (!(await help.innerText()).trim()) await centeredIcon(help)
    else {
      const difference = await help.evaluate((element) => {
        const button = element.getBoundingClientRect()
        const icon = element.querySelector('svg')!.getBoundingClientRect()
        return getComputedStyle(element).flexDirection === 'column'
          ? Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2)
          : Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2)
      })
      expect(difference).toBeLessThanOrEqual(1)
    }
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
