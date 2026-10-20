import { test, expect } from './fixtures/empty-workspace'
import { localLibrary } from './fixtures/source-excerpt-flow'
import { readingIntervalFlow, openReadSchedule } from './fixtures/reading-interval-flow'
import { importReading, moveReading, readingText, saveReading } from './fixtures/reading-flow'
import { startRound } from './fixtures/reading-round-flow'

test('reading intervals progress independently and survive reset, restart and backup without changing cards', async ({
  page,
}, info) => {
  await readingIntervalFlow(page, () => localLibrary(page), info)
})

test('a quota failure retains the interval confirmation and round for a single successful retry', async ({
  page,
}) => {
  await importReading(page, 'Interval A', 'plain', readingText)
  await importReading(page, 'Interval B', 'plain', readingText)
  await startRound(page, 'Interval A')
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = await localLibrary(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { failInterval: boolean }).failInterval = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'sources' && (window as unknown as { failInterval: boolean }).failInterval)
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await moveReading(page, 0.7)
  const dialog = await openReadSchedule(page, 1)
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('存储空间不足')
  expect(await localLibrary(page)).toEqual(before)
  await expect(dialog.locator('[aria-current="step"]')).toHaveText('1天')
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 2 篇',
  )
  await page.evaluate(() => ((window as unknown as { failInterval: boolean }).failInterval = false))
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Interval B', exact: true })).toBeVisible()
  const saved = (await localLibrary(page)).sources.find((source) => source.title === 'Interval A')!
  expect(saved.readingIntervalDays).toBe(1)
  expect(saved.reading!.offset).toBeGreaterThan(
    before.sources.find((source) => source.id === saved.id)!.reading!.offset,
  )
})
