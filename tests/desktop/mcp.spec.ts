import type { Page } from '@playwright/test'
import { test, expect, storedLibrary } from './fixture'
import { practiceHistoryFixture } from '../fixtures/practice-history'

function query(page: Page, tool: string, args: Record<string, unknown> = {}, scope?: string) {
  return page.evaluate(
    ([tool, args, scope]) =>
      (
        window as unknown as {
          __repeatyTestMcpCall(
            tool: string,
            args: Record<string, unknown>,
            scope?: string,
          ): Promise<{ status: string; data: Record<string, unknown>; code?: string }>
        }
      ).__repeatyTestMcpCall(tool, args, scope),
    [tool, args, scope] as const,
  )
}

test('desktop settings opt in to local read queries, revoke keys, and retain the library unchanged', async ({
  page,
}, info) => {
  const library = practiceHistoryFixture()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'mcp-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const before = await storedLibrary(page)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '桌面设置' })
  const mcp = dialog.getByRole('region', { name: 'MCP 连接' })
  await expect(mcp.getByRole('status')).toHaveText('已关闭')
  await expect(mcp.getByRole('button', { name: '开启 MCP' })).toBeEnabled()
  await mcp.getByRole('button', { name: '开启 MCP' }).click()
  await expect(mcp.getByRole('status')).toHaveText('已开启')
  await expect(mcp.locator('textarea')).toHaveCount(0)
  await mcp.getByRole('button', { name: '显示连接配置' }).click()
  const config = JSON.parse(await mcp.getByLabel('客户端连接配置').inputValue())
  expect(config.mcpServers.repeaty.url).toBe('http://127.0.0.1:43123/mcp')
  const key = config.mcpServers.repeaty.headers.Authorization
  const stats = await query(page, 'repeaty_study_stats')
  expect(stats).toMatchObject({ status: 'ok', data: { totals: { cards: 2, practices: 25 } } })
  const due = await query(page, 'repeaty_due_cards', { limit: 1 })
  expect(due).toMatchObject({ status: 'ok', data: { total: 2, nextOffset: 1 } })
  const history = await query(page, 'repeaty_practice_history', { limit: 1 })
  expect(history).toMatchObject({ status: 'ok', data: { total: 25, nextOffset: 1 } })
  expect(JSON.stringify(history)).not.toMatch(/"code"|"detail"|"back"|"snippets"/)
  expect(await query(page, 'repeaty_due_cards', { includeAnswers: true })).toMatchObject({
    status: 'error',
    code: 'invalid-arguments',
  })
  expect(await query(page, 'repeaty_due_cards', {}, 'server:other')).toMatchObject({
    status: 'error',
    code: 'library-unavailable',
  })
  expect(await storedLibrary(page)).toEqual(before)
  await mcp.getByRole('button', { name: '关闭 MCP' }).click()
  await expect(mcp.getByRole('status')).toHaveText('已关闭')
  await expect(mcp.locator('textarea')).toHaveCount(0)
  await mcp.getByRole('button', { name: '开启 MCP' }).click()
  await mcp.getByRole('button', { name: '显示连接配置' }).click()
  expect(
    JSON.parse(await mcp.getByLabel('客户端连接配置').inputValue()).mcpServers.repeaty.headers
      .Authorization,
  ).not.toBe(key)
  await dialog.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByLabel('界面语言').selectOption('en')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('region', { name: 'MCP connection' })).toContainText('read-only')
  await page.setViewportSize({ width: 720, height: 850 })
  await page.getByRole('button', { name: 'Show connection configuration' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mcp-settings-en.png'), fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('region', { name: 'MCP connection' }).getByRole('status')).toHaveText(
    'Disabled',
  )
  expect(await storedLibrary(page)).toEqual(before)
})

test('an upstream workspace cannot enable MCP', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('test.endpoint', 'http://127.0.0.1:8080'))
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('button', { name: '开启 MCP' })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'MCP 连接' })).toContainText('仅支持本地学习库')
})
