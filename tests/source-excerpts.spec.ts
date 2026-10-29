import { test, expect } from './fixtures/empty-workspace'
import {
  sourceExcerptFlow,
  excerptDuringRound,
  localLibrary,
  selectForExcerpt,
} from './fixtures/source-excerpt-flow'
import { previewSource, saveSource, sourceQuote } from './fixtures/source-flow'
import { saveReading } from './fixtures/reading-flow'
import { showSourceText } from './fixtures/source-controls'

test('independent excerpts preserve exact provenance, cards and progress through deletion, restart and backup', async ({
  page,
}, info) => {
  await sourceExcerptFlow(page, () => localLibrary(page), info)
})
test('excerpts saved in a round join the next round and can be deferred independently', async ({
  page,
}) => {
  await excerptDuringRound(page, () => localLibrary(page))
})
test('a quota failure preserves the excerpt form and leaves no partial snapshot or asset', async ({
  page,
}) => {
  await previewSource(page)
  await saveSource(page)
  await selectForExcerpt(page)
  await saveReading(page)
  const before = await localLibrary(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { rejectExcerpt: boolean }).rejectExcerpt = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (
        this.name === 'sources' &&
        args[0]?.value?.kind === 'excerpt' &&
        (window as unknown as { rejectExcerpt: boolean }).rejectExcerpt
      )
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: '保存为摘录', exact: true }).click()
  await page.getByLabel('摘录标题').fill('Retry excerpt')
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('存储空间不足')
  await expect(page.getByLabel('摘录标题')).toHaveValue('Retry excerpt')
  await expect(page.getByLabel('选中的原文')).toHaveValue(sourceQuote)
  expect(await localLibrary(page)).toEqual(before)
  await page.evaluate(
    () => ((window as unknown as { rejectExcerpt: boolean }).rejectExcerpt = false),
  )
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await showSourceText(page)
  await expect(page.locator('.source-text')).toHaveValue(sourceQuote)
  expect((await localLibrary(page)).sources).toHaveLength(2)
})
