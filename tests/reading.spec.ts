import { test, expect } from './fixtures/empty-workspace'
import { storedLibrary } from './fixtures/stored-library'
import {
  readingFlow,
  importReading,
  moveReading,
  readingText,
  saveReading,
} from './fixtures/reading-flow'
import type { Library } from '../src/core/model'
import { readingQueueFlow, queueView } from './fixtures/reading-queue-flow'
import { emptyLibrary } from '../src/core/model'
import { addSource, prepareSource } from '../src/core/sources'
import { exportArchive } from '../src/core/archive'

async function read(page: Parameters<typeof storedLibrary>[0]) {
  const rows = await storedLibrary(page)
  return Object.fromEntries(
    Object.entries(rows).map(([store, values]) => [
      store,
      (values as { value: unknown }[]).map((row) => row.value),
    ]),
  ) as unknown as Library
}
test('reading positions survive reload, responsive layouts and backup recovery without changing study progress', async ({
  page,
}, info) => {
  await readingFlow(page, () => read(page), info)
})
test('a quota error preserves the last saved position and can retry the pending position', async ({
  page,
}) => {
  await importReading(page, 'Retry reading', 'plain', readingText)
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = await read(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { failReading: boolean }).failReading = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'sources' && (window as unknown as { failReading: boolean }).failReading)
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await moveReading(page, 0.7)
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'error')
  expect(await read(page)).toEqual(before)
  await page.evaluate(() => {
    ;(window as unknown as { failReading: boolean }).failReading = false
  })
  await page.getByRole('button', { name: '重试保存位置' }).click()
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'saved')
  expect((await read(page)).sources[0]!.reading!.offset).toBeGreaterThan(
    before.sources[0]!.reading!.offset,
  )
})

test('reading priorities order the queue and persist with positions through archive, defer, restart and backup', async ({
  page,
}, info) => {
  await readingQueueFlow(page, () => read(page), info)
})

test('a failed queue write retains its material, position and arrangement for a safe retry', async ({
  page,
}) => {
  await importReading(page, 'Queue retry', 'plain', readingText)
  await moveReading(page, 0.4)
  await saveReading(page)
  const before = await read(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { failQueue: boolean }).failQueue = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'sources' && (window as unknown as { failQueue: boolean }).failQueue)
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('存储空间不足')
  expect(await read(page)).toEqual(before)
  await expect(page.getByRole('heading', { name: 'Queue retry', exact: true })).toBeVisible()
  await page.getByLabel('阅读优先级', { exact: true }).selectOption('high')
  await expect(page.getByRole('alert')).toContainText('存储空间不足')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveValue('normal')
  expect(await read(page)).toEqual(before)
  await page.evaluate(() => ((window as unknown as { failQueue: boolean }).failQueue = false))
  await page.getByLabel('阅读优先级', { exact: true }).selectOption('high')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveValue('high')
  expect((await read(page)).sources[0]!.priority).toBe('high')
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂无待阅读材料', exact: true })).toBeVisible()
  await queueView(page, '已归档')
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  expect(
    await page.locator('.source-text').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(100)
})

test('changing priority across list pages keeps the current material and supports the keyboard', async ({
  page,
}) => {
  let library = emptyLibrary()
  const assets = new Map<string, Blob>()
  for (let index = 0; index < 21; index++) {
    const { source, asset } = prepareSource(
      {
        title: `Page ${String(index + 1).padStart(2, '0')}`,
        url: '',
        format: 'plain',
        content: readingText,
      },
      new Date(Date.now() - (21 - index) * 60_000),
    )
    library = addSource(library, source, asset)
    assets.set(asset.meta.id, asset.blob)
  }
  const archive = (await exportArchive(library, async (id) => assets.get(id)))!
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'pages.repeaty',
    mimeType: 'application/zip',
    buffer: Buffer.from(await archive.arrayBuffer()),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.locator('.source-list-title')).toHaveCount(20)
  await page.locator('.source-list-title').filter({ hasText: 'Page 01' }).click()
  await moveReading(page, 0.45)
  const priority = page.getByLabel('阅读优先级', { exact: true })
  await priority.selectOption('low')
  await expect(priority).toHaveValue('low')
  await expect(page.locator('.source-list-pages')).toContainText('2 / 2')
  await expect(page.locator('.source-list-title')).toHaveText(['Page 01'])
  await expect(page.getByRole('heading', { name: 'Page 01', exact: true })).toBeVisible()
  expect(
    await page.locator('.source-text').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(500)
  await priority.focus()
  await priority.press('Home')
  await priority.press('Tab')
  await expect(priority).toHaveValue('high')
  await expect(page.locator('.source-list-pages')).toContainText('1 / 2')
  await expect(page.locator('.source-list-title').first()).toHaveText('Page 01')
  await expect(page.locator('.source-list-title')).toHaveCount(20)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Page 01', exact: true })).toBeVisible()
  await expect(priority).toHaveValue('high')
})
