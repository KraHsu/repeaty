import { test } from './fixtures/empty-workspace'
import { localLibrary } from './fixtures/source-excerpt-flow'
import { sourceDetailsFlow, sourceDetailsRetry } from './fixtures/source-details-flow'

test('edits source and excerpt details through filters, rounds, restart and backup without changing snapshots or learning', async ({
  page,
}, info) => {
  await sourceDetailsFlow(page, () => localLibrary(page), info)
})

test('a quota failure retains the details form and reading position for retry', async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (
        this.name === 'sources' &&
        (window as unknown as { rejectDetails: boolean }).rejectDetails
      )
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await sourceDetailsRetry(
    page,
    () => localLibrary(page),
    async (enabled) => {
      await page.evaluate(
        (enabled) => ((window as unknown as { rejectDetails: boolean }).rejectDetails = enabled),
        enabled,
      )
    },
  )
})
