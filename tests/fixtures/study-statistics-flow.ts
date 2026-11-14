import { expect, type Page, type TestInfo } from '@playwright/test'
import { fixture } from '../../src/core/test-fixtures'
import { studySettingsSchema } from '../../src/core/study-settings'
import { storedLibrary } from './stored-library'
import {
  confirmPluginAction,
  installOfficialPlugin,
  openPluginManager,
  selectPlugin,
  selectUiValue,
  setInterfaceLanguage,
} from './settings-flow'

const pluginId = 'study-statistics'
const nav = (page: Page, title: string) =>
  page.locator('.main-nav').getByRole('button', { name: title, exact: true })
const panel = (page: Page) => page.locator('.study-statistics')
const details = (page: Page) => page.locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)
const enabled = (page: Page) =>
  details(page).getByRole('switch', { name: '启用 学习统计', exact: true })
async function install(page: Page) {
  await openPluginManager(page)
  await installOfficialPlugin(page, pluginId)
  await expect(enabled(page)).not.toBeChecked()
  await enabled(page).click()
  await expect(enabled(page)).toBeChecked()
  await expect(details(page).locator('.plugin-readme')).toContainText('前台使用')
}
async function open(page: Page) {
  await nav(page, '学习统计').click()
  await expect(panel(page).locator('.statistics-calendar')).toBeVisible()
  await expect(panel(page).getByRole('button', { name: '刷新统计', exact: true })).toBeEnabled()
}
async function count(page: Page, category: string, value: number) {
  await expect(
    panel(page)
      .locator('.statistics-summary dl > div')
      .filter({ has: page.locator('dt', { hasText: category }) })
      .locator('dd'),
  ).toHaveText(String(value))
}

export async function studyStatisticsFlow(page: Page, info: TestInfo, workspaceSwitch = true) {
  page.setDefaultTimeout(10_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const { today, stamp, tomorrow, tomorrowMidnight } = await page.evaluate(() => {
    const date = new Date(),
      next = new Date(date)
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    next.setDate(next.getDate() + 1)
    next.setHours(0, 0, 0, 0)
    return {
      today: key(date),
      stamp: date.toISOString(),
      tomorrow: key(next),
      tomorrowMidnight: next.toISOString(),
    }
  })
  const library = fixture({ front: '统计验证卡片', back: '真实评分与已保存事件分别计数。' })
  library.notes.push({ ...library.notes[0]!, id: 'future-note', front: '明天零点到期' })
  library.cards.push({
    ...library.cards[0]!,
    id: 'future-card',
    noteId: 'future-note',
    schedule: { ...library.cards[0]!.schedule, due: tomorrowMidnight },
  })
  library.studySettings = [studySettingsSchema.parse({ statisticsSince: stamp })]
  library.studyEvents = [
    { id: 'reading-event', kind: 'reading', studyDay: today, occurredAt: stamp },
    {
      id: 'practice-event',
      kind: 'practice',
      studyDay: today,
      occurredAt: stamp,
      cardId: library.cards[0]!.id,
    },
  ]
  library.studyActivity = [
    {
      id: 'recorded-activity',
      kind: 'reading',
      studyDay: today,
      startedAt: new Date(Date.parse(stamp) - 600_000).toISOString(),
      endedAt: stamp,
      activeMs: 600_000,
    },
  ]
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'study-statistics.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await install(page)
  await open(page)
  await count(page, '正式评分', 0)
  await count(page, '阅读完成', 1)
  await count(page, '纯练习', 1)
  await expect(panel(page).locator('.statistics-time')).toContainText('10 分钟')
  await expect(panel(page).locator(`[data-day="${today}"]`)).toHaveAttribute('aria-pressed', 'true')
  await panel(page).locator(`[data-day="${today}"]`).press('ArrowRight')
  await expect(panel(page).locator(`[data-day="${tomorrow}"]`)).toBeFocused()
  await expect(panel(page).getByRole('combobox', { name: '明细类别' })).toContainText('计划卡片')
  const futureItem = panel(page)
    .locator('.statistics-detail-list li')
    .filter({ hasText: '明天零点到期' })
  await expect(futureItem.locator('time')).toHaveText(tomorrow)
  await expect(futureItem.locator('time')).toHaveAttribute('datetime', tomorrowMidnight)
  await panel(page).getByRole('button', { name: '今天', exact: true }).click()

  await nav(page, '学习概览').click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.locator('.grade-button.easy').click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await open(page)
  await count(page, '正式评分', 1)
  await expect(panel(page).locator('.statistics-detail-list')).toContainText('统计验证卡片')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await count(page, '正式评分', 0)
  await expect.poll(async () => (await storedLibrary(page)).reviews).toHaveLength(0)
  while (await page.getByRole('button', { name: '关闭提示', exact: true }).count()) {
    await page.getByRole('button', { name: '关闭提示', exact: true }).first().click()
  }

  // Shared host controls and container remain usable under narrow and enlarged text layouts.
  for (const [width, scale, theme] of [
    [1440, 1, 'light'],
    [500, 1, 'dark'],
    [1440, 2, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 1100 })
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale * 100}%`
    }, scale)
    await page.locator('.main-content').evaluate((element) => {
      element.scrollTop = 0
    })
    await expect
      .poll(() =>
        page.locator('.main-nav').evaluate((navigation) => {
          const target = navigation.querySelector<HTMLElement>('.nav-link[aria-current="page"]')
          const selection = navigation.querySelector<HTMLElement>('.sidebar-nav-selection')
          if (!target || !selection) return Number.POSITIVE_INFINITY
          const item = target.getBoundingClientRect(),
            highlight = selection.getBoundingClientRect()
          return Math.max(
            Math.abs(item.x - highlight.x),
            Math.abs(item.y - highlight.y),
            Math.abs(item.width - highlight.width),
            Math.abs(item.height - highlight.height),
          )
        }),
      )
      .toBeLessThan(2)
    expect(
      await panel(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const monthControls = panel(page).locator('.statistics-month-controls')
    const positions = await Promise.all([
      monthControls.getByRole('button', { name: '上个月', exact: true }).boundingBox(),
      monthControls.getByRole('combobox', { name: '查看月份', exact: true }).boundingBox(),
      monthControls.getByRole('button', { name: '下个月', exact: true }).boundingBox(),
      monthControls.getByRole('button', { name: '今天', exact: true }).boundingBox(),
    ])
    const centers = positions.map((box) => box!.y + box!.height / 2)
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2)
    await page.screenshot({
      path: info.outputPath(`statistics-${theme}-${width}-${scale}.png`),
      fullPage: true,
    })
    await panel(page).locator('.statistics-detail').scrollIntoViewIfNeeded()
    await page.screenshot({
      path: info.outputPath(`statistics-detail-${theme}-${width}-${scale}.png`),
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%'
  })
  await setInterfaceLanguage(page, 'en')
  await nav(page, 'Study statistics').click()
  await expect(page.locator('.app-page-header h1')).toHaveText('Study statistics')
  await setInterfaceLanguage(page, 'zh-CN')
  await open(page)
  await selectUiValue(page, panel(page).getByRole('combobox', { name: '明细类别' }), 'readings')
  await expect(panel(page).locator('.statistics-detail-list')).toContainText('reading-event')

  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await enabled(page).click()
  await expect(nav(page, '学习统计')).toHaveCount(0)
  await enabled(page).click()
  await open(page)
  await count(page, '阅读完成', 1)
  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await details(page).getByRole('button', { name: '卸载插件', exact: true }).click()
  await confirmPluginAction(page)
  await expect(nav(page, '学习统计')).toHaveCount(0)
  await expect.poll(async () => (await storedLibrary(page)).studyEvents).toHaveLength(2)
  await install(page)
  await open(page)
  await count(page, '阅读完成', 1)

  if (!workspaceSwitch) {
    expect(errors).toEqual([])
    return
  }
  await nav(page, '工作目录').click()
  const originalPath = await page.locator('.workspace-active .workspace-path').textContent()
  await page.getByRole('button', { name: '创建学习库', exact: true }).click()
  await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
  await expect(nav(page, '学习统计')).toHaveCount(0)
  await install(page)
  await open(page)
  await count(page, '阅读完成', 0)
  await nav(page, '工作目录').click()
  await page.locator('.workspace-recent-entry').filter({ hasText: originalPath! }).click()
  await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
  await open(page)
  await count(page, '阅读完成', 1)
  expect(errors).toEqual([])
}
