import { test, expect, headers } from './fixture'
import { navigationFlow, restoreNavigation } from '../fixtures/source-navigation-flow'
import { saveReading } from '../fixtures/reading-flow'
test('account source navigation preserves references and learning across rounds, deletion and backups', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await navigationFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})
test('navigation reads only the opened source body and preserves the original page after a failed save', async ({
  page,
  request,
}) => {
  await page.goto('./')
  const data = await restoreNavigation(page)
  await saveReading(page)
  const before = (await (await request.get('api/library', { headers })).json()).library
  const children = new Set(
    before.sources
      .filter(
        (source: { origin?: { sourceId: string } }) => source.origin?.sourceId === data.root.id,
      )
      .map((source: { mediaId: string }) => source.mediaId),
  )
  const reads: string[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      [...children].some((id) => request.url().endsWith(`/api/media/${id}`))
    )
      reads.push(request.url())
  })
  await page
    .getByRole('navigation', { name: '本篇摘录分页' })
    .getByRole('button', { name: '下一页', exact: true })
    .click()
  await page.getByRole('button', { name: '定位「末尾摘录🙂」的原文', exact: true }).click()
  await saveReading(page)
  expect(reads).toEqual([])
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  const open = page.getByRole('button', { name: '打开摘录「末尾摘录🙂」', exact: true })
  await open.click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.locator('.source-reader h2')).toHaveText('导航原文')
  expect(reads).toEqual([])
  reject = false
  await open.click()
  await expect(page.locator('.source-reader h2')).toHaveText('末尾摘录🙂')
  expect(reads).toHaveLength(1)
  expect((await (await request.get('api/library', { headers })).json()).library.cards).toEqual(
    before.cards,
  )
})
test('a late navigation response cannot open an excerpt after leaving the source page', async ({
  page,
}) => {
  await page.goto('./')
  await restoreNavigation(page)
  await saveReading(page)
  let release!: () => void, started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const arrived = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/api/library/commit', async (route) => {
    started()
    await gate
    await route.continue()
  })
  await page.getByRole('button', { name: '打开摘录「开头摘录🙂」', exact: true }).click()
  await arrived
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  release()
  await expect(page.getByRole('heading', { name: '数据与备份', exact: true })).toBeVisible()
  await page.unroute('**/api/library/commit')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.locator('.source-reader h2')).toHaveText('导航原文')
})
