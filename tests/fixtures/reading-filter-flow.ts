import { selectUiValue } from './ui-flow'
import { setResponsiveViewport } from './viewport-flow'
import { setInterfaceLanguage } from './settings-flow'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type { Library, MediaUpload } from '../../src/core/model'
import { fixture, now } from '../../src/core/test-fixtures'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  sourceExcerpt,
} from '../../src/core/sources'
import { exportArchive } from '../../src/core/archive'
import { reviewCard } from '../../src/core/scheduler'
import { queueView } from './reading-queue-flow'
import { importReading, moveReading, readingText, saveReading } from './reading-flow'
import { saveIndependentExcerpt, selectForExcerpt } from './source-excerpt-flow'

export async function restoreFilters(page: Page) {
  const content = 'Reading sentence 中文🙂\n'.repeat(300)
  const root = prepareSource({ title: 'Topic 原文', url: '', format: 'plain', content }, now)
  const other = prepareSource({ title: 'Other 原文', url: '', format: 'plain', content }, now)
  other.source.priority = 'high'
  let library = addSource(addSource(fixture(), root.source, root.asset), other.source, other.asset)
  const assets: MediaUpload[] = [root.asset, other.asset]
  const titles = [
    ...Array.from({ length: 21 }, (_, index) => `Topic ${String(index + 1).padStart(2, '0')}`),
    'Topic normal',
    'Topic low',
    'Topic future',
    'Topic archive',
  ]
  for (const [index, title] of titles.entries()) {
    const child = prepareSourceExcerpt(
      root.source,
      content,
      sourceExcerpt(root.source, content, 0, content.length),
      title,
      new Date(now.getTime() + index * 1000 + 1000),
    )
    if (title !== 'Topic normal') child.source.priority = title === 'Topic low' ? 'low' : 'high'
    if (title === 'Topic future')
      child.source.queue = { state: 'active', availableOn: '2099-12-31' }
    if (title === 'Topic archive')
      child.source.queue = { state: 'archived', availableOn: '2026-10-17' }
    if (title === 'Topic 21') delete child.source.origin
    library = addSource(library, child.source, child.asset)
    assets.push(child.asset)
  }
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  const archive = (await exportArchive(
    library,
    async (id) => assets.find((a) => a.meta.id === id)?.blob,
  ))!
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'source-filters.repeaty',
    mimeType: 'application/zip',
    buffer: Buffer.from(await archive.arrayBuffer()),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
}

export async function readingFilterFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await restoreFilters(page)
  const before = await read()
  const kind = page.getByLabel('材料类型', { exact: true })
  const priority = page.getByLabel('优先级筛选', { exact: true })
  const query = page.getByLabel('搜索材料', { exact: true })
  const filtered = page.getByRole('button', { name: '阅读筛选结果', exact: true })
  const counter = page.locator('#source-filter-count')
  await selectUiValue(kind, 'original')
  await selectUiValue(priority, 'normal')
  await query.fill('  TOPIC  ')
  await expect(page.locator('.source-list-title')).toHaveText(['Topic 原文'])
  await expect(counter).toHaveText('本列表 1 篇，其中 1 篇待阅读。')
  // Explicit navigation reveals a child even when the parent-only filter hides it.
  await page
    .getByRole('region', { name: '本篇摘录', exact: true })
    .getByRole('button', { name: '打开摘录「Topic 01」', exact: true })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Topic 01', exact: true })).toBeVisible()
  await expect(kind).toHaveAttribute('value', 'all')
  await expect(priority).toHaveAttribute('value', 'all')
  await expect(query).toHaveValue('')

  await selectUiValue(kind, 'excerpt')
  await selectUiValue(priority, 'high')
  await query.fill('  TOPIC  ')
  await expect(counter).toHaveText('本列表 23 篇，其中 21 篇待阅读。')
  await expect(page.locator('.source-queue-filters button')).toHaveText([
    '待阅读 21',
    '稍后阅读 1',
    '已归档 1',
    '全部材料 23',
  ])
  await page
    .locator('.source-list-pages')
    .getByRole('button', { name: '下一页', exact: true })
    .click()
  await expect(page.locator('.source-list-title')).toHaveText([
    'Topic 21',
    'Topic future',
    'Topic archive',
  ])
  await query.fill('Topic 02')
  await expect(page.locator('.source-list-title')).toHaveText(['Topic 02'])
  await expect(page.locator('.source-list-pages')).toHaveCount(0)
  await query.fill('topic')
  await queueView(page, '稍后阅读')
  await expect(page.locator('.source-list-title')).toHaveText(['Topic future'])
  await expect(filtered).toBeDisabled()
  await expect(counter).toHaveText('本列表 1 篇，其中 0 篇待阅读。')
  await queueView(page, '已归档')
  await expect(page.locator('.source-list-title')).toHaveText(['Topic archive'])
  await expect(filtered).toBeDisabled()
  await queueView(page, '待阅读')
  await expect(counter).toHaveText('本列表 21 篇，其中 21 篇待阅读。')
  await selectUiValue(kind, 'original')
  await expect(page.getByRole('heading', { name: '没有匹配的材料', exact: true })).toBeVisible()
  await expect(filtered).toBeDisabled()
  await expect(page.getByRole('button', { name: '开始一轮阅读', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(kind).toHaveAttribute('value', 'all')
  await expect(priority).toHaveAttribute('value', 'all')
  await expect(query).toHaveValue('')
  await expect(page.locator('.source-queue-filters button[aria-pressed="true"]')).toHaveText(
    '待阅读 25',
  )
  await selectUiValue(kind, 'excerpt')
  await selectUiValue(priority, 'high')
  await query.fill('topic')

  await setResponsiveViewport(page, 390, 844)
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  const englishKind = page.getByLabel('Source type', { exact: true })
  const englishPriority = page.getByLabel('Filter by priority', { exact: true })
  await selectUiValue(englishKind, 'excerpt')
  await page.getByLabel('Search sources', { exact: true }).fill('topic')
  await englishKind.focus()
  await englishKind.press('End')
  await englishKind.press('Tab')
  await expect(englishKind).toHaveAttribute('value', 'excerpt')
  await englishPriority.focus()
  await englishPriority.press('Space')
  await page.getByRole('option').first().press('Home')
  await page.getByRole('option').first().press('ArrowDown')
  await page.getByRole('option', { name: 'High priority', exact: true }).press('Enter')
  await englishPriority.press('Tab')
  await expect(englishPriority).toHaveAttribute('value', 'high')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const control of await page
    .locator('.source-filter-fields input, .source-filter-fields [role="combobox"]')
    .all()) {
    expect(
      await control.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16)
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await expect(counter).toHaveText('21 sources in this list · 21 ready to read')
  await page.screenshot({ path: info.outputPath('reading-filters-en.png'), fullPage: true })
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await selectUiValue(kind, 'excerpt')
  await selectUiValue(priority, 'high')
  await query.fill('topic')
  await page.screenshot({ path: info.outputPath('reading-filters-zh.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page
    .locator('.source-list-pages')
    .getByRole('button', { name: '下一页', exact: true })
    .click()
  await expect(page.locator('.source-list-title')).toHaveText(['Topic 21'])
  await filtered.click()
  await expect(page.getByRole('heading', { name: 'Topic 01', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '材料筛选', exact: true })).toHaveCount(0)
  await expect(page.locator('.reading-round-filter')).toHaveText('摘录 · 高优先级 · topic')
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 21 篇',
  )
  await selectUiValue(page.getByLabel('阅读优先级', { exact: true }), 'low')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'low')
  await moveReading(page, 0.6)
  for (let number = 2; number <= 21; number++) {
    await page.getByRole('button', { name: '下一篇', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: `Topic ${String(number).padStart(2, '0')}`, exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
      `第 ${number} 篇，共 21 篇`,
    )
  }
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()
  await expect(page.locator('.reading-round-filter')).toHaveText('摘录 · 高优先级 · topic')
  const saved = (await read()).sources.find((s) => s.title === 'Topic 01')!
  expect(saved.reading!.offset).toBeGreaterThan(500)
  expect(saved.priority).toBe('low')
  await page.getByRole('button', { name: '再读一轮', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Topic 02', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 20 篇',
  )
  await page.getByRole('button', { name: '结束本轮', exact: true }).click()
  await expect(kind).toHaveAttribute('value', 'excerpt')
  await expect(priority).toHaveAttribute('value', 'high')
  await expect(query).toHaveValue('topic')
  await query.fill('no matching title')
  await expect(filtered).toBeDisabled()
  await page.getByRole('button', { name: '开始一轮阅读', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Other 原文', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 25 篇',
  )
  await expect(page.locator('.reading-round-filter')).toHaveCount(0)
  await page.getByRole('button', { name: '结束本轮', exact: true }).click()
  await expect(kind).toHaveAttribute('value', 'all')
  await expect(priority).toHaveAttribute('value', 'all')
  await expect(query).toHaveValue('')
  // New excerpts and imports must remain visible after a restricted list.
  await selectUiValue(kind, 'original')
  await selectUiValue(priority, 'normal')
  await query.fill('Topic')
  await selectForExcerpt(page, 0, 40)
  await saveIndependentExcerpt(page, 'New filtered excerpt')
  await expect(
    page.getByRole('heading', { name: 'New filtered excerpt', exact: true }),
  ).toBeVisible()
  await expect(kind).toHaveAttribute('value', 'all')
  await expect(priority).toHaveAttribute('value', 'all')
  await expect(query).toHaveValue('')
  await selectUiValue(kind, 'excerpt')
  await selectUiValue(priority, 'high')
  await query.fill('no matching title')
  await importReading(page, 'New filtered import', 'plain', readingText)
  await expect(kind).toHaveAttribute('value', 'all')
  await expect(priority).toHaveAttribute('value', 'all')
  await expect(query).toHaveValue('')
  await query.fill('Topic 01')
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(kind).toHaveAttribute('value', 'all')
  await expect(priority).toHaveAttribute('value', 'all')
  await expect(query).toHaveValue('')
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toHaveCount(0)
  const after = await read()
  expect(after.sources.find((s) => s.id === saved.id)!.reading).toEqual(saved.reading)
  for (const name of ['notes', 'cards', 'reviews', 'practices', 'attempts'] as const)
    expect(after[name]).toEqual(before[name])
  for (const title of ['Topic future', 'Topic archive']) {
    expect(after.sources.find((s) => s.title === title)).toEqual(
      before.sources.find((s) => s.title === title),
    )
  }
}

export async function filteredRoundRetry(
  page: Page,
  read: () => Promise<Library>,
  fail: (enabled: boolean) => Promise<void>,
) {
  await importReading(page, 'Retry A', 'plain', readingText)
  await selectUiValue(page.getByLabel('阅读优先级', { exact: true }), 'high')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'high')
  await importReading(page, 'Retry B', 'plain', readingText)
  await selectUiValue(page.getByLabel('材料类型', { exact: true }), 'original')
  await selectUiValue(page.getByLabel('优先级筛选', { exact: true }), 'high')
  await page.getByLabel('搜索材料', { exact: true }).fill('Retry A')
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = await read()
  await fail(true)
  await moveReading(page, 0.7)
  await page.getByRole('button', { name: '阅读筛选结果', exact: true }).click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Retry A', exact: true })).toBeVisible()
  await expect(page.getByLabel('材料类型', { exact: true })).toHaveAttribute('value', 'original')
  await expect(page.getByLabel('优先级筛选', { exact: true })).toHaveAttribute('value', 'high')
  await expect(page.getByLabel('搜索材料', { exact: true })).toHaveValue('Retry A')
  expect(await read()).toEqual(before)
  await fail(false)
  await page.getByRole('button', { name: '阅读筛选结果', exact: true }).click()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 1 篇',
  )
  expect(
    (await read()).sources.find((s) => s.title === 'Retry A')!.reading!.offset,
  ).toBeGreaterThan(500)
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()
}
