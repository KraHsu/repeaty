import { expect, type Page, type TestInfo } from '@playwright/test'
import type { Library } from '../../src/core/model'
import { readFile } from 'node:fs/promises'
import { parseArchive } from '../../src/core/archive'
import { createSourceDeck } from './source-flow'
import {
  importReading,
  moveReading,
  readingText,
  readingMarkdown,
  saveReading,
} from './reading-flow'

export async function startRound(page: Page, title: string) {
  await page.getByRole('button', { name: '开始一轮阅读', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.locator('.source-text, .source-markdown-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
}

export async function readingRoundFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await createSourceDeck(page)
  await importReading(page, 'Round A', 'markdown', readingMarkdown)
  await page.locator('.source-text').evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 12)
    element.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('Reading round control card')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await importReading(page, 'Round B', 'plain', readingText)
  await importReading(page, 'Round C', 'plain', readingText)
  await page.getByLabel('阅读优先级', { exact: true }).selectOption('low')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveValue('low')
  await page.locator('.source-list-title').filter({ hasText: 'Round A' }).click()
  await page.getByLabel('阅读优先级', { exact: true }).selectOption('high')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveValue('high')
  await page.getByRole('button', { name: '阅读 Markdown 预览', exact: true }).click()
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = await read()

  await startRound(page, 'Round A')
  await expect(page.getByRole('region', { name: '本轮阅读' })).toContainText('第 1 篇，共 3 篇')
  // Reordering the live list must not change this round or skip its next source.
  await page.getByLabel('阅读优先级', { exact: true }).selectOption('low')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveValue('low')
  await moveReading(page, 0.6)
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Round B', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '本轮阅读' })).toContainText('第 2 篇，共 3 篇')
  const savedA = (await read()).sources.find((source) => source.title === 'Round A')!
  expect(savedA.reading!.offset).toBeGreaterThan(
    before.sources.find((source) => source.id === savedA.id)!.reading!.offset,
  )
  expect(savedA.reading!.view).toBe('preview')
  expect(savedA.queue).toBeUndefined()

  await moveReading(page, 0.45)
  await page.getByRole('button', { name: '稍后阅读', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '稍后阅读', exact: true })
  await dialog.getByRole('button', { name: /^3 天后/ }).click()
  const date = await dialog.getByLabel('下次阅读日期').inputValue()
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Round C', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '本轮阅读' })).toContainText('第 3 篇，共 3 篇')
  const savedB = (await read()).sources.find((source) => source.title === 'Round B')!
  expect(savedB.queue).toEqual({ state: 'active', availableOn: date })
  expect(savedB.reading!.offset).toBeGreaterThan(500)
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '再读一轮', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Round A', exact: true })).toBeVisible()
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  expect(
    await page.locator('.source-markdown-preview').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(500)
  await expect(page.getByRole('region', { name: '本轮阅读' })).toContainText('第 1 篇，共 1 篇')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('.source-markdown-preview').scrollIntoViewIfNeeded()
  expect(
    await page.locator('.reading-round').evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= innerHeight
    }),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('reading-round-zh.png'), fullPage: true })
  await page.getByLabel('界面语言').selectOption('en')
  await expect(page.getByRole('region', { name: 'Reading round', exact: true })).toContainText(
    'Source 1 of 1',
  )
  await page.getByRole('button', { name: 'Finish round', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Round finished', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start another round', exact: true }).click()
  await page.getByRole('button', { name: 'End round', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Reading round', exact: true })).toHaveCount(0)
  await page.getByLabel('Interface language').selectOption('zh-CN')

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  const backup = await parseArchive(new Blob([bytes]))
  const after = await read()
  const ordered = (sources: Library['sources']) =>
    [...sources].sort((a, b) => a.id.localeCompare(b.id))
  expect(ordered(backup.library.sources)).toEqual(ordered(after.sources))
  expect(after.sources.find((source) => source.title === 'Round C')!.queue!.state).toBe('archived')
  for (const store of ['notes', 'cards', 'reviews', 'practices', 'attempts'] as const)
    expect(after[store]).toEqual(before[store])
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '开始一轮阅读', exact: true })).toBeEnabled()
  expect(
    (await read()).sources.find((source) => source.id === savedA.id)!.reading!.offset,
  ).toBeGreaterThan(500)
}
