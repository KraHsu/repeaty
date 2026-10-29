import { selectUiValue } from './fixtures/ui-flow'
import { setInterfaceLanguage } from './fixtures/settings-flow'
import { test, expect } from './fixtures/empty-workspace'
import { storedLibrary } from './fixtures/stored-library'
import {
  createSourceDeck,
  previewSource,
  saveSource,
  selectSourceExcerpt,
  createExcerptCard,
  sourceQuote,
  sourceText,
} from './fixtures/source-flow'
import { parseArchive } from '../src/core/archive'
import type { Source } from '../src/core/source-data'
import type { Library } from '../src/core/model'
import { readFile } from 'node:fs/promises'
import { showSourceText } from './fixtures/source-controls'

test('imports a lazy source, anchors an excerpt, reviews offline and preserves source bytes through backup and deletion', async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [],
    external: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url())
  })
  await createSourceDeck(page)
  await previewSource(page)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect((await storedLibrary(page)).sources).toEqual([])
  await previewSource(page)
  await saveSource(page)
  const raw = await storedLibrary(page)
  expect(raw.sources).toHaveLength(1)
  expect(JSON.stringify(raw.sources)).not.toContain(sourceQuote)
  const source = (raw.sources as { value: Source }[])[0]!.value
  await page.getByRole('button', { name: '阅读 Markdown 预览', exact: true }).click()
  await expect(page.locator('.source-markdown-preview .katex')).toHaveCount(1)
  expect(
    await page.evaluate(() => (window as Window & { sourceExecuted?: boolean }).sourceExecuted),
  ).toBeUndefined()
  await showSourceText(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出原文', exact: true }).click()
  expect(await readFile((await (await download).path())!, 'utf8')).toBe(sourceText)
  await createExcerptCard(page)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await expect(page.locator('.card-question')).toContainText('间隔复习如何安排时间')
  await expect(page.getByRole('button', { name: /^查看原文/ })).toHaveCount(0)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText(sourceQuote)
  await page.screenshot({ path: testInfo.outputPath('source-context.png'), fullPage: true })
  await page.locator('.source-original').focus()
  await page.keyboard.press('3')
  expect((await storedLibrary(page)).reviews).toHaveLength(0)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const sourceBeforeBackup = ((await storedLibrary(page)).sources as { value: Source }[])[0]!.value
  expect(sourceBeforeBackup).toMatchObject(source)
  const backupDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const archive = await parseArchive(
    new Blob([await readFile((await (await backupDownload).path())!)]),
  )
  expect(archive.library.sources[0]).toEqual(sourceBeforeBackup)
  expect(archive.library.notes[0]!.excerpt).toMatchObject({
    sourceId: source.id,
    start: sourceText.lastIndexOf(sourceQuote),
    quote: sourceQuote,
  })
  expect(await archive.assets.find((asset) => asset.meta.id === source.mediaId)!.blob.text()).toBe(
    sourceText,
  )
  const before = await storedLibrary(page)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(sourceText)
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await selectSourceExcerpt(page)
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(
    page.getByRole('button', { name: 'Create card from excerpt', exact: true }),
  ).toBeEnabled()
  expect(
    await page.locator('.sources-page').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('sources-mobile-en.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('sources-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '删除材料', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有学习材料' })).toBeVisible()
  const after = await storedLibrary(page)
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
  expect((after.notes as { value: Library['notes'][number] }[])[0]!.value.excerpt).toBeUndefined()
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('rejects invalid files, supports pasted text and keeps an existing snapshot when the same source is imported again', async ({
  page,
}) => {
  await createSourceDeck(page)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByRole('button', { name: '导入材料', exact: true }).click()
  await page
    .getByLabel('选择材料文件')
    .setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from([255, 255]) })
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('UTF-8')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await previewSource(page)
  await saveSource(page)
  await createExcerptCard(page)
  // Selecting an excerpt scrolls the reader; let that position finish autosaving.
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'saved')
  const before = await storedLibrary(page)
  await page.getByRole('button', { name: '导入材料', exact: true }).click()
  await page.getByLabel('材料标题').fill('学习笔记')
  await selectUiValue(page.getByLabel('内容格式'), 'plain')
  await page.getByLabel('粘贴正文').fill('A new snapshot of the source.')
  const original = ((await storedLibrary(page)).sources as { value: Source }[])[0]!.value
  // A layout change can scroll the underlying reader while the dialog is open.
  // Its 700 ms autosave must not disable the form between pointer down and up.
  const reader = page.locator('.source-text')
  await expect(reader).toHaveAttribute('aria-busy', 'false')
  await reader.evaluate((element: HTMLTextAreaElement) => {
    element.scrollTop = Math.floor(element.scrollHeight / 2)
    element.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(1000)
  const whileImporting = (await storedLibrary(page)).sources as { value: Source }[]
  expect(whileImporting.find(({ value }) => value.id === original.id)!.value.reading).toEqual(
    original.reading,
  )
  await expect(page.getByRole('button', { name: '保存材料', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存材料', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(
    'A new snapshot of the source.',
  )
  const after = await storedLibrary(page)
  expect(after.sources).toHaveLength(2)
  expect(after.notes).toEqual(before.notes)
  expect(after.cards).toEqual(before.cards)
  await expect
    .poll(async () => {
      const sources = (await storedLibrary(page)).sources as { value: Source }[]
      return sources.find(({ value }) => value.id === original.id)!.value.reading?.offset
    })
    .toBeGreaterThan(0)
})
