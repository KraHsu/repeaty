import { selectUiValue } from './ui-flow'
import { setInterfaceLanguage } from './settings-flow'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library } from '../../src/core/model'
import { parseArchive } from '../../src/core/archive'
import { createSourceDeck } from './source-flow'

export const readingText = Array.from(
  { length: 180 },
  (_, i) => `Paragraph ${i} 中文🙂 ${'wrapped text '.repeat(1 + (i % 9) * 7)}\n\n`,
).join('')
export const readingMarkdown = Array.from(
  { length: 80 },
  (_, i) =>
    `## Section ${i}\n\n段落 ${i} 🙂 ${'Markdown **bold** content '.repeat(5 + (i % 7))}\n\n\`\`\`ts\nconst n = ${i}\n\`\`\`\n\n$$R=e^{-t/S}$$\n\n`,
).join('')

export async function importReading(
  page: Page,
  title: string,
  format: 'plain' | 'markdown',
  text: string,
) {
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByRole('button', { name: '导入材料', exact: true }).click()
  await page.getByLabel('材料标题').fill(title)
  await selectUiValue(page.getByLabel('内容格式'), format)
  await page.getByLabel('粘贴正文').fill(text)
  await page.getByRole('button', { name: '保存材料', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.source-text')).toHaveValue(text)
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
}
export async function moveReading(page: Page, fraction: number) {
  const reader = page.locator('.source-text, .source-markdown-preview')
  await expect(reader).toHaveAttribute('aria-busy', 'false')
  await reader.evaluate((element, fraction) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction
    element.dispatchEvent(new Event('scroll'))
  }, fraction)
}
export async function saveReading(page: Page) {
  await page.getByRole('button', { name: '保存阅读位置', exact: true }).click()
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'saved')
}

export async function readingFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await createSourceDeck(page)
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('Reading control card')
  await page.getByLabel('背面 · 答案', { exact: true }).fill('Keep this card and its schedule')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await importReading(page, 'Plain reading', 'plain', readingText)
  const before = await read()
  await moveReading(page, 0.57)
  await expect
    .poll(async () => (await read()).sources[0]!.reading?.offset ?? 0)
    .toBeGreaterThan(500)
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'saved')
  const first = (await read()).sources[0]!.reading!
  const oldScroll = await page.locator('.source-text').evaluate((element) => element.scrollTop)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  const restoredScroll = await page.locator('.source-text').evaluate((element) => element.scrollTop)
  expect(Math.abs(restoredScroll - oldScroll)).toBeLessThan(60)
  await page.setViewportSize({ width: 720, height: 900 })
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await saveReading(page)
  const resized = (await read()).sources[0]!.reading!
  expect(Math.abs(resized.offset - first.offset)).toBeLessThan(200)
  await page.getByRole('button', { name: '从头阅读', exact: true }).click()
  await expect.poll(async () => (await read()).sources[0]!.reading?.offset).toBe(0)
  expect(await page.locator('.source-text').evaluate((element) => element.scrollTop)).toBe(0)

  await importReading(page, 'Markdown reading', 'markdown', readingMarkdown)
  await page.getByRole('button', { name: '阅读 Markdown 预览' }).click()
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  await moveReading(page, 0.63)
  await saveReading(page)
  const markdown = (await read()).sources.find((source) => source.title === 'Markdown reading')!
  expect(markdown.reading).toMatchObject({ view: 'preview' })
  expect(markdown.reading!.offset).toBeGreaterThan(500)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Markdown reading', exact: true })).toBeVisible()
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  await saveReading(page)
  const resumed = (await read()).sources.find((source) => source.id === markdown.id)!.reading!
  expect(resumed.offset).toBe(markdown.reading!.offset)
  expect(Math.abs(resumed.fraction - markdown.reading!.fraction)).toBeLessThan(0.003)
  const after = await read()
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
  expect(after.practices).toEqual(before.practices)
  expect(after.notes).toEqual(before.notes)
  expect(
    await page
      .locator('.sources-page')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('reading-zh.png'), fullPage: true })
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: markdown.title }).click()
  await page.getByRole('button', { name: 'Save reading position', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue reading', exact: true })).toHaveCount(2)
  await expect(page.getByRole('status').filter({ hasText: 'Reading position saved' })).toBeVisible()
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: markdown.title }).click()
  // Capture the state being exported after focus and layout changes settle.
  await saveReading(page)
  const backedUp = (await read()).sources.find((source) => source.id === markdown.id)!.reading!

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  const archive = await parseArchive(new Blob([bytes]))
  expect(archive.library.sources.find((source) => source.id === markdown.id)!.reading).toEqual(
    backedUp,
  )
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '从头阅读', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await read()).sources.find((source) => source.id === markdown.id)!.reading?.offset,
    )
    .toBe(0)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page
    .getByLabel('导入备份文件')
    .setInputFiles({ name: 'reading.repeaty', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await read()).sources.find((source) => source.id === markdown.id)!.reading).toEqual(
    backedUp,
  )
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
  expect(
    await page.locator('.source-markdown-preview').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(100)
  await page
    .locator('.source-list-item')
    .filter({ hasText: 'Plain reading' })
    .getByRole('button', { name: '继续阅读', exact: true })
    .click()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.source-text')).toBeInViewport({ ratio: 0.6 })
  await saveReading(page)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Plain reading', exact: true })).toBeVisible()
}
