import { selectUiValue } from './fixtures/ui-flow'
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
import { readingRoundFlow, startRound } from './fixtures/reading-round-flow'

async function read(page: Parameters<typeof storedLibrary>[0]) {
  const rows = await storedLibrary(page)
  return Object.fromEntries(
    Object.entries(rows).map(([store, values]) => [
      store,
      (values as { value: unknown }[]).map((row) => row.value),
    ]),
  ) as unknown as Library
}
test('reading rounds save before advancing, retain their order, defer, archive and finish without changing reviews', async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  await readingRoundFlow(page, () => read(page), info)
})

test('a failed next-source save retains the current round and position for retry', async ({
  page,
}) => {
  await importReading(page, 'Next A', 'plain', readingText)
  await importReading(page, 'Next B', 'plain', readingText)
  await startRound(page, 'Next A')
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = await read(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { failNext: boolean }).failNext = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'sources' && (window as unknown as { failNext: boolean }).failNext)
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await moveReading(page, 0.65)
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '存储空间不足' }).first()).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Next A', exact: true, includeHidden: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '本轮阅读', exact: true, includeHidden: true }),
  ).toContainText('第 1 篇，共 2 篇')
  expect(await read(page)).toEqual(before)
  await page.getByRole('button', { name: '稍后阅读', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '稍后阅读', exact: true })
  await dialog.getByRole('button', { name: /^3 天后/ }).click()
  const date = await dialog.getByLabel('下次阅读日期').inputValue()
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('存储空间不足')
  await expect(dialog.getByLabel('下次阅读日期')).toHaveValue(date)
  await expect(dialog.getByRole('button', { name: /^3 天后/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('heading', { name: 'Next A', exact: true, includeHidden: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '本轮阅读', exact: true, includeHidden: true }),
  ).toContainText('第 1 篇，共 2 篇')
  expect(await read(page)).toEqual(before)
  await page.evaluate(() => ((window as unknown as { failNext: boolean }).failNext = false))
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Next B', exact: true })).toBeVisible()
  const saved = (await read(page)).sources.find((source) => source.title === 'Next A')!
  expect(saved.queue).toEqual({ state: 'active', availableOn: date })
  expect(saved.reading!.offset).toBeGreaterThan(
    before.sources.find((source) => source.id === saved.id)!.reading!.offset,
  )
  await page.getByRole('button', { name: '完成本轮', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()
})

test('an unreadable source still allows ending the round without overwriting its position', async ({
  page,
}) => {
  await importReading(page, 'Readable A', 'plain', readingText)
  await importReading(page, 'Unreadable B', 'plain', readingText)
  await moveReading(page, 0.35)
  await saveReading(page)
  await startRound(page, 'Readable A')
  const target = (await read(page)).sources.find((source) => source.title === 'Unreadable B')!
  await page.evaluate((id) => {
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'assets' && key === id)
        throw new DOMException('Synthetic unreadable body', 'UnknownError')
      return original.call(this, key)
    }
  }, target.mediaId)
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Unreadable B', exact: true })).toBeVisible()
  await expect(page.locator('.source-reader [role="alert"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '完成本轮', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '结束本轮', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '本轮阅读', exact: true, includeHidden: true }),
  ).toHaveCount(0)
  expect((await read(page)).sources.find((source) => source.id === target.id)).toEqual(target)
})
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
  await selectUiValue(page.getByLabel('阅读优先级', { exact: true }), 'high')
  await expect(page.getByRole('alert')).toContainText('存储空间不足')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'normal')
  expect(await read(page)).toEqual(before)
  await page.evaluate(() => ((window as unknown as { failQueue: boolean }).failQueue = false))
  await selectUiValue(page.getByLabel('阅读优先级', { exact: true }), 'high')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'high')
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
  await selectUiValue(priority, 'low')
  await expect(priority).toHaveAttribute('value', 'low')
  await expect(page.locator('.source-list-pages')).toContainText('2 / 2')
  await expect(page.locator('.source-list-title')).toHaveText(['Page 01'])
  await expect(page.getByRole('heading', { name: 'Page 01', exact: true })).toBeVisible()
  expect(
    await page.locator('.source-text').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(500)
  await priority.focus()
  await priority.press('Space')
  await page.getByRole('option').first().press('Home')
  await page.getByRole('option').first().press('Enter')
  await priority.press('Tab')
  await expect(priority).toHaveAttribute('value', 'high')
  await expect(page.locator('.source-list-pages')).toContainText('1 / 2')
  await expect(page.locator('.source-list-title').first()).toHaveText('Page 01')
  await expect(page.locator('.source-list-title')).toHaveCount(20)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Page 01', exact: true })).toBeVisible()
  await expect(priority).toHaveAttribute('value', 'high')
})
