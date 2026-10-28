import { openPluginManager } from '../fixtures/settings-flow'
import { test, expect, headers } from './fixture'
import { test as isolatedTest } from '@playwright/test'
import { openAsBlob } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { exportArchive, parseArchive } from '../../src/core/archive'
import { richLibrary } from '../fixtures/rich-library'
import { practiceHistoryFixture } from '../fixtures/practice-history'

test('128 MiB media and long text round trip through SQLite, snapshots, and the static edition', async ({
  page,
  context,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const { library, assets, front } = richLibrary()
  const media = new Map(assets.map((asset) => [asset.meta.id, asset.blob]))
  const archive = (await exportArchive(library, async (id) => media.get(id)))!
  const path = testInfo.outputPath('original.repeaty')
  await writeFile(path, new Uint8Array(await archive.arrayBuffer()))
  await page.goto('./')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles(path)
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 })
  await page.reload()
  const saved = await (await request.get('api/library', { headers })).json()
  expect(saved.library.notes[0].front).toBe(front)
  expect(saved.library.media).toHaveLength(17)
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
  ).not.toContain('repeaty')
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0)
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '删除卡片 Second media card', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page
    .locator('.snapshot-list li')
    .filter({ hasText: '删除笔记前' })
    .first()
    .getByRole('button', { name: '恢复此快照' })
    .click()
  await page.getByRole('button', { name: '确认恢复快照' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const exportedPath = (await (await download).path())!
  const restored = await parseArchive(await openAsBlob(exportedPath))
  expect(restored.library.notes.map((note) => [note.front, note.back])).toEqual(
    library.notes.map((note) => [note.front, note.back]),
  )
  expect(restored.assets).toHaveLength(17)
  const hash = async (blob: Blob) =>
    createHash('sha256')
      .update(new Uint8Array(await blob.arrayBuffer()))
      .digest('hex')
  for (const asset of restored.assets) {
    const original = assets.find((item) => item.meta.name === asset.meta.name)!
    expect(await hash(asset.blob)).toBe(await hash(original.blob))
  }
  const staticPage = await context.newPage()
  await staticPage.goto(`http://127.0.0.1:4177${process.env.VITE_BASE_PATH || '/'}`)
  await staticPage.getByRole('button', { name: '数据与备份', exact: true }).click()
  await staticPage.getByLabel('导入备份文件').setInputFiles(exportedPath)
  await staticPage.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(staticPage.getByRole('dialog')).toHaveCount(0, { timeout: 30000 })
  await staticPage.reload()
  await staticPage.getByRole('button', { name: '全部卡片' }).click()
  await staticPage.getByRole('textbox', { name: '搜索卡片' }).fill('长文本')
  await staticPage.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await staticPage.getByRole('button', { name: '开始专项练习' }).click()
  await expect(staticPage.locator('.card-question')).toHaveText(front)
  const image = staticPage.getByRole('img', { name: 'pixel.png' })
  await image.scrollIntoViewIfNeeded()
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true)
  await expect(staticPage.locator('audio')).toHaveCount(7)
})

test('stale pages cannot overwrite SQLite and an unavailable service never falls back to browser storage', async ({
  page,
  context,
  request,
}) => {
  await page.goto('./')
  const old = await context.newPage()
  await old.goto('./')
  await old.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await old.getByLabel('卡组名称').fill('Stale deck')
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Saved deck')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await old.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(old.getByRole('dialog').getByRole('alert')).toContainText('数据已在另一个页面更新')
  await expect(old.getByLabel('卡组名称')).toHaveValue('Stale deck')
  const saved = await (await request.get('api/library', { headers })).json()
  expect(saved.library.decks.map((deck: { name: string }) => deck.name)).toEqual(['Saved deck'])
  await page.route('**/api/library/summary', (route) => route.abort())
  await page.reload()
  await expect(
    page.getByText('无法连接服务，请检查后端是否正在运行。', { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
  ).not.toContain('repeaty')
})

test('account history fetches bodies only on expansion, retries safely and exports complete submissions', async ({
  page,
  request,
}) => {
  const library = practiceHistoryFixture(130)
  await page.goto('./')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const bodies: unknown[] = []
  let fail = true
  await page.route('**/api/library/attempts', async (route) => {
    bodies.push(route.request().postDataJSON())
    if (fail) {
      fail = false
      return route.abort()
    }
    return route.continue()
  })
  const summary = page.waitForResponse('**/api/library/summary')
  await page.reload()
  const loaded = (await (await summary).json()).library
  expect(loaded.attempts).toHaveLength(130)
  expect(loaded.attempts.every((entry: { code?: string }) => entry.code === undefined)).toBe(true)
  await page.getByRole('button', { name: '练习历史', exact: true }).click()
  await expect(page.locator('.practice-history')).toHaveCount(20)
  await expect(page.locator('.attempt-code')).toHaveCount(0)
  expect(bodies).toEqual([])
  await page.locator('.attempt-history > summary').first().click()
  await expect(page.locator('.attempt-body [role="alert"]')).toContainText('无法读取这次提交')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('.attempt-code code')).toContainText('# attempt 129')
  expect(bodies).toHaveLength(2)
  await page.locator('.attempt-history > summary').first().click()
  await expect(page.locator('.attempt-code')).toHaveCount(0)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  expect(bodies).toHaveLength(2)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const restored = await parseArchive(await openAsBlob((await (await download).path())!))
  expect(restored.library.attempts).toEqual(library.attempts)
  const stored = await (await request.get('api/library', { headers })).json()
  expect(stored.library.attempts).toEqual(library.attempts)
  expect(bodies.filter((entry) => (entry as { mode: string }).mode === 'batch')).toHaveLength(2)
})

isolatedTest(
  'new accounts receive the starter deck and cookies stay HttpOnly',
  async ({ page, context }) => {
    await page.goto('./')
    await page.getByRole('button', { name: '创建账户', exact: true }).click()
    await page
      .getByLabel('用户名', { exact: true })
      .fill(`browser-${crypto.randomUUID().slice(0, 24)}`)
    await page.getByLabel('密码', { exact: true }).fill('browser-test-password')
    await page.getByRole('button', { name: '创建账户', exact: true }).click()
    await expect(page.locator('.deck-title')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.deck-title')).toHaveCount(1)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const cookie = (await context.cookies()).find((c) => c.name === 'repeaty_session')!
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe('Strict')
    expect(
      await page.evaluate(() => JSON.stringify([localStorage, sessionStorage, document.cookie])),
    ).not.toContain(cookie.value)
    await openPluginManager(page)
    await expect(page.getByRole('switch', { name: '启用 LeetCode' })).toHaveCount(0)
    const cookieUsername = await page.locator('.account-controls > span').innerText()
    await page.getByRole('button', { name: '修改密码', exact: true }).click()
    await page.getByLabel('当前密码', { exact: true }).fill('browser-test-password')
    await page.getByLabel('新密码', { exact: true }).fill('changed-browser-password')
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByLabel('用户名', { exact: true })).toBeVisible()
    await page.getByLabel('用户名', { exact: true }).fill(cookieUsername)
    await page.getByLabel('密码', { exact: true }).fill('changed-browser-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.locator('.deck-title')).toHaveCount(1)
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await expect(page.getByLabel('用户名', { exact: true })).toBeVisible()
  },
)

test('an existing empty SQLite library stays empty until the starter deck is requested', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '还没有卡组' })).toBeVisible()
  await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
  await expect(page.locator('.deck-title')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.deck-title')).toHaveCount(1)
  const snapshot = await (await request.get('api/library', { headers })).json()
  expect(snapshot.library.notes).toHaveLength(24)
  expect(snapshot.library.cards).toHaveLength(27)
  expect(snapshot.library.reviews).toHaveLength(0)
  expect(snapshot.library.media).toHaveLength(2)
  for (const meta of snapshot.library.media) {
    const response = await request.get(`api/media/${meta.id}`, { headers })
    expect(response.ok()).toBe(true)
    const bytes = await response.body()
    expect(bytes.byteLength).toBe(meta.size)
    if (meta.type === 'image/png')
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    else expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
  }
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
  ).not.toContain('repeaty')
})
