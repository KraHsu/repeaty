import { test, expect, headers, token } from './fixture'
import { test as isolatedTest } from '@playwright/test'
import { openAsBlob } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { exportArchive, parseArchive } from '../../src/core/archive'
import { richLibrary } from '../fixtures/rich-library'

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
  await page.route('**/api/library', (route) => route.abort())
  await page.reload()
  await expect(
    page.getByText('无法连接服务，请检查后端是否正在运行。', { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
  ).not.toContain('repeaty')
})

isolatedTest(
  'the access key form unlocks the service without storing credentials in localStorage',
  async ({ page }) => {
    await page.goto('./')
    await expect(page.getByLabel('服务访问密钥')).toBeVisible()
    await page.getByLabel('服务访问密钥').fill('wrong-key')
    await page.getByRole('button', { name: '连接服务', exact: true }).click()
    await expect(page.getByText('请输入正确的服务访问密钥。', { exact: true })).toBeVisible()
    await page.getByLabel('服务访问密钥').fill(token)
    await page.getByRole('button', { name: '连接服务', exact: true }).click()
    await expect(page.getByLabel('服务访问密钥')).toHaveCount(0)
    await page.reload()
    await expect(page.getByLabel('服务访问密钥')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token)
  },
)
