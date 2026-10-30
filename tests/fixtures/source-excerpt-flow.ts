import { selectUiValue } from './ui-flow'
import { setResponsiveViewport } from './viewport-flow'
import { setInterfaceLanguage } from './settings-flow'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library } from '../../src/core/model'
import { parseArchive } from '../../src/core/archive'
import { storedLibrary } from './stored-library'
import { createSourceDeck, previewSource, saveSource, sourceQuote, sourceText } from './source-flow'
import { importReading, readingText } from './reading-flow'
import { startRound } from './reading-round-flow'
import { showSourceText } from './source-controls'

export async function localLibrary(page: Page) {
  const rows = await storedLibrary(page)
  return Object.fromEntries(
    Object.entries(rows).map(([store, rows]) => [
      store,
      (rows as { value: unknown }[]).map((row) => row.value),
    ]),
  ) as unknown as Library
}
export async function selectForExcerpt(
  page: Page,
  start = sourceText.lastIndexOf(sourceQuote),
  end = start + sourceQuote.length,
) {
  await showSourceText(page)
  await page.locator('.source-text').evaluate(
    (element: HTMLTextAreaElement, { start, end }) => {
      element.focus()
      element.setSelectionRange(start, end)
      element.dispatchEvent(new Event('select', { bubbles: true }))
    },
    { start, end },
  )
  await expect(page.getByRole('button', { name: /^(保存为摘录|Save as excerpt)$/ })).toBeEnabled()
}
export async function saveIndependentExcerpt(page: Page, title: string) {
  await page.getByRole('button', { name: '保存为摘录', exact: true }).click()
  await page.getByLabel('摘录标题', { exact: true }).fill(title)
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await showSourceText(page)
}
async function checkRootHighlight(page: Page) {
  const mark = page.locator('.source-original mark')
  await expect(mark).toHaveText(sourceQuote)
  expect(await mark.evaluate((element) => element.previousSibling?.textContent?.length)).toBe(
    sourceText.lastIndexOf(sourceQuote),
  )
}
export async function sourceExcerptFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await previewSource(page)
  await saveSource(page)
  await selectForExcerpt(page)
  await expect(page.getByRole('button', { name: '用摘录制卡', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '保存为摘录', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '保存为摘录', exact: true })
  await expect(dialog.getByLabel('选中的原文')).toHaveValue(sourceQuote)
  await expect(dialog.getByLabel('选中的原文')).toHaveAttribute('readonly', '')
  await dialog.getByLabel('摘录标题').fill('独立摘录🙂')
  await setResponsiveViewport(page, 390, 844)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(
    await dialog
      .getByLabel('摘录标题')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: info.outputPath('excerpt-save-zh.png'), fullPage: true })
  // Submit by keyboard; saving an excerpt needs no card group.
  await dialog.getByLabel('摘录标题').press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '独立摘录🙂', exact: true })).toBeVisible()
  await showSourceText(page)
  await expect(page.locator('.source-text')).toHaveValue(sourceQuote)
  await expect(page.getByRole('button', { name: '保存为摘录', exact: true })).toBeDisabled()
  const first = await read()
  const root = first.sources.find((source) => !source.kind)!,
    child = first.sources.find((source) => source.kind === 'excerpt')!
  expect(first.decks).toEqual([])
  expect(first.cards).toEqual([])
  expect(child.origin).toEqual({
    sourceId: root.id,
    mediaId: root.mediaId,
    start: sourceText.lastIndexOf(sourceQuote),
    end: sourceText.lastIndexOf(sourceQuote) + sourceQuote.length,
  })
  await page.getByRole('button', { name: '查看出处', exact: true }).click()
  await checkRootHighlight(page)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: child.title }).click()
  await expect(
    page.getByRole('button', { name: 'Make a card from this excerpt', exact: true }),
  ).toBeDisabled()
  await expect(page.getByRole('button', { name: 'View original', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('excerpt-reader-en.png'), fullPage: true })
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: child.title }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await selectUiValue(page.getByLabel('学习优先级', { exact: true }), '1')
  await expect(page.getByLabel('学习优先级', { exact: true })).toHaveAttribute('value', '1')
  expect((await read()).sources.find((source) => source.id === root.id)!.priority).toBeUndefined()
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: child.title }).click()
  await showSourceText(page)
  await expect(page.locator('.source-text')).toHaveValue(sourceQuote)
  await expect(page.getByLabel('学习优先级', { exact: true })).toHaveAttribute('value', '1')

  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await createSourceDeck(page)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: child.title }).click()
  await page.getByRole('button', { name: '用此摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('独立摘录如何保留出处？')
  await expect(page.getByLabel('背面 · 答案', { exact: true })).toHaveValue(sourceQuote)
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.getByRole('dialog', { name: child.title, exact: true })).toBeVisible()
  await expect(page.locator('.source-original mark')).toHaveText(sourceQuote)
  await page.getByRole('button', { name: '查看出处', exact: true }).click()
  await checkRootHighlight(page)
  await page.getByRole('button', { name: '返回摘录', exact: true }).click()
  await expect(page.locator('.source-original mark')).toHaveText(sourceQuote)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: child.title }).click()
  const partial = '记忆状态',
    partialStart = sourceQuote.indexOf(partial)
  await showSourceText(page)
  await page.locator('.source-text').evaluate((element: HTMLTextAreaElement, start) => {
    element.focus()
    element.setSelectionRange(start, start + 4)
    element.dispatchEvent(new Event('select', { bubbles: true }))
  }, partialStart)
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await selectUiValue(page.getByLabel('笔记类型', { exact: true }), 'cloze')
  await page
    .getByLabel('正面 · 问题', { exact: true })
    .fill('间隔复习会根据{{c1::记忆状态}}安排下一次学习。🙂')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.cloze-answer')).toHaveText(partial)
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText(partial)
  await page.getByRole('button', { name: '查看出处', exact: true }).click()
  const partialMark = page.locator('.source-original mark')
  await expect(partialMark).toHaveText(partial)
  expect(
    await partialMark.evaluate((element) => element.previousSibling?.textContent?.length),
  ).toBe(sourceText.lastIndexOf(sourceQuote) + partialStart)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  const cards = await read()
  expect(cards.notes).toHaveLength(2)
  expect(cards.notes.every((note) => note.excerpt?.sourceId === child.id)).toBe(true)
  expect(cards.notes.find((note) => note.type === 'cloze')).toBeDefined()
  expect(cards.reviews).toHaveLength(2)

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const bytes = await readFile((await (await downloading).path())!)
  const backup = await parseArchive(new Blob([bytes]))
  expect(backup.library.sources.find((source) => source.id === child.id)!.origin).toEqual(
    child.origin,
  )
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: root.title }).click()
  await page.getByRole('button', { name: '删除材料', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('由此保存的摘录仍保留')
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await showSourceText(page)
  await expect(page.locator('.source-text')).toHaveValue(sourceQuote)
  await expect(page.getByText('原文已删除，摘录内容仍保留。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存为摘录', exact: true })).toBeDisabled()
  const detached = await read()
  expect(detached.sources).toHaveLength(1)
  expect(detached.sources[0]!.kind).toBe('excerpt')
  expect(detached.sources[0]!.origin).toBeUndefined()
  expect(detached.notes).toEqual(cards.notes)
  expect(detached.cards).toEqual(cards.cards)
  expect(detached.reviews).toEqual(cards.reviews)
  await page.getByRole('button', { name: '删除材料', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有学习材料' })).toBeVisible()
  const removed = await read()
  expect(removed.notes.every((note) => !note.excerpt)).toBe(true)
  expect(removed.cards).toEqual(cards.cards)
  expect(removed.reviews).toEqual(cards.reviews)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page
    .getByLabel('导入备份文件')
    .setInputFiles({ name: 'excerpts.repeaty', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const restored = await read()
  expect(restored.sources.find((source) => source.id === child.id)!.origin).toEqual({
    ...child.origin,
    mediaId: restored.sources.find((source) => source.id === root.id)!.mediaId,
  })
  expect(restored.sources.find((source) => source.id === child.id)!.mediaId).not.toBe(child.mediaId)
  expect(restored.cards).toEqual(cards.cards)
  expect(restored.reviews).toEqual(cards.reviews)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: child.title }).click()
  await showSourceText(page)
  await expect(page.locator('.source-text')).toHaveValue(sourceQuote)
  await page.getByRole('button', { name: '查看出处', exact: true }).click()
  await checkRootHighlight(page)
}

export async function excerptDuringRound(page: Page, read: () => Promise<Library>) {
  await importReading(page, 'Round root', 'plain', readingText)
  await startRound(page, 'Round root')
  await selectForExcerpt(page, 0, 4000)
  await saveIndependentExcerpt(page, 'Next round excerpt')
  await expect(page.getByRole('heading', { name: 'Round root', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 1 篇',
  )
  expect((await read()).sources).toHaveLength(2)
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '再读一轮', exact: true }).click()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 2 篇',
  )
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Next round excerpt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '稍后阅读', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^1 周后/ })
    .click()
  const date = await page.getByLabel('下次阅读日期').inputValue()
  expect((await read()).sources.find((source) => source.kind === 'excerpt')!.queue).toBeUndefined()
  await page.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()
  const library = await read()
  expect(library.sources.find((source) => source.kind === 'excerpt')!.queue).toEqual({
    state: 'active',
    availableOn: date,
  })
  expect(library.sources.find((source) => !source.kind)!.queue).toBeUndefined()
  expect(library.cards).toEqual([])
}
