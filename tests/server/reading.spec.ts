import { test, expect, headers } from './fixture'
import {
  readingFlow,
  importReading,
  moveReading,
  saveReading,
  readingText,
} from '../fixtures/reading-flow'
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
