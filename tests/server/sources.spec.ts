import { previewCollection } from '../fixtures/collection-controls'
import { test, expect, headers } from './fixture'
import {
  createSourceDeck,
  previewSource,
  saveSource,
  selectSourceExcerpt,
  sourceText,
  sourceQuote,
} from '../fixtures/source-flow'

test('sources and excerpts commit atomically to the account, read bodies on demand, and stay isolated from another account', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await createSourceDeck(page)
  await previewSource(page)
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await previewCollection(page.getByRole('dialog', { name: '收集材料', exact: true }))
  await page.getByRole('button', { name: '保存到阅读材料', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  expect((await (await request.get('api/library', { headers })).json()).library.sources).toEqual([])
  reject = false
  await saveSource(page)
  const imported = await (await request.get('api/library', { headers })).json()
  const sourceId = imported.library.sources[0].mediaId
  let release!: () => void, arrived!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    arrived = resolve
  })
  await page.route(`**/api/media/${sourceId}`, async (route) => {
    arrived()
    await gate
    await route.continue()
  })
  await selectSourceExcerpt(page)
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('间隔复习如何安排时间？')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  try {
    await started
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole('button', { name: '关闭弹窗', exact: true })).toBeDisabled()
  } finally {
    release()
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.unroute(`**/api/media/${sourceId}`)
  const saved = await (await request.get('api/library', { headers })).json()
  const source = saved.library.sources[0]
  expect(source).not.toHaveProperty('content')
  expect(saved.library.notes[0].excerpt).toMatchObject({
    sourceId: source.id,
    quote: sourceQuote,
    start: sourceText.lastIndexOf(sourceQuote),
  })
  const sourceReads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().includes(`/api/media/${source.mediaId}`))
      sourceReads.push(request.url())
  })
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await expect(page.locator('.card-question')).toContainText('间隔复习如何安排时间')
  expect(sourceReads).toEqual([])
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  expect(sourceReads).toEqual([])
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText(sourceQuote)
  expect(sourceReads).toHaveLength(1)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(sourceText)
  const before = await (await request.get('api/library', { headers })).json()
  await page.getByRole('button', { name: '删除材料', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有学习材料' })).toBeVisible()
  const after = await (await request.get('api/library', { headers })).json()
  expect(after.library.sources).toEqual([])
  expect(after.library.cards).toEqual(before.library.cards)
  expect(after.library.reviews).toEqual(before.library.reviews)
  expect(after.library.notes[0].excerpt).toBeUndefined()
  const backups = await (await request.get('api/backups', { headers })).json()
  const backup = await (
    await request.get(
      `api/backups/${backups.find((entry: { reason: string }) => entry.reason === '删除材料前').id}`,
      { headers },
    )
  ).json()
  expect(backup.sources[0]).toEqual(source)
  expect(await (await request.get(`api/media/${source.mediaId}`, { headers })).text()).toBe(
    sourceText,
  )
  // The same media ID is not readable from a newly registered user's library.
  const registration = await request.post('api/auth/register', {
    headers: { 'X-Repeaty-Client': '1' },
    data: {
      username: `other-${crypto.randomUUID().slice(0, 16)}`,
      password: 'other-account-password',
    },
  })
  expect(registration.ok()).toBe(true)
  const { user } = await registration.json()
  const isolatedHeaders = { 'X-Repeaty-Client': '1', 'X-Repeaty-User': user.id }
  expect(
    (await request.get(`api/media/${source.mediaId}`, { headers: isolatedHeaders })).status(),
  ).toBe(404)
  expect(
    (await (await request.get('api/library', { headers: isolatedHeaders })).json()).library.sources,
  ).toEqual([])
})
