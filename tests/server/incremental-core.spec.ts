import { selectUiValue } from '../fixtures/ui-flow'
import { test, headers, expect } from './fixture'
import {
  batchReadingFlow,
  nestedDailyFlow,
  batchRetryFlow,
} from '../fixtures/incremental-core-flow'

test('account arranges cross-page selections atomically and undo preserves later FSRS ratings', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await batchReadingFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})
test('account connects nested excerpts, ancestry and daily entry through SQLite', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await nestedDailyFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})
test('service failures keep a batch atomic and preserve undo for retry', async ({
  page,
  request,
}) => {
  await page.goto('./')
  let reject = false
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await batchRetryFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    async (enabled) => {
      reject = enabled
    },
  )
})

test('a stale batch or undo cannot replace an arrangement committed by another account page', async ({
  page,
  context,
  request,
}) => {
  await page.goto('./')
  const { importReading } = await import('../fixtures/reading-flow')
  await importReading(page, 'Concurrent A', 'plain', 'First context')
  await importReading(page, 'Concurrent B', 'plain', 'Second context')
  await page.getByRole('button', { name: '选择本页', exact: true }).click()
  await page.getByRole('button', { name: '批量安排', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量安排', exact: true })
  await selectUiValue(dialog.getByLabel('批量操作', { exact: true }), 'archive')
  const other = await context.newPage()
  await other.goto('./')
  await other.getByRole('button', { name: '学习材料', exact: true }).click()
  await selectUiValue(other.getByLabel('阅读优先级', { exact: true }), 'high')
  await expect(other.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'high')
  const read = async () => (await (await request.get('api/library', { headers })).json()).library
  const concurrent = await read()
  await dialog.getByRole('button', { name: '确认批量安排', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect((await read()).sources).toEqual(concurrent.sources)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await selectUiValue(page.getByLabel('阅读优先级', { exact: true }), 'low')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'low')
  await other.reload()
  await other.getByRole('button', { name: '学习材料', exact: true }).click()
  await selectUiValue(other.getByLabel('阅读优先级', { exact: true }), 'normal')
  await expect(other.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'normal')
  const latest = await read()
  await page.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
  await expect(page.locator('.notification.error').last()).toBeVisible()
  expect((await read()).sources).toEqual(latest.sources)
  await other.close()
})
