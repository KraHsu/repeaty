import { test } from './fixtures/empty-workspace'
import { localLibrary } from './fixtures/source-excerpt-flow'
import { batchReadingFlow, nestedDailyFlow, batchRetryFlow } from './fixtures/incremental-core-flow'

test('batch selection spans pages, supports every arrangement and undoes without reverting later card ratings', async ({
  page,
}, info) => {
  await batchReadingFlow(page, () => localLibrary(page), info)
})
test('nested excerpts connect daily reading, provenance, card review, deletion and restart', async ({
  page,
}, info) => {
  await nestedDailyFlow(page, () => localLibrary(page), info)
})
test('quota failures roll back the entire batch and allow undo to retry', async ({ page }) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'sources' && (window as unknown as { rejectBatch: boolean }).rejectBatch)
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await batchRetryFlow(
    page,
    () => localLibrary(page),
    async (enabled) => {
      await page.evaluate(
        (enabled) => ((window as unknown as { rejectBatch: boolean }).rejectBatch = enabled),
        enabled,
      )
    },
  )
})
