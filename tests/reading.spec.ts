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

test('reading queues retain positions and study records through archive, defer, restart, backup and the scheduled date', async ({
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
  await page.evaluate(() => ((window as unknown as { failQueue: boolean }).failQueue = false))
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂无待阅读材料', exact: true })).toBeVisible()
  await queueView(page, '已归档')
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  expect(
    await page.locator('.source-text').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(100)
})
