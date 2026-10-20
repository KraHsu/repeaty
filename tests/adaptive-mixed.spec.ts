import { test, expect } from './fixtures/empty-workspace'
import {
  adaptiveFlow,
  mixedFlow,
  readBrowserLibrary,
  seedMixedCards,
  startMixed,
  adaptiveDialog,
} from './fixtures/adaptive-mixed-flow'
import { importReading, readingText } from './fixtures/reading-flow'
test('adaptive reading persists feedback, undo and backups across restart', async ({
  page,
}, info) => {
  await adaptiveFlow(page, () => readBrowserLibrary(page), info)
})
test('a failed adaptive save keeps the mixed item and retries without duplicating feedback', async ({
  page,
}) => {
  await seedMixedCards(page)
  await importReading(page, 'Mixed retry', 'plain', readingText)
  await startMixed(page)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^简单/ }).click()
  const dialog = await adaptiveDialog(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { failMixed: boolean }).failMixed = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'sources' && (window as unknown as { failMixed: boolean }).failMixed)
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('存储空间不足')
  await expect(page.getByRole('region', { name: '混合学习', exact: true })).toContainText(
    '已复习 1 次 · 已处理 0 篇',
  )
  expect((await readBrowserLibrary(page)).sources[0]!.adaptiveReading).toBeUndefined()
  await page.evaluate(() => {
    ;(window as unknown as { failMixed: boolean }).failMixed = false
  })
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.mixed-session .flashcard')).toBeVisible()
  expect((await readBrowserLibrary(page)).sources[0]!.adaptiveReading?.readCount).toBe(1)
})
test('mixed study interleaves reading and FSRS with independent undo and restart', async ({
  page,
}, info) => {
  await mixedFlow(page, () => readBrowserLibrary(page), info)
})
