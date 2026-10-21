import { test, expect, headers } from './fixture'
import {
  readingFlow,
  importReading,
  moveReading,
  saveReading,
  readingText,
} from '../fixtures/reading-flow'
import { readingQueueFlow } from '../fixtures/reading-queue-flow'
import { readingRoundFlow, startRound } from '../fixtures/reading-round-flow'
test('opening source deletion survives autosave between pointer down and up', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await importReading(page, 'Delete while saving', 'plain', readingText)
  await saveReading(page)
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
  try {
    await moveReading(page, 0.5)
    await page.getByRole('button', { name: '删除材料', exact: true }).hover()
    await page.mouse.down()
    await requested
    await page.mouse.up()
    const dialog = page.getByRole('dialog', { name: '删除材料？', exact: true })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: '确认删除', exact: true })
    await expect(confirm).toBeDisabled()
    release()
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '还没有学习材料' })).toBeVisible()
    expect((await (await request.get('api/library', { headers })).json()).library.sources).toEqual(
      [],
    )
  } finally {
    release()
    await page.mouse.up()
  }
})

test('account reading rounds save positions in SQLite and preserve study records and backups', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await readingRoundFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})

test('a service failure prevents advancing or ending the round until its position can be saved', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await importReading(page, 'Remote A', 'plain', readingText)
  await importReading(page, 'Remote B', 'plain', readingText)
  await startRound(page, 'Remote A')
  await moveReading(page, 0.2)
  await saveReading(page)
  const before = (await (await request.get('api/library', { headers })).json()).library
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await moveReading(page, 0.6)
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Remote A', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '结束本轮', exact: true }).click()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 2 篇',
  )
  expect((await (await request.get('api/library', { headers })).json()).library).toEqual(before)
  await page.getByRole('button', { name: '稍后阅读', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '稍后阅读', exact: true })
  await dialog.getByRole('button', { name: /^1 周后/ }).click()
  const date = await dialog.getByLabel('下次阅读日期').inputValue()
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('下次阅读日期')).toHaveValue(date)
  await expect(dialog.getByRole('button', { name: /^1 周后/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 2 篇',
  )
  expect((await (await request.get('api/library', { headers })).json()).library).toEqual(before)
  reject = false
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Remote B', exact: true })).toBeVisible()
  expect(
    (await (await request.get('api/library', { headers })).json()).library.sources.find(
      (source: { title: string }) => source.title === 'Remote A',
    ).queue,
  ).toEqual({ state: 'active', availableOn: date })
  expect(
    (await (await request.get('api/library', { headers })).json()).library.sources.find(
      (source: { title: string }) => source.title === 'Remote A',
    ).reading.offset,
  ).toBeGreaterThan(500)
})

test('a late next-source response cannot recreate a round after leaving the material page', async ({
  page,
}) => {
  await page.goto('./')
  await importReading(page, 'Delayed A', 'plain', readingText)
  await importReading(page, 'Delayed B', 'plain', readingText)
  await startRound(page, 'Delayed A')
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
  await page.getByRole('button', { name: '下一篇', exact: true }).click()
  await requested
  await expect(page.getByRole('button', { name: '下一篇', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  release()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始一轮阅读', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Delayed A', exact: true })).toBeVisible()
})
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

test('account reading priorities and queues round-trip through SQLite and backups without changing card progress', async ({
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
  await page.getByLabel('阅读优先级', { exact: true }).selectOption('high')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveValue('normal')
  expect((await (await request.get('api/library', { headers })).json()).library).toEqual(before)
  reject = false
  await page.getByLabel('阅读优先级', { exact: true }).selectOption('high')
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveValue('high')
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
