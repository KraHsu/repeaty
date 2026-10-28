import { openPluginManager } from './fixtures/settings-flow'
import { expect, test } from '@playwright/test'
import { fixture } from '../src/core/test-fixtures'
import { readFile } from 'node:fs/promises'
import { practiceHistoryFixture } from './fixtures/practice-history'
test('the static edition has no LeetCode plugin, backend calls, or connector download', async ({
  page,
}) => {
  const backendRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/api/')) backendRequests.push(request.url())
  })
  await page.goto('./')
  await openPluginManager(page)
  await expect(page.getByRole('heading', { name: '答题历史', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: '启用 答题历史', exact: true })).toBeChecked()
  await expect(page.getByText('LeetCode', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '下载浏览器扩展' })).toHaveCount(0)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Static')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '添加 LeetCode 题目' })).toHaveCount(0)
  await expect(page.locator('#note-type option[value="plugin"]')).toBeDisabled()
  expect(backendRequests).toEqual([])
})

test('backend plugin notes remain exportable in the static edition without becoming reviewable', async ({
  page,
}) => {
  const library = fixture({
    type: 'plugin',
    plugin: { id: 'leetcode', version: 1, data: { saved: 'untouched' } },
  })
  await page.goto('./')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'backend.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByRole('button', { name: '显示答案', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧版 JSON', exact: true }).click()
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(backup.library.notes).toEqual(library.notes)
  expect(backup.library.cards).toEqual(library.cards)
})

test('imported practice history is readable in the static edition without loading or contacting LeetCode', async ({
  page,
}) => {
  const remoteRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      url.hostname.includes('leetcode') ||
      url.pathname.includes('/__native/') ||
      url.pathname.includes('/api/')
    )
      remoteRequests.push(request.url())
  })
  const library = practiceHistoryFixture(3)
  await page.goto('./')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '练习历史', exact: true }).click()
  await expect(page.locator('.practice-history')).toHaveCount(3)
  await expect(page.locator('.attempt-code')).toHaveCount(0)
  await page.locator('.attempt-history > summary').first().click()
  await expect(page.locator('.attempt-code code').first()).toContainText(
    '<script>stored text</script>',
  )
  await expect(page.locator('.attempt-code script')).toHaveCount(0)
  await page.locator('.attempt-history > summary').first().click()
  await expect(page.locator('.attempt-code')).toHaveCount(0)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧版 JSON', exact: true }).click()
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(backup.library.practices).toEqual(library.practices)
  expect(backup.library.attempts).toEqual(library.attempts)
  expect(remoteRequests).toEqual([])
})
