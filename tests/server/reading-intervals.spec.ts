import { test, expect, headers } from './fixture'
import { readingIntervalFlow, openReadSchedule } from '../fixtures/reading-interval-flow'
import { importReading, moveReading, readingText, saveReading } from '../fixtures/reading-flow'
import { startRound } from '../fixtures/reading-round-flow'
import { queueView } from '../fixtures/reading-queue-flow'

test('a snapshot-list failure after a durable save does not keep the confirmation open or advance twice', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await importReading(page, 'Saved interval', 'plain', readingText)
  await queueView(page, '全部材料')
  await page.route('**/api/backups', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  )
  const dialog = await openReadSchedule(page, 1)
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await request.get('api/library', { headers })).json()).library.sources[0]
          .readingIntervalDays,
    )
    .toBe(1)
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.source-interval-control')).toContainText('上次间隔：1天')
  const next = await openReadSchedule(page, 3)
  await next.getByRole('button', { name: '取消', exact: true }).click()
  expect(
    (await (await request.get('api/library', { headers })).json()).library.sources[0]
      .readingIntervalDays,
  ).toBe(1)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('修改已保存，但暂时无法读取快照列表。')
  await page.unroute('**/api/backups')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await queueView(page, '全部材料')
  await page.getByRole('button', { name: '重置间隔', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '重置间隔', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: '修改已保存，但暂时无法读取快照列表。' }),
  ).toHaveCount(0)
})

test('account reading intervals preserve independent steps, cards and backups in SQLite', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await readingIntervalFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})

test('a service failure keeps the confirmed step and round unchanged until saving can retry', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await importReading(page, 'Remote interval A', 'plain', readingText)
  await importReading(page, 'Remote interval B', 'plain', readingText)
  await startRound(page, 'Remote interval A')
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = (await (await request.get('api/library', { headers })).json()).library
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await moveReading(page, 0.7)
  const dialog = await openReadSchedule(page, 1)
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect((await (await request.get('api/library', { headers })).json()).library).toEqual(before)
  await expect(dialog.locator('[aria-current="step"]')).toHaveText('1天')
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 2 篇',
  )
  reject = false
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Remote interval B', exact: true })).toBeVisible()
  const saved = (await (await request.get('api/library', { headers })).json()).library.sources.find(
    (source: { title: string }) => source.title === 'Remote interval A',
  )
  expect(saved.readingIntervalDays).toBe(1)
  expect(saved.reading.offset).toBeGreaterThan(500)
})
