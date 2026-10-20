import { test, expect, headers } from './fixture'
import {
  sourceDetailsFlow,
  sourceDetailsRetry,
  openSourceDetails,
  changeSourceDetails,
} from '../fixtures/source-details-flow'
import { importReading, readingText } from '../fixtures/reading-flow'

test('account edits source and excerpt details while preserving SQLite snapshots, learning and backups', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await sourceDetailsFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})

test('a service failure preserves metadata input and position until saving can retry', async ({
  page,
  request,
}) => {
  await page.goto('./')
  let reject = false
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await sourceDetailsRetry(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    async (enabled) => {
      reject = enabled
    },
  )
})

test('a late details response cannot reopen the editor or navigate after leaving the material page', async ({
  page,
}) => {
  await page.goto('./')
  await importReading(page, 'Delayed details', 'plain', readingText)
  const dialog = await openSourceDetails(page)
  await dialog.getByLabel('材料标题', { exact: true }).fill('Saved after leaving')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let notify!: () => void
  const requested = new Promise<void>((resolve) => {
    notify = resolve
  })
  await page.route('**/api/library/commit', async (route) => {
    notify()
    await gate
    await route.continue()
  })
  await dialog.getByRole('button', { name: '保存材料信息', exact: true }).click()
  await requested
  await expect(dialog.getByRole('button', { name: '保存材料信息', exact: true })).toBeDisabled()
  await page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')]
      .find((button) => button.textContent?.trim() === '数据与备份')!
      .click(),
  )
  release()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Saved after leaving', exact: true }),
  ).toBeVisible()
})

test('a stale account page retains its form and cannot overwrite a title saved in another page', async ({
  page,
  context,
  request,
}) => {
  await page.goto('./')
  await importReading(page, 'Shared source', 'plain', readingText)
  const dialog = await openSourceDetails(page)
  await dialog.getByLabel('材料标题', { exact: true }).fill('Older pending title')
  const other = await context.newPage()
  await other.goto('./')
  await other.getByRole('button', { name: '学习材料', exact: true }).click()
  await changeSourceDetails(other, 'Newer saved title', 'https://example.org/newer')
  await dialog.getByRole('button', { name: '保存材料信息', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('材料标题', { exact: true })).toHaveValue('Older pending title')
  expect(
    (await (await request.get('api/library', { headers })).json()).library.sources[0].title,
  ).toBe('Newer saved title')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Newer saved title', exact: true })).toBeVisible()
  await other.close()
})
