import { selectUiValue } from './fixtures/ui-flow'
import { setInterfaceLanguage } from './fixtures/settings-flow'
import { test, expect } from './fixtures/empty-workspace'
import { createImportDeck, previewAnki, confirmAnki } from './fixtures/anki-flow'
import { parseArchive } from '../src/core/archive'
import { readFile } from 'node:fs/promises'

test('modern Anki import previews, cancels, imports media, reviews offline and deduplicates after reload', async ({
  page,
  context,
}) => {
  const external: string[] = [],
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url())
  })
  await createImportDeck(page)
  await previewAnki(page)
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.getByText('导入报告', { exact: false }).click()
  await expect(page.locator('.anki-report')).toContainText('附件缺失、损坏或格式不受支持')
  await expect(page.locator('.anki-report')).toContainText('模板无法转换')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  // The worker and wasm are served from this build and precached, including on
  // a Pages subpath. Import should still work after going offline and reloading.
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await previewAnki(page)
  await confirmAnki(page)
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('What')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await selectUiValue(page.getByLabel('练习模式'), 'true')
  await page.getByRole('button', { name: '开始专项练习', exact: true }).click()
  await expect(page.locator('.card-question')).toContainText('What is 2 + 2?')
  await expect(page.locator('.card-question .katex')).toHaveCount(1)
  const image = page.getByRole('img', { name: 'pixel.png' }).first()
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBe(1)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer')).toContainText('Four. 中文')
  await expect
    .poll(() =>
      page
        .locator('audio')
        .first()
        .evaluate((el: HTMLAudioElement) => el.duration),
    )
    .toBeCloseTo(0.1, 1)
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮练习结束' })).toBeVisible()
  await page.reload()
  await previewAnki(page, 'legacy')
  await expect(page.locator('.anki-preview')).toContainText('可导入 0 条，已存在 4 条，跳过 3 条')
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled()
  const reportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载报告', exact: true }).click()
  const report = JSON.parse(await readFile((await (await reportDownload).path())!, 'utf8'))
  expect(report.duplicates).toBe(4)
  expect(report.ignoredReviewCount).toBe(1)
  expect(report.issues).toHaveLength(5)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const archive = await parseArchive(
    new Blob([await readFile((await (await downloadPromise).path())!)]),
  )
  expect(archive.library.cards).toHaveLength(6)
  expect(archive.library.reviews).toHaveLength(1)
  expect(archive.assets).toHaveLength(2)
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('legacy packages import, malformed input preserves data, and the preview fits a narrow English screen', async ({
  page,
  context,
}) => {
  await createImportDeck(page)
  // No Anki UI, parser or wasm has been opened in this context yet.
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await previewAnki(page, 'legacy')
  await confirmAnki(page)
  await page.getByRole('button', { name: '批量导入', exact: true }).click()
  await selectUiValue(page.getByLabel('导入格式'), 'anki')
  await page.getByLabel('选择 Anki 文件').setInputFiles({
    name: 'broken.apkg',
    mimeType: 'application/zip',
    buffer: Buffer.from('broken'),
  })
  await expect(page.getByRole('alert')).toContainText('Anki 文件损坏')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(6)
  await setInterfaceLanguage(page, 'en')
  await previewAnki(page)
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(page.locator('.anki-preview')).toContainText('4 already present, 3 skipped')
  await page.getByText('Import report', { exact: false }).click()
  await expect(page.locator('.anki-report')).toContainText(
    'Missing, damaged, or unsupported attachments',
  )
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  )
})
