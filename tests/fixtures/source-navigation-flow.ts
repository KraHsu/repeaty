import { setResponsiveViewport } from './viewport-flow'
import { setInterfaceLanguage } from './settings-flow'
import { notesAfterSourceRekey } from './source-flow'
import { expect, type Page, type TestInfo, type Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library, MediaUpload } from '../../src/core/model'
import { saveNote } from '../../src/core/model'
import { fixture, input, now } from '../../src/core/test-fixtures'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  sourceExcerpt,
} from '../../src/core/sources'
import { exportArchive } from '../../src/core/archive'
import { reviewCard } from '../../src/core/scheduler'
import { sourceQuote, sourceText } from './source-flow'
import { selectForExcerpt } from './source-excerpt-flow'
import { saveReading } from './reading-flow'

export function navigationFixture() {
  const root = prepareSource(
    { title: '导航原文', url: '', format: 'markdown', content: sourceText },
    now,
  )
  root.source.priority = 'high'
  let library = addSource(fixture(), root.source, root.asset)
  const assets: MediaUpload[] = [root.asset]
  const add = (start: number, end: number, title: string, index: number) => {
    const prepared = prepareSourceExcerpt(
      root.source,
      sourceText,
      sourceExcerpt(root.source, sourceText, start, end),
      title,
      new Date(now.getTime() + index * 1000),
    )
    library = addSource(library, prepared.source, prepared.asset)
    assets.push(prepared.asset)
    return prepared.source
  }
  const firstStart = sourceText.indexOf(sourceQuote)
  const early = add(firstStart, firstStart + sourceQuote.length, '开头摘录🙂', 1)
  early.queue = { state: 'archived', availableOn: '2026-10-17' }
  let cursor = sourceText.indexOf('上下文')
  for (let i = 1; i <= 4; i++) {
    add(cursor, cursor + (i === 4 ? 4000 : 10), `段落 ${i}`, i + 1)
    cursor = sourceText.indexOf('上下文', cursor + 1)
  }
  const start = sourceText.lastIndexOf(sourceQuote)
  const late = add(start, start + sourceQuote.length, '末尾摘录🙂', 6)
  late.queue = { state: 'active', availableOn: '2099-12-31' }
  const duplicate = add(start, start + sourceQuote.length, '同处副本🙂', 7)
  const script = sourceText.indexOf('<script>')
  add(script, sourceText.length, '脚本文字', 8)
  const other = prepareSource(
    { title: '另一篇原文', url: '', format: 'markdown', content: sourceText },
    now,
  )
  const otherChild = prepareSourceExcerpt(
    other.source,
    sourceText,
    sourceExcerpt(other.source, sourceText, start, start + sourceQuote.length),
    '其他原文的摘录',
    now,
  )
  library = addSource(
    addSource(library, other.source, other.asset),
    otherChild.source,
    otherChild.asset,
  )
  assets.push(other.asset, otherChild.asset)
  const quote = (source: typeof early) => sourceExcerpt(source, sourceQuote, 0, sourceQuote.length)
  library = saveNote(
    library,
    {
      ...input,
      excerpt: sourceExcerpt(root.source, sourceText, firstStart, firstStart + sourceQuote.length),
    },
    library.notes[0]!.id,
  )
  library = saveNote(library, {
    ...input,
    type: 'cloze',
    front: '{{c1::记忆状态}}与{{c2::时间}}',
    excerpt: quote(early),
  })
  library = saveNote(library, {
    ...input,
    type: 'reversed',
    front: 'Forward',
    back: 'Reverse',
    excerpt: quote(late),
  })
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  return { library, assets, root: root.source, early, late, duplicate }
}
export async function restoreNavigation(page: Page) {
  const data = navigationFixture()
  const archive = (await exportArchive(
    data.library,
    async (id) => data.assets.find((asset) => asset.meta.id === id)?.blob,
  ))!
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'navigation.repeaty',
    mimeType: 'application/zip',
    buffer: Buffer.from(await archive.arrayBuffer()),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  return data
}
function excerptRow(page: Page, title: string): Locator {
  return page
    .locator('.source-excerpt-list li')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}
export async function navigationFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  const data = await restoreNavigation(page)
  const before = await read()
  const list = page.getByRole('region', { name: '本篇摘录', exact: true })
  await expect(list.getByRole('heading', { name: '本篇摘录（8）', exact: true })).toBeVisible()
  await expect(list.locator('h4')).toHaveText([
    '开头摘录🙂',
    '段落 1',
    '段落 2',
    '段落 3',
    '段落 4',
  ])
  await expect(excerptRow(page, '开头摘录🙂')).toContainText('2 张关联卡片')
  await expect(excerptRow(page, '开头摘录🙂')).toContainText('已归档')
  await expect(list).not.toContainText('其他原文的摘录')
  // A selection taller than the viewport must retain its start, not scroll to the end.
  const long = data.library.sources.find((source) => source.title === '段落 4')!
  await excerptRow(page, '段落 4')
    .getByRole('button', { name: '定位「段落 4」的原文', exact: true })
    .click()
  expect(
    await page
      .locator('.source-text')
      .evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]),
  ).toEqual([long.origin!.start, long.origin!.end])
  await saveReading(page)
  const position = (await read()).sources.find((source) => source.id === data.root.id)!.reading!
  expect(position.offset).toBeLessThanOrEqual(long.origin!.start)
  expect(position.offset).toBeGreaterThanOrEqual(Math.max(0, long.origin!.start - 150))
  await selectForExcerpt(page)
  await expect(page.locator('.source-duplicate')).toContainText('这段原文已有 2 份摘录。')
  await page.getByRole('button', { name: '查看已有摘录', exact: true }).click()
  await expect(list.getByRole('heading', { level: 3 })).toBeFocused()
  await expect(list.locator('h4')).toHaveText(['末尾摘录🙂', '同处副本🙂', '脚本文字'])
  await expect(list.locator('li.matched')).toHaveCount(2)
  await expect(excerptRow(page, '末尾摘录🙂')).toContainText('2 张关联卡片')
  await expect(excerptRow(page, '末尾摘录🙂')).toContainText('稍后阅读')
  await expect(excerptRow(page, '脚本文字').locator('.source-excerpt-preview')).toHaveText(
    '<script>globalThis.sourceExecuted=true</script>',
  )
  expect(
    await page.evaluate(() => (window as unknown as { sourceExecuted?: boolean }).sourceExecuted),
  ).toBeUndefined()
  await page.getByRole('button', { name: '阅读 Markdown 预览', exact: true }).click()
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  const locate = excerptRow(page, '末尾摘录🙂').getByRole('button', {
    name: '定位「末尾摘录🙂」的原文',
    exact: true,
  })
  // Preview restores its reading position asynchronously and temporarily disables
  // navigation. Keyboard actions, unlike click(), do not wait for enablement.
  await expect(locate).toBeEnabled()
  await locate.focus()
  await expect(locate).toBeFocused()
  await locate.press('Enter')
  const reader = page.locator('.source-text')
  await expect(reader).toHaveAttribute('aria-busy', 'false')
  await expect(reader).toBeFocused()
  expect(
    await reader.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([
    sourceText.lastIndexOf(sourceQuote),
    sourceText.lastIndexOf(sourceQuote) + sourceQuote.length,
  ])
  expect(await reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000)
  await saveReading(page)
  // Opening an excerpt outside the ready queue must keep its schedule and make it visible.
  await excerptRow(page, '末尾摘录🙂')
    .getByRole('button', { name: '打开摘录「末尾摘录🙂」', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '末尾摘录🙂', exact: true })).toBeVisible()
  await expect(reader).toHaveValue(sourceQuote)
  await expect(
    page
      .getByRole('navigation', { name: '阅读队列', exact: true })
      .getByRole('button', { name: /^全部材料/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect((await read()).sources.find((source) => source.id === data.late.id)!.queue).toEqual(
    data.late.queue,
  )
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await expect(reader).toHaveAttribute('aria-busy', 'false')
  await selectForExcerpt(page)
  await page.getByRole('button', { name: '查看已有摘录', exact: true }).click()
  await setResponsiveViewport(page, 390, 844)
  await expect(list.locator('li.matched')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    await list
      .locator('h4')
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16)
  await list.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('source-excerpts-zh.png'), fullPage: true })
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await selectForExcerpt(page)
  await page.getByRole('button', { name: 'Show saved excerpts', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Excerpts from this source (8)', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.source-duplicate')).toContainText(
    'Existing excerpts for this selection: 2.',
  )
  await expect(page.locator('.source-excerpt-pages')).toContainText('Page 2 of 2')
  await page.screenshot({ path: info.outputPath('source-excerpts-en.png'), fullPage: true })
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await selectForExcerpt(page)
  await page.getByRole('button', { name: '查看已有摘录', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: '开始一轮阅读', exact: true }).click()
  const round = page.getByRole('region', { name: '本轮阅读', exact: true })
  const counter = await round.textContent()
  await page
    .getByRole('navigation', { name: '本篇摘录分页' })
    .getByRole('button', { name: '上一页', exact: true })
    .click()
  await excerptRow(page, '开头摘录🙂')
    .getByRole('button', { name: '打开摘录「开头摘录🙂」', exact: true })
    .click()
  const modal = page.getByRole('dialog', { name: '开头摘录🙂', exact: true })
  await expect(modal.locator('.source-original mark')).toHaveText(sourceQuote)
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.source-reader h2')).toHaveText('导航原文')
  expect(await round.textContent()).toBe(counter)
  await page.getByRole('button', { name: '结束本轮', exact: true }).click()
  const recovered = await read()
  for (const store of ['notes', 'cards', 'reviews', 'practices', 'attempts'] as const)
    expect(recovered[store]).toEqual(
      store === 'notes' ? notesAfterSourceRekey(before, recovered) : before[store],
    )

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const bytes = await readFile((await (await downloading).path())!)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await excerptRow(page, '开头摘录🙂')
    .getByRole('button', { name: '打开摘录「开头摘录🙂」', exact: true })
    .click()
  await page.getByRole('button', { name: '删除材料', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await expect(list.getByRole('heading', { name: '本篇摘录（7）', exact: true })).toBeVisible()
  await expect(list).not.toContainText('开头摘录🙂')
  expect((await read()).cards).toEqual(before.cards)
  expect((await read()).reviews).toEqual(before.reviews)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'navigation-restored.repeaty',
    mimeType: 'application/zip',
    buffer: bytes,
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await expect(list.getByRole('heading', { name: '本篇摘录（8）', exact: true })).toBeVisible()
  await expect(excerptRow(page, '开头摘录🙂')).toContainText('2 张关联卡片')
  const restoredBackup = await read()
  for (const store of ['notes', 'cards', 'reviews', 'practices', 'attempts'] as const)
    expect(restoredBackup[store]).toEqual(
      store === 'notes' ? notesAfterSourceRekey(before, restoredBackup) : before[store],
    )
}
