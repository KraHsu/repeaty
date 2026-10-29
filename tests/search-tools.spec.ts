import { test } from './fixtures/empty-workspace'
import { searchToolsLayoutFlow, searchToolsSaveRetryFlow } from './fixtures/search-tools-flow'

test('search tools progressively disclose one task at a time across themes and widths', async ({
  page,
}, info) => {
  await searchToolsLayoutFlow(page, info, false)
})

test('saved search failures retain input, and retry, update, duplicate and delete persist', async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (
        this.name === 'savedSearches' &&
        (window as unknown as { rejectFilterSave: boolean }).rejectFilterSave
      )
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await searchToolsSaveRetryFlow(page, async (enabled) => {
    await page.evaluate((enabled) => {
      ;(window as unknown as { rejectFilterSave: boolean }).rejectFilterSave = enabled
    }, enabled)
  })
})
