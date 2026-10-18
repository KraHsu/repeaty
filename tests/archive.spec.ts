import { expect, test } from '@playwright/test'
import { createWriteStream, openAsBlob } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { exportArchive, parseArchive } from '../src/core/archive'
import { richLibrary } from './fixtures/rich-library'

async function digest(blob: Blob) {
  return createHash('sha256')
    .update(new Uint8Array(await blob.arrayBuffer()))
    .digest('hex')
}

test('128 MiB of image/audio and long text survive archive restore, offline review and export', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000)
  const { library, assets, front, back } = richLibrary()
  const media = new Map(assets.map((asset) => [asset.meta.id, asset.blob]))
  const archive = (await exportArchive(library, async (id) => media.get(id)))!
  expect(archive.size).toBeGreaterThan(100 * 1024 * 1024)
  const path = testInfo.outputPath('large.repeaty')
  await pipeline(
    Readable.fromWeb(archive.stream() as import('node:stream/web').ReadableStream<Uint8Array>),
    createWriteStream(path),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles(path)
  await expect(page.getByRole('dialog')).toContainText('2 张卡片', { timeout: 30_000 })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: '离线已就绪', exact: true })).toBeVisible()
  // A corrupt import must not replace the now-persisted media collection.
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'broken.repeaty',
    mimeType: 'application/zip',
    buffer: Buffer.from('broken'),
  })
  await expect(page.getByRole('alert')).toContainText('备份包损坏')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.locator('.card-row-title').first().click()
  await expect(page.getByLabel('正面 · 问题')).toHaveValue(front)
  await expect(page.getByLabel('背面 · 答案')).toHaveValue(back)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('长文本')
  await page.getByRole('button', { name: '开始专项练习' }).click()
  await expect(page.locator('.card-question')).toHaveText(front)
  const image = page.getByRole('img', { name: 'pixel.png' })
  await image.locator('..').scrollIntoViewIfNeeded()
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true)
  await expect(image).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(7)
  await expect
    .poll(() =>
      page
        .locator('audio')
        .first()
        .evaluate((el: HTMLAudioElement) => Number.isFinite(el.duration) && el.duration > 500),
    )
    .toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '显示答案' }).click()
  await expect(page.locator('.card-answer .card-content')).toHaveText(back)
  await expect(page.locator('audio')).toHaveCount(15)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const exported = await download
  expect(exported.suggestedFilename()).toMatch(/\.repeaty$/)
  const restored = await parseArchive(await openAsBlob((await exported.path())!))
  expect(restored.library.notes.map((note) => [note.front, note.back])).toEqual(
    library.notes.map((note) => [note.front, note.back]),
  )
  expect(restored.assets).toHaveLength(17)
  for (const actual of restored.assets) {
    const expected = assets.find((asset) => asset.meta.name === actual.meta.name)!
    expect(actual.blob.type).toBe(expected.blob.type)
    expect(actual.blob.size).toBe(expected.blob.size)
    expect(await digest(actual.blob)).toBe(await digest(expected.blob))
  }
})
