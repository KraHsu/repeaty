import { expect, type Page, type TestInfo } from '@playwright/test'
import { selectUiValue } from './ui-flow'
import { localLibrary } from './source-excerpt-flow'

export async function createSearchToolsCard(page: Page) {
  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称', { exact: true }).fill('Search tools')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('How do I remember a useful filter?')
  await page.getByLabel('背面 · 答案', { exact: true }).fill('Save the current query and reuse it.')
  await page.getByLabel('标签', { exact: false }).fill('search-tools')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.locator('.card-table tbody tr')).toHaveCount(1)
}

export async function searchToolsLayoutFlow(page: Page, info: TestInfo, desktop: boolean) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await createSearchToolsCard(page)
  const tools = page.locator('.collection-search-tools')
  const save = tools.getByRole('button', { name: '保存筛选', exact: true })
  const study = tools.getByRole('button', { name: '专项练习', exact: true })
  const syntax = tools.getByRole('button', { name: '搜索语法', exact: true })
  const panel = tools.locator('.search-tools-panel')
  const start = tools.getByRole('button', { name: '开始专项练习', exact: true })
  await expect(panel).toHaveCount(0)
  await expect(tools.getByLabel('常用筛选', { exact: true })).toBeVisible()
  const picker = (await tools.getByLabel('常用筛选', { exact: true }).boundingBox())!
  const saveButton = (await save.boundingBox())!
  const syntaxButton = (await syntax.boundingBox())!
  expect(Math.abs(picker.y - saveButton.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(picker.y - syntaxButton.y)).toBeLessThanOrEqual(1)
  expect(picker.width).toBeLessThanOrEqual(288)
  await syntax.click()
  await expect(panel).toHaveCount(1)
  await expect(panel).toContainText('due 按距今天的日历天数计算')
  await expect(panel).toContainText('type:plugin / type:leetcode')
  await save.click()
  await expect(panel).toHaveCount(1)
  await expect(panel.locator('.search-syntax-list')).toHaveCount(0)
  await tools.getByLabel('筛选名称', { exact: true }).fill('Remember this name')
  await study.click()
  await expect(tools.getByLabel('筛选名称', { exact: true })).toHaveCount(0)
  await expect(tools.getByLabel('练习模式', { exact: true })).toBeVisible()
  await expect(panel).toContainText('可练习 1 张')
  await save.click()
  await expect(tools.getByLabel('筛选名称', { exact: true })).toHaveValue('Remember this name')
  await tools.getByRole('button', { name: '收起搜索工具', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(save).toBeFocused()

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
    await page.screenshot({
      path: info.outputPath(`search-tools-${theme}-idle.png`),
      animations: 'disabled',
    })
    await study.click()
    await expect(start).toBeEnabled()
    await page.screenshot({
      path: info.outputPath(`search-tools-${theme}-practice.png`),
      animations: 'disabled',
    })
    await tools.getByRole('button', { name: '收起搜索工具', exact: true }).click()
  }
  await study.click()
  for (const [width, scale] of [
    [desktop ? 500 : 390, 1],
    [1440, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale * 100}%`
    }, scale)
    await expect(start).toBeVisible()
    await expect
      .poll(() =>
        tools.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return [...element.querySelectorAll('button, input, [role="combobox"]')].every(
            (control) => {
              const rect = control.getBoundingClientRect()
              return rect.left >= box.left - 1 && rect.right <= box.right + 1
            },
          )
        }),
      )
      .toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await tools.screenshot({
      path: info.outputPath(`search-tools-${width}-${scale}.png`),
      animations: 'disabled',
    })
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const search = page.getByLabel('搜索卡片', { exact: true })
  await search.fill('missing-result-0826')
  await search.press('Escape')
  await expect(panel).toContainText('可练习 0 张')
  await expect(page.locator('.library-count')).toHaveText('0 张卡片 · 全库 1 条笔记')
  await expect(start).toBeDisabled()
  await search.fill('due:not-a-number')
  await search.press('Escape')
  await expect(panel).toContainText('请先修正搜索条件。')
  await expect(start).toBeDisabled()
  await search.fill('')
  await search.press('Escape')
  const limit = tools.getByRole('spinbutton', { name: '卡片数量上限', exact: true })
  await limit.fill('0')
  await expect(start).toBeDisabled()
  await limit.fill('2')
  await expect(start).toBeEnabled()
  await expect(panel).toContainText('本轮 1 张')
  await selectUiValue(tools.getByLabel('练习模式', { exact: true }), 'true')
  await expect(panel).toContainText('评分会更新复习时间并计入今日学习')
}

export async function searchToolsSaveRetryFlow(
  page: Page,
  rejectSave: (enabled: boolean) => Promise<void>,
) {
  await createSearchToolsCard(page)
  const original = await localLibrary(page)
  const search = page.getByLabel('搜索卡片', { exact: true })
  const tools = page.locator('.collection-search-tools')
  const save = tools.getByRole('button', { name: '保存筛选', exact: true })
  const name = tools.getByLabel('筛选名称', { exact: true })
  await search.fill('tag:search-tools is:new')
  await save.click()
  await name.fill('Cards to practise')
  await rejectSave(true)
  await tools.getByRole('button', { name: '另存筛选', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('存储空间不足')
  await expect(name).toHaveValue('Cards to practise')
  await expect(search).toHaveValue('tag:search-tools is:new')
  expect((await localLibrary(page)).savedSearches).toHaveLength(0)
  await rejectSave(false)
  await tools.getByRole('button', { name: '另存筛选', exact: true }).click()
  await expect(tools.locator('.search-tools-panel')).toHaveCount(0)
  await expect(save).toBeFocused()
  await page.reload()
  await page.locator('.main-nav').getByRole('button', { name: '全部卡片', exact: true }).click()
  await selectUiValue(tools.getByLabel('常用筛选', { exact: true }), { label: 'Cards to practise' })
  await expect(search).toHaveValue('tag:search-tools is:new')
  await save.click()
  await name.fill('Updated filter')
  await tools.getByRole('button', { name: '更新筛选', exact: true }).click()
  await expect(tools.locator('.search-tools-panel')).toHaveCount(0)
  expect((await localLibrary(page)).savedSearches.map((saved) => saved.name)).toEqual([
    'Updated filter',
  ])
  await save.click()
  await name.fill('Second filter')
  await tools.getByRole('button', { name: '另存筛选', exact: true }).click()
  await expect(tools.locator('.search-tools-panel')).toHaveCount(0)
  expect((await localLibrary(page)).savedSearches).toHaveLength(2)
  await save.click()
  await tools.getByRole('button', { name: '删除筛选', exact: true }).click()
  await expect(tools.locator('.search-tools-panel')).toHaveCount(0)
  await page.reload()
  await page.locator('.main-nav').getByRole('button', { name: '全部卡片', exact: true }).click()
  const final = await localLibrary(page)
  expect(final.savedSearches.map((saved) => saved.name)).toEqual(['Updated filter'])
  expect({ ...final, savedSearches: [] }).toEqual(original)
}
