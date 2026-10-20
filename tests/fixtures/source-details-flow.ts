import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library } from '../../src/core/model'
import { parseArchive } from '../../src/core/archive'
import { restoreNavigation } from './source-navigation-flow'
import { sourceQuote } from './source-flow'
import { importReading, moveReading, readingText, saveReading } from './reading-flow'

export async function openSourceDetails(page: Page) {
  await page.getByRole('button', { name: '编辑材料信息', exact: true }).click()
  return page.getByRole('dialog', { name: '编辑材料信息', exact: true })
}
export async function changeSourceDetails(page: Page, title: string, url = '') {
  const dialog = await openSourceDetails(page)
  await dialog.getByLabel('材料标题', { exact: true }).fill(title)
  await dialog.getByLabel('来源链接（可选）', { exact: true }).fill(url)
  await dialog.getByRole('button', { name: '保存材料信息', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

export async function sourceDetailsFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  const data = await restoreNavigation(page)
  await page.getByRole('button', { name: '阅读 Markdown 预览', exact: true }).click()
  await moveReading(page, 0.35)
  await saveReading(page)
  const before = await read()
  let dialog = await openSourceDetails(page)
  await expect(dialog.getByLabel('材料标题', { exact: true })).toHaveValue('导航原文')
  await dialog.getByLabel('材料标题', { exact: true }).fill('Canceled title')
  await dialog.getByLabel('来源链接（可选）', { exact: true }).fill('https://example.org/canceled')
  await dialog.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect((await read()).sources).toEqual(before.sources)

  await page.getByLabel('搜索材料', { exact: true }).fill('导航原文')
  dialog = await openSourceDetails(page)
  await dialog.getByLabel('材料标题', { exact: true }).fill('   ')
  await dialog.getByRole('button', { name: '保存材料信息', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('title')
  expect((await read()).sources).toEqual(before.sources)
  const rootTitle = '重命名原文🙂'
  const rootUrl = 'https://example.org/revised?from=repeaty#source'
  await dialog.getByLabel('材料标题', { exact: true }).fill(rootTitle)
  await dialog.getByLabel('来源链接（可选）', { exact: true }).fill(rootUrl)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('界面语言').selectOption('en')
  const english = page.getByRole('dialog', { name: 'Edit source details', exact: true })
  await expect(english.getByLabel('Source title', { exact: true })).toHaveValue(rootTitle)
  await expect(english.getByLabel('Source URL (optional)', { exact: true })).toHaveValue(rootUrl)
  expect(await english.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const input of await english.locator('input').all()) {
    expect(
      await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16)
  }
  await page.screenshot({ path: info.outputPath('source-details-en.png'), fullPage: true })
  await page.getByLabel('Interface language').selectOption('zh-CN')
  await page.screenshot({ path: info.outputPath('source-details-zh.png'), fullPage: true })
  await dialog.getByLabel('材料标题', { exact: true }).press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '没有匹配的材料', exact: true })).toBeVisible()
  await page.getByLabel('搜索材料', { exact: true }).fill(rootTitle)
  await expect(page.locator('.source-list-title')).toHaveText([rootTitle])
  await expect(page.getByRole('heading', { name: rootTitle, exact: true })).toBeVisible()
  await expect(page.locator('.source-reader-heading a')).toHaveAttribute('href', rootUrl)
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  const root = (await read()).sources.find((s) => s.id === data.root.id)!
  const previous = before.sources.find((s) => s.id === root.id)!
  expect(root).toEqual({ ...previous, title: rootTitle, url: rootUrl, reading: root.reading })
  expect(Math.abs(root.reading!.offset - previous.reading!.offset)).toBeLessThan(200)
  expect(root.reading!.view).toBe('preview')

  await page.getByRole('button', { name: '打开摘录「开头摘录🙂」', exact: true }).click()
  await expect(page.getByRole('heading', { name: '开头摘录🙂', exact: true })).toBeVisible()
  const childTitle = 'Renamed excerpt🙂'
  const oldChild = (await read()).sources.find((s) => s.id === data.early.id)!
  expect(oldChild.url).toBe('')
  await changeSourceDetails(page, childTitle, 'https://example.org/excerpt')
  await expect(page.getByRole('heading', { name: childTitle, exact: true })).toBeVisible()
  await expect(page.locator('.source-reader-heading a')).toHaveAttribute(
    'href',
    'https://example.org/excerpt',
  )
  await changeSourceDetails(page, childTitle)
  await expect(page.locator('.source-reader-heading a')).toHaveCount(0)
  const child = (await read()).sources.find((s) => s.id === data.early.id)!
  expect(child).toEqual({ ...oldChild, title: childTitle, reading: child.reading })
  await page.getByRole('button', { name: '查看出处', exact: true }).click()
  const context = page.getByRole('dialog', { name: rootTitle, exact: true })
  await expect(context.locator('.source-original mark')).toHaveText(sourceQuote)
  await expect(context.locator('.source-url')).toHaveAttribute('href', rootUrl)
  expect(
    await context
      .locator('.source-original mark')
      .evaluate((el) => el.previousSibling?.textContent?.length),
  ).toBe(child.origin!.start)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByLabel('搜索材料', { exact: true }).fill(rootTitle)
  await expect(
    page.getByRole('button', { name: `打开摘录「${childTitle}」`, exact: true }),
  ).toBeVisible()
  await expect(page.locator('.source-excerpt-list h4').first()).toHaveText(childTitle)

  await page.getByLabel('搜索材料', { exact: true }).fill('同处副本')
  await page.getByLabel('材料类型', { exact: true }).selectOption('excerpt')
  await page.getByRole('button', { name: '阅读筛选结果', exact: true }).click()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 1 篇',
  )
  await changeSourceDetails(page, '轮次中改名🙂')
  await expect(page.getByRole('heading', { name: '轮次中改名🙂', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 1 篇',
  )
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '再读一轮', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '返回材料', exact: true }).click()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(page.locator('.source-text, .source-markdown-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await saveReading(page)
  const after = await read()
  for (const name of ['notes', 'cards', 'reviews', 'practices', 'attempts', 'media'] as const)
    expect(after[name]).toEqual(before[name])
  for (const source of after.sources) {
    const prior = before.sources.find((s) => s.id === source.id)!
    const { title: _title, url: _url, reading: _reading, ...identity } = source
    const { title: _priorTitle, url: _priorUrl, reading: _priorReading, ...priorIdentity } = prior
    expect(identity).toEqual(priorIdentity)
  }

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const bytes = await readFile((await (await downloading).path())!)
  const backup = await parseArchive(new Blob([bytes]))
  const ordered = (sources: Library['sources']) =>
    [...sources].sort((a, b) => a.id.localeCompare(b.id))
  expect(ordered(backup.library.sources)).toEqual(ordered(after.sources))
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByLabel('搜索材料', { exact: true }).fill(rootTitle)
  await changeSourceDetails(page, 'Temporary edit after backup')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page
    .getByLabel('导入备份文件')
    .setInputFiles({ name: 'details.repeaty', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByLabel('搜索材料', { exact: true }).fill(rootTitle)
  await expect(page.getByRole('heading', { name: rootTitle, exact: true })).toBeVisible()
  const restored = await read()
  for (const source of after.sources) {
    const saved = restored.sources.find((s) => s.id === source.id)!
    expect(saved).toEqual({ ...source, mediaId: saved.mediaId })
  }
  for (const name of ['cards', 'reviews', 'practices', 'attempts'] as const)
    expect(restored[name]).toEqual(before[name])
}

export async function sourceDetailsRetry(
  page: Page,
  read: () => Promise<Library>,
  fail: (enabled: boolean) => Promise<void>,
) {
  await importReading(page, 'Details retry', 'plain', readingText)
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = await read()
  await fail(true)
  await moveReading(page, 0.7)
  const dialog = await openSourceDetails(page)
  await dialog.getByLabel('材料标题', { exact: true }).fill('Retried title')
  await dialog.getByLabel('来源链接（可选）', { exact: true }).fill('https://example.org/retry')
  await dialog.getByRole('button', { name: '保存材料信息', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('材料标题', { exact: true })).toHaveValue('Retried title')
  await expect(dialog.getByLabel('来源链接（可选）', { exact: true })).toHaveValue(
    'https://example.org/retry',
  )
  expect(await read()).toEqual(before)
  await fail(false)
  await dialog.getByRole('button', { name: '保存材料信息', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Retried title', exact: true })).toBeVisible()
  const after = await read()
  const source = after.sources.find((s) => s.title === 'Retried title')!
  expect(source.id).toBe(before.sources[0]!.id)
  expect(source.reading!.offset).toBeGreaterThan(before.sources[0]!.reading!.offset)
  for (const name of ['cards', 'notes', 'reviews', 'media'] as const)
    expect(after[name]).toEqual(before[name])
}
