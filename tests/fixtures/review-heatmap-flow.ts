import { expect, type Page, type TestInfo } from '@playwright/test'
import { fixture } from '../../src/core/test-fixtures'
import { storedLibrary } from './stored-library'
import {
  confirmPluginAction,
  openPluginManager,
  selectPlugin,
  setInterfaceLanguage,
} from './settings-flow'

const pluginId = 'review-heatmap'
const nav = (page: Page, title: string) =>
  page.locator('.main-nav').getByRole('button', { name: title, exact: true })
const heatmap = (page: Page) =>
  page.locator(`[data-plugin-widget="${pluginId}/daily-reviews"] .review-heatmap`)
const details = (page: Page) => page.locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)
const enabled = (page: Page) =>
  details(page).getByRole('switch', { name: '启用 复习热力图', exact: true })

async function pluginIds(page: Page) {
  return page
    .locator('[data-plugin-select]')
    .evaluateAll((entries) =>
      entries.map((entry) => entry.getAttribute('data-plugin-select')!).sort(),
    )
}

async function installOfficialHeatmap(page: Page, screenshot?: { info: TestInfo; width: number }) {
  await openPluginManager(page)
  await expect(page.locator('.plugins-page')).toBeVisible()
  await expect(page.getByRole('button', { name: '安装或更新官方插件', exact: true })).toBeEnabled()
  const before = await pluginIds(page)
  expect(before).not.toContain(pluginId)
  await page.getByRole('button', { name: '安装或更新官方插件', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '安装或更新官方插件', exact: true })
  const entry = picker.locator(`[data-official-plugin="${pluginId}"]`)
  await expect(entry).toContainText('复习热力图')
  await expect(entry).toContainText('1.1.0')
  if (screenshot) {
    await page.setViewportSize({ width: screenshot.width, height: 1000 })
    expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    )
    await picker.screenshot({ path: screenshot.info.outputPath('official-catalog-narrow.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await entry.getByRole('button', { name: '安装并启用', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(details(page)).toBeVisible()
  await expect(enabled(page)).toBeChecked()
  expect(await pluginIds(page)).toEqual([...before, pluginId].sort())
}

async function total(page: Page, count: number, language: 'zh-CN' | 'en' = 'zh-CN') {
  await expect(heatmap(page)).toBeVisible()
  await expect(heatmap(page).locator('.review-heatmap-day')).toHaveCount(365)
  await expect(heatmap(page).locator('.review-heatmap-total')).toHaveText(
    language === 'zh-CN' ? `${count} 次复习` : `${count} ratings`,
  )
  const today = await page.evaluate(
    (language) =>
      new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' }).format(
        new Date(),
      ),
    language,
  )
  await expect(heatmap(page).locator('.review-heatmap-day').last()).toHaveAttribute(
    'aria-label',
    `${today}: ${count} ${language === 'zh-CN' ? '次复习' : 'ratings'}`,
  )
}

async function inspectCalendar(page: Page) {
  const cells = heatmap(page).locator('.review-heatmap-day')
  await expect(cells).toHaveCount(365)
  await expect(heatmap(page).locator('.review-heatmap-day[tabindex="0"]')).toHaveCount(1)
  const geometry = await heatmap(page).evaluate((element) => {
    const box = element.getBoundingClientRect()
    const cells = [...element.querySelectorAll<HTMLElement>('.review-heatmap-day')]
    const bounds = cells.map((cell) => cell.getBoundingClientRect())
    const rows = [...new Set(bounds.map((cell) => Math.round(cell.top)))].sort((a, b) => a - b)
    const columns = [...new Set(bounds.map((cell) => Math.round(cell.left)))].sort((a, b) => a - b)
    return {
      fitsWindow: box.left >= 0 && box.right <= innerWidth + 1,
      noOuterOverflow: element.scrollWidth <= element.clientWidth + 1,
      squareCells: bounds.every((cell) => Math.abs(cell.width - cell.height) < 0.5),
      rows: rows.length,
      columns: columns.length,
      alignedDays: cells.every((cell, index) => {
        const day = new Date(`${cell.dataset.date}T12:00:00`).getDay()
        return Math.round(bounds[index]!.top) === rows[day]
      }),
    }
  })
  expect(geometry).toEqual({
    fitsWindow: true,
    noOuterOverflow: true,
    squareCells: true,
    rows: 7,
    columns: 53,
    alignedDays: true,
  })
}

async function inspectCalendarControls(page: Page) {
  const cells = heatmap(page).locator('.review-heatmap-day')
  const detail = heatmap(page).locator('.review-heatmap-detail')
  await cells.last().hover()
  await expect(detail).toHaveText((await cells.last().getAttribute('aria-label'))!)
  await cells.nth(357).hover()
  await cells.last().focus()
  await expect(detail).toHaveText((await cells.last().getAttribute('aria-label'))!)
  await page.keyboard.press('ArrowLeft')
  await expect(cells.nth(357)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(cells.nth(356)).toBeFocused()
  await expect(detail).toHaveText((await cells.nth(356).getAttribute('aria-label'))!)
  await page.keyboard.press('Home')
  await expect(cells.first()).toBeFocused()
  await expect(detail).toHaveText((await cells.first().getAttribute('aria-label'))!)
  await page.keyboard.press('ArrowDown')
  await expect(cells.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(cells.nth(8)).toBeFocused()
  await page.keyboard.press('End')
  await expect(cells.last()).toBeFocused()
  const latestDetail = (await cells.last().getAttribute('aria-label'))!
  await expect(detail).toHaveText(latestDetail)
  await page.keyboard.press('Escape')
  await expect(detail).not.toHaveText(latestDetail)
  await page.keyboard.press('End')
  await expect(detail).toHaveText(latestDetail)
  await page.keyboard.press('Escape')
  await cells.last().click()
  await expect(detail).toHaveText(latestDetail)
}

async function screenshotCalendar(
  page: Page,
  info: TestInfo,
  edition: 'web' | 'desktop',
  prefix = 'heatmap',
) {
  for (const [width, scale, theme] of [
    [1440, 1, 'light'],
    [1440, 1, 'dark'],
    [edition === 'desktop' ? 500 : 390, 1, 'dark'],
    [1440, 2, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale * 100}%`
    }, scale)
    await heatmap(page).scrollIntoViewIfNeeded()
    await inspectCalendar(page)
    if (width <= 500) {
      const scroll = heatmap(page).locator('.review-heatmap-scroll')
      await expect
        .poll(() =>
          scroll.evaluate((element) => ({
            scrolls: element.scrollWidth > element.clientWidth,
            latestVisible: element.scrollWidth - element.clientWidth - element.scrollLeft <= 1,
          })),
        )
        .toEqual({ scrolls: true, latestVisible: true })
    }
    await heatmap(page).screenshot({
      path: info.outputPath(`${prefix}-${width}-${scale}-${theme}.png`),
    })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%'
  })
}

async function rateOnce(page: Page) {
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.locator('.grade-button.easy').click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await nav(page, '学习概览').click()
}

export async function reviewHeatmapFlow(page: Page, info: TestInfo, edition: 'web' | 'desktop') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'official-heatmap-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify(fixture({ front: 'Heatmap rating check', back: 'A saved formal rating' })),
    ),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await nav(page, '学习概览').click()
  await expect(heatmap(page)).toHaveCount(0)

  await installOfficialHeatmap(page, { info, width: edition === 'desktop' ? 500 : 390 })
  await expect(details(page).locator('.plugin-readme')).toContainText('365')
  await nav(page, '学习概览').click()
  await total(page, 0)
  const originalRecords = await storedLibrary(page)
  await rateOnce(page)
  await total(page, 1)
  await expect.poll(async () => (await storedLibrary(page)).reviews).toHaveLength(1)
  // The general undo remains available on overview and updates the already-mounted widget.
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await total(page, 0)
  await expect.poll(() => storedLibrary(page)).toEqual(originalRecords)
  await rateOnce(page)
  await total(page, 1)
  await expect.poll(async () => (await storedLibrary(page)).reviews).toHaveLength(1)
  const reviewedRecords = await storedLibrary(page)

  await inspectCalendarControls(page)
  await screenshotCalendar(page, info, edition)
  await setInterfaceLanguage(page, 'en')
  await nav(page, 'Overview').click()
  await total(page, 1, 'en')
  await expect(heatmap(page).getByRole('heading')).toHaveText('Review heatmap')
  await setInterfaceLanguage(page, 'zh-CN')

  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await enabled(page).click()
  await expect(enabled(page)).not.toBeChecked()
  await nav(page, '学习概览').click()
  await expect(heatmap(page)).toHaveCount(0)
  await page.reload()
  await nav(page, '学习概览').click()
  await expect(heatmap(page)).toHaveCount(0)
  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await expect(enabled(page)).not.toBeChecked()
  await enabled(page).click()
  await expect(enabled(page)).toBeChecked()
  await nav(page, '学习概览').click()
  await total(page, 1)

  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await details(page).getByRole('button', { name: '卸载插件', exact: true }).click()
  await confirmPluginAction(page)
  expect(await pluginIds(page)).not.toContain(pluginId)
  expect(await storedLibrary(page)).toEqual(reviewedRecords)
  await page.reload()
  await nav(page, '学习概览').click()
  await expect(heatmap(page)).toHaveCount(0)
  await installOfficialHeatmap(page)
  await nav(page, '学习概览').click()
  await total(page, 1)
  expect(await storedLibrary(page)).toEqual(reviewedRecords)

  if (edition === 'desktop') {
    await nav(page, '工作目录').click()
    const originalPath = await page.locator('.workspace-active .workspace-path').textContent()
    await page.getByRole('button', { name: '创建学习库', exact: true }).click()
    // Successful native library changes reload the page with the new workspace.
    await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
    await expect(heatmap(page)).toHaveCount(0)
    await installOfficialHeatmap(page)
    await nav(page, '学习概览').click()
    await total(page, 0)
    await nav(page, '工作目录').click()
    await page.locator('.workspace-recent-entry').filter({ hasText: originalPath! }).click()
    await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
    await total(page, 1)
    expect(await storedLibrary(page)).toEqual(reviewedRecords)
  }
  expect(errors).toEqual([])
}

export async function yearlyHeatmapFlow(page: Page, info: TestInfo) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const current = await page.evaluate(() => new Date().toISOString())
  const library = fixture({ front: '记住一个新单词', back: '将词义放进完整的句子。' })
  library.decks[0]!.name = '英语词汇'
  library.decks[0]!.description = '每天积累，在复习中巩固。'
  const expected = new Map<string, { count: number; level: number }>()
  for (let offset = 364; offset >= 0; offset--) {
    const day = new Date(current)
    day.setUTCHours(12, 0, 0, 0)
    day.setUTCDate(day.getUTCDate() - offset)
    const key = day.toISOString().slice(0, 10)
    const count = [0, 1, 2, 4, 7, 12, 0, 3, 1, 0, 5, 9, 15][offset % 13]!
    expected.set(key, {
      count,
      level: count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4,
    })
    for (let index = 0; index < count; index++) {
      library.reviews.push({
        id: `year-${key}-${index}`,
        cardId: library.cards[0]!.id,
        rating: 3,
        reviewedAt: day.toISOString(),
        nextDue: day.toISOString(),
        studyDay: key,
        kind: 'legacy',
        source: 'normal',
      })
    }
  }
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'heatmap-year.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await installOfficialHeatmap(page)
  await nav(page, '学习概览').click()
  await expect(heatmap(page).locator('.review-heatmap-total')).toHaveText(
    `${new Intl.NumberFormat('zh-CN').format(library.reviews.length)} 次复习`,
  )
  const actual = await heatmap(page)
    .locator('.review-heatmap-day')
    .evaluateAll((cells) =>
      cells.map((cell) => ({
        key: (cell as HTMLElement).dataset.date!,
        level: Number((cell as HTMLElement).dataset.level),
        label: cell.getAttribute('aria-label')!,
      })),
    )
  expect(actual).toHaveLength(365)
  expect(new Set(actual.map((cell) => cell.level))).toEqual(new Set([0, 1, 2, 3, 4]))
  for (const cell of actual) {
    expect(cell.level, cell.key).toBe(expected.get(cell.key)!.level)
    expect(cell.label, cell.key).toContain(`: ${expected.get(cell.key)!.count} 次复习`)
  }
  await inspectCalendarControls(page)
  await screenshotCalendar(page, info, 'web', 'heatmap-year')
  await setInterfaceLanguage(page, 'en')
  await nav(page, 'Overview').click()
  await expect(heatmap(page).getByRole('heading')).toHaveText('Review heatmap')
  await expect(heatmap(page).locator('.review-heatmap-total')).toHaveText(
    `${new Intl.NumberFormat('en').format(library.reviews.length)} ratings`,
  )
  await heatmap(page).screenshot({ path: info.outputPath('heatmap-year-en.png') })
}
