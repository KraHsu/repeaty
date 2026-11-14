import { test, expect } from './fixtures/empty-workspace'
import { navigationFlow, restoreNavigation } from './fixtures/source-navigation-flow'
import { localLibrary } from './fixtures/source-excerpt-flow'
import { saveReading } from './fixtures/reading-flow'
import { showSourceText } from './fixtures/source-controls'
test('source excerpt navigation counts cards, locates repeated text and preserves learning through rounds, deletion and backup', async ({
  page,
}, info) => {
  await navigationFlow(page, () => localLibrary(page), info)
})
test('a failed parent position save keeps the source open until navigation can retry', async ({
  page,
}) => {
  await restoreNavigation(page)
  await saveReading(page)
  const before = await localLibrary(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { failNavigation: boolean }).failNavigation = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (
        this.name === 'sources' &&
        (window as unknown as { failNavigation: boolean }).failNavigation
      )
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  const open = page.getByRole('button', { name: '打开摘录「开头摘录🙂」', exact: true })
  await open.click()
  await expect(page.getByRole('alert').filter({ hasText: '存储空间不足' }).first()).toBeVisible()
  await expect(page.locator('.source-reader h2')).toHaveText('导航原文')
  expect((await localLibrary(page)).cards).toEqual(before.cards)
  await page.evaluate(
    () => ((window as unknown as { failNavigation: boolean }).failNavigation = false),
  )
  await open.click()
  await expect(page.locator('.source-reader h2')).toHaveText('开头摘录🙂')
})

test('an unreadable parent still lists saved excerpts and can open their independent bodies without overwriting its position', async ({
  page,
}) => {
  const data = await restoreNavigation(page)
  const before = await localLibrary(page)
  const parent = before.sources.find((source) => source.id === data.root.id)!
  await page.addInitScript((id) => {
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'assets' && key === id)
        throw new DOMException('Synthetic unreadable parent', 'UnknownError')
      return original.call(this, key)
    }
  }, parent.mediaId)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: '导航原文' }).click()
  await expect(page.locator('.source-reader [role="alert"]')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '定位「开头摘录🙂」的原文', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: '打开摘录「开头摘录🙂」', exact: true }).click()
  await expect(page.locator('.source-reader h2')).toHaveText('开头摘录🙂')
  await showSourceText(page)
  await expect(page.locator('.source-text')).toHaveValue('间隔复习会根据记忆状态安排下一次学习。🙂')
  const after = await localLibrary(page)
  expect(after.sources.find((source) => source.id === parent.id)).toEqual(parent)
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
})
