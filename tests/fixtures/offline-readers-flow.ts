import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fixture } from '../../src/core/test-fixtures'
import { archive, epubFiles } from '../../plugins/document-reader/test/fixtures'
import { confirmPluginAction, openPluginManager, selectPlugin } from './settings-flow'
import {
  openCollection,
  previewCollection,
  commitCollection,
  selectCollectionImporter,
} from './collection-controls'
import { localLibrary } from './source-excerpt-flow'

const nav = (page: Page, name: string) =>
  page.locator('.main-nav').getByRole('button', { name, exact: true })
async function prepare(page: Page, plugin: string) {
  page.setDefaultTimeout(15000)
  await page.goto('./')
  const library = fixture()
  library.notes = []
  library.cards = []
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'empty.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await openPluginManager(page)
  await page
    .locator('.plugin-actions input[type=file]')
    .setInputFiles(`plugins/packages/${plugin}.repeaty-plugin`)
  await confirmPluginAction(page)
}
async function importFile(
  page: Page,
  importer: string,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  await nav(page, '学习材料').click()
  const dialog = await openCollection(page)
  await dialog.getByTestId('collection-files').setInputFiles({ name, mimeType, buffer })
  await selectCollectionImporter(dialog, importer)
  await previewCollection(dialog)
  await expect(dialog.getByRole('button', { name: '保存到阅读材料', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await commitCollection(dialog)
  // Automatic format recognition must still select the intended independently installed reader.
  expect(
    (await localLibrary(page)).sources.some((source) =>
      `${source.document?.providerId}:${source.document?.readerId}`.startsWith(
        importer.split(':')[0] + ':',
      ),
    ),
  ).toBe(true)
}
async function originalEquals(page: Page, buffer: Buffer) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出原件', exact: true }).click()
  const file = await download
  expect(await readFile((await file.path())!)).toEqual(buffer)
}
async function openLibrarySearchHit(page: Page, phrase: string, sourceTitle: string) {
  const search = page.getByRole('region', { name: '材料全文搜索', exact: true })
  await search.getByRole('textbox', { name: '材料全文搜索', exact: true }).fill(`"${phrase}"`)
  await search.getByRole('button', { name: '搜索', exact: true }).click()
  const hit = search
    .getByRole('list', { name: '材料搜索结果', exact: true })
    .getByRole('button')
    .filter({ has: page.locator('span').filter({ hasText: sourceTitle }) })
  await expect(hit).toHaveCount(1)
  await expect(hit).toContainText(phrase)
  await hit.click()
}

export async function pdfReaderFlow(page: Page) {
  await prepare(page, 'pdf-reader')
  const bytes = await readFile('plugins/pdf-reader/test/fixtures/two-column-rotated.pdf')
  await importFile(page, 'pdf-reader:pdf', 'two-column-rotated.pdf', 'application/pdf', bytes)
  await page.locator('.source-list-title').filter({ hasText: 'two-column-rotated' }).click()
  await expect(page.locator('[data-pdf-page="0"] [data-pdf-start]').first()).toBeVisible({
    timeout: 30000,
  })
  await expect(page.locator('[data-pdf-page="1"] [data-pdf-start]').first()).toBeAttached({
    timeout: 30000,
  })
  // Both pages and columns intentionally repeat this text. Search must locate its exact first range.
  const searched = await page.locator('[data-pdf-scroll]').evaluate((element) => {
    const phrase = '复的选'
    const span = [
      ...element.querySelectorAll<HTMLElement>('[data-pdf-page="0"] [data-pdf-start]'),
    ].find((item) => item.textContent?.includes(phrase))!
    return {
      phrase,
      start: Number(span.dataset.pdfStart) + span.textContent!.indexOf(phrase),
      length: phrase.length,
    }
  })
  await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).press('Enter')
  await expect(page.getByRole('spinbutton', { name: 'PDF 页码', exact: true })).toHaveValue('2')
  await expect
    .poll(() => page.locator('[data-pdf-scroll]').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  await openLibrarySearchHit(page, searched.phrase, 'two-column-rotated')
  await expect(page.getByRole('spinbutton', { name: 'PDF 页码', exact: true })).toHaveValue('1')
  await expect(page.locator('[data-pdf-page="0"] [data-pdf-location]').first()).toBeVisible()
  await expect(page.locator('[data-pdf-page="1"] [data-pdf-location]')).toHaveCount(0)
  await expect
    .poll(() =>
      page.locator('[data-pdf-page="0"]').evaluate((element, selected) => {
        const span = [...element.querySelectorAll<HTMLElement>('[data-pdf-start]')].find(
          (item) =>
            Number(item.dataset.pdfStart) <= selected.start &&
            Number(item.dataset.pdfEnd) >= selected.start + selected.length,
        )!
        const range = document.createRange()
        range.setStart(span.firstChild!, selected.start - Number(span.dataset.pdfStart))
        range.setEnd(
          span.firstChild!,
          selected.start - Number(span.dataset.pdfStart) + selected.length,
        )
        const expected = [...range.getClientRects()].filter((rect) => rect.width && rect.height)
        const actual = [...element.querySelectorAll('[data-pdf-location]')].map((item) =>
          item.getBoundingClientRect(),
        )
        const viewport = element.closest('[data-pdf-scroll]')!.getBoundingClientRect()
        return (
          actual.length === expected.length &&
          actual.length > 0 &&
          actual.every((rect, index) => {
            const target = expected[index]!
            return (
              Math.abs(rect.x - target.x) < 1 &&
              Math.abs(rect.y - target.y) < 1 &&
              Math.abs(rect.width - target.width) < 1 &&
              Math.abs(rect.height - target.height) < 1 &&
              rect.top >= viewport.top &&
              rect.top < viewport.bottom &&
              rect.right > viewport.left &&
              rect.left < viewport.right
            )
          })
        )
      }, searched),
    )
    .toBe(true)
  await page.locator('[data-pdf-scroll]').evaluate((element) => {
    const first = element.querySelector('[data-pdf-page="0"] [data-pdf-start]')!
    const second = element.querySelector('[data-pdf-page="1"] [data-pdf-start]')!
    const range = document.createRange()
    range.setStart(first.firstChild!, 1)
    range.setEnd(second.firstChild!, second.textContent!.length)
    const selection = getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('多页 PDF 选区')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  const saved = await localLibrary(page)
  const locator = saved.notes[0]!.excerpt!.locator!
  expect(locator.kind).toBe('pdf')
  if (locator.kind !== 'pdf') throw Error('PDF locator missing')
  expect(new Set(locator.regions.map((region) => region.page)).size).toBe(2)
  await nav(page, '学习概览').click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-context .pdf-page-highlights i').first()).toBeVisible({
    timeout: 30000,
  })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.reload()
  await nav(page, '学习材料').click()
  await page.locator('.source-list-title').filter({ hasText: 'two-column-rotated' }).click()
  await originalEquals(page, bytes)
  await openPluginManager(page)
  await selectPlugin(page, 'pdf-reader')
  await page
    .locator('.plugin-settings[data-plugin-id="pdf-reader"]')
    .getByRole('switch', { name: '启用 PDF 阅读器', exact: true })
    .click()
  await nav(page, '学习材料').click()
  await page.locator('.source-list-title').filter({ hasText: 'two-column-rotated' }).click()
  await expect(page.getByRole('button', { name: '导出原件', exact: true })).toBeVisible()
  expect((await localLibrary(page)).reviews).toHaveLength(1)
  expect((await localLibrary(page)).notes[0]!.excerpt!.locator).toEqual(locator)
}

export async function documentReaderFlow(page: Page) {
  await prepare(page, 'document-reader')
  const files = epubFiles()
  files['OPS/chapter1.xhtml'] = String(files['OPS/chapter1.xhtml']).replace(
    '</body>',
    `${Array.from({ length: 45 }, (_, index) => `<p>第 ${index + 1} 段：保留独立的阅读位置，滚动与撤销不应重新构建章节。</p>`).join('')}</body>`,
  )
  const bytes = Buffer.from(await archive(files))
  await importFile(
    page,
    'document-reader:epub-sequential',
    '绿色阅读书.epub',
    'application/epub+zip',
    bytes,
  )
  await page.locator('.source-list-title').filter({ hasText: '绿色阅读书' }).click()
  await page.getByRole('button', { name: '开始阅读', exact: true }).click()
  await expect(page.locator('.document-prose')).toContainText('中文强调😀重复文本。重复文本。')
  await expect
    .poll(() =>
      page
        .locator('.document-prose img')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true)
  const viewport = page.locator('.document-viewport')
  await viewport.evaluate((element) => {
    element.setAttribute('data-preserved-reader', 'yes')
    element.scrollTop = 600
  })
  await expect
    .poll(async () =>
      (await localLibrary(page)).sources.some(
        (source) => source.reading && source.reading.offset > 0,
      ),
    )
    .toBe(true)
  await expect(viewport).toHaveAttribute('data-preserved-reader', 'yes')
  await page.getByRole('button', { name: '从头阅读', exact: true }).click()
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(viewport).toHaveAttribute('data-preserved-reader', 'yes')
  await page
    .getByRole('navigation', { name: '书籍目录' })
    .getByRole('button', { name: '第二章 · 回答', exact: true })
    .click()
  await expect(page.locator('.document-reader')).toContainText('完成前一章后')
  await expect(page.getByRole('button', { name: '完成本章', exact: true })).toBeDisabled()
  await openLibrarySearchHit(page, '第 30 段：保留独立的阅读位置', '第一章')
  await expect(
    page
      .getByRole('navigation', { name: '书籍目录' })
      .getByRole('button', { name: '第一章 · 学习', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.document-prose')).toContainText('第 30 段：保留独立的阅读位置')
  await expect
    .poll(() =>
      page.locator('.document-viewport').evaluate((element) => {
        const target = [...element.querySelectorAll<HTMLElement>('[data-doc-start]')].find((item) =>
          item.textContent?.startsWith('第 30 段：'),
        )
        if (!target) return false
        const outer = element.getBoundingClientRect(),
          bounds = target.getBoundingClientRect()
        return element.scrollTop > 0 && bounds.top >= outer.top && bounds.top <= outer.top + 40
      }),
    )
    .toBe(true)
  await page
    .getByRole('navigation', { name: '书籍目录' })
    .getByRole('button', { name: '第一章 · 学习', exact: true })
    .click()
  await page.getByRole('button', { name: '完成本章', exact: true }).click()
  await expect(page.getByRole('button', { name: '本章已完成', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByRole('button', { name: '完成本章', exact: true })).toBeEnabled()
  await expect
    .poll(
      async () =>
        (await localLibrary(page)).sources.filter((source) => source.studySequence?.completed)
          .length,
    )
    .toBe(0)
  await page.getByRole('button', { name: '完成本章', exact: true }).click()
  await expect(page.getByRole('button', { name: '本章已完成', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '下一章', exact: true }).click()
  await expect(page.getByRole('button', { name: '完成本章', exact: true })).toBeEnabled()
  await originalEquals(page, bytes)
  await page.reload()
  const stored = await localLibrary(page)
  expect(stored.sources.filter((source) => source.studySequence?.completed)).toHaveLength(1)
  expect(stored.sources.filter((source) => source.document?.resources?.length)).toHaveLength(2)
  const html = Buffer.from(
    '<!doctype html><title>离线 HTML</title><h1>一段材料</h1><p>安全的<strong>本地正文</strong>。</p><script>window.p4Unsafe=true</script><img src="https://example.invalid/tracker.png">',
  )
  const external: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url())
  })
  await importFile(page, 'document-reader:html', 'offline.html', 'text/html', html)
  await page.locator('.source-list-title').filter({ hasText: '离线 HTML' }).click()
  await expect(page.locator('.document-prose')).toContainText('安全的本地正文。')
  expect(
    await page.evaluate(() => (window as Window & { p4Unsafe?: boolean }).p4Unsafe),
  ).toBeUndefined()
  expect(external).toEqual([])
  await originalEquals(page, html)
}
