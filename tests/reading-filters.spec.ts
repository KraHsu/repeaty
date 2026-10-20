import { test } from './fixtures/empty-workspace'
import { localLibrary } from './fixtures/source-excerpt-flow'
import { readingFilterFlow, filteredRoundRetry } from './fixtures/reading-filter-flow'

test('filters originals and excerpts across pages, scopes finite rounds and preserves learning records', async ({
  page,
}, info) => {
  await readingFilterFlow(page, () => localLibrary(page), info)
})

test('a quota failure keeps the selected filters and current material until a round can start', async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (
        this.name === 'sources' &&
        (window as unknown as { rejectReadingStart: boolean }).rejectReadingStart
      )
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await filteredRoundRetry(
    page,
    () => localLibrary(page),
    async (enabled) => {
      await page.evaluate(
        (enabled) =>
          ((window as unknown as { rejectReadingStart: boolean }).rejectReadingStart = enabled),
        enabled,
      )
    },
  )
})
