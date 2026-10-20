import { test, expect, headers } from './fixture'
import {
  readingFlow,
  importReading,
  moveReading,
  saveReading,
  readingText,
} from '../fixtures/reading-flow'
import { readingQueueFlow } from '../fixtures/reading-queue-flow'
test('account reading positions persist in SQLite and round-trip through backups', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await readingFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})

test('account reading queues round-trip through SQLite and backups without changing card progress', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await readingQueueFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})

test('an unavailable service refuses to archive and retains the original reading queue', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await importReading(page, 'Account queue retry', 'plain', readingText)
  await moveReading(page, 0.3)
  await saveReading(page)
  const before = (await (await request.get('api/library', { headers })).json()).library
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await (await request.get('api/library', { headers })).json()).library).toEqual(before)
  await expect(
    page.getByRole('heading', { name: 'Account queue retry', exact: true }),
  ).toBeVisible()
  reject = false
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂无待阅读材料', exact: true })).toBeVisible()
})
test('an unavailable account service keeps the unsaved reading position for retry', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await importReading(page, 'Account reading', 'plain', readingText)
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = (await (await request.get('api/library', { headers })).json()).library
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await moveReading(page, 0.7)
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'error')
  expect((await (await request.get('api/library', { headers })).json()).library).toEqual(before)
  reject = false
  await page.getByRole('button', { name: '重试保存位置' }).click()
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'saved')
  expect(
    (await (await request.get('api/library', { headers })).json()).library.sources[0].reading
      .offset,
  ).toBeGreaterThan(before.sources[0].reading.offset)
})
