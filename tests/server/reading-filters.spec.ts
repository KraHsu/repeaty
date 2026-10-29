import { selectUiValue } from '../fixtures/ui-flow'
import { test, expect, headers } from './fixture'
import { readingFilterFlow, filteredRoundRetry } from '../fixtures/reading-filter-flow'
import { importReading, moveReading, readingText } from '../fixtures/reading-flow'

test('account source filters and scoped rounds preserve SQLite content and learning records', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await readingFilterFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})

test('a service failure retains the chosen filters until the initial position save can retry', async ({
  page,
  request,
}) => {
  await page.goto('./')
  let reject = false
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await filteredRoundRetry(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    async (enabled) => {
      reject = enabled
    },
  )
})

test('a late filtered-round start cannot recreate the round after leaving the page', async ({
  page,
}) => {
  await page.goto('./')
  await importReading(page, 'Delayed filtered source', 'plain', readingText)
  await selectUiValue(page.getByLabel('材料类型', { exact: true }), 'original')
  await page.getByLabel('搜索材料', { exact: true }).fill('Delayed')
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
  await moveReading(page, 0.5)
  await page.getByRole('button', { name: '阅读筛选结果', exact: true }).click()
  await requested
  await expect(page.getByLabel('材料类型', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  release()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始一轮阅读', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('材料类型', { exact: true })).toHaveAttribute('value', 'all')
  await expect(page.getByLabel('搜索材料', { exact: true })).toHaveValue('')
})
