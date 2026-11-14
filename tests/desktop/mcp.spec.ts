import { selectUiValue } from '../fixtures/ui-flow'
import type { Page } from '@playwright/test'
import { test, expect, storedLibrary } from './fixture'
import { practiceHistoryFixture } from '../fixtures/practice-history'
import { openSettings, setInterfaceLanguage } from '../fixtures/settings-flow'

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

test('automation grants, previews and receipt replay use the real desktop library transaction', async ({
  page,
}) => {
  await openSettings(page, 'connections.mcp')
  await page.getByRole('button', { name: '开启 MCP', exact: true }).click()
  const initial = await query(page, 'repeaty_automation_status')
  expect(initial).toMatchObject({ status: 'ok', data: { readEnabled: false, writeEnabled: false } })
  expect(await query(page, 'repeaty_query_library', { kind: 'library' })).toMatchObject({
    status: 'error',
    code: 'permission-denied',
  })
  await page.getByRole('switch', { name: '允许 CLI / MCP 查询整库', exact: true }).click()
  const before = await query(page, 'repeaty_query_library', { kind: 'library' })
  const request = {
    protocolVersion: 1,
    operationId: 'desktop-automation-1',
    expectedRevision: before.data.revision,
    commands: [
      { kind: 'source.create', input: { title: '自动化材料', body: '预览后保存的正文。' } },
    ],
  }
  expect(await query(page, 'repeaty_preview_changes', request)).toMatchObject({
    status: 'error',
    code: 'permission-denied',
  })
  await page.getByRole('switch', { name: '允许 CLI / MCP 批量修改', exact: true }).click()
  const preview = await query(page, 'repeaty_preview_changes', request)
  expect(preview.status).toBe('ok')
  const input = { request, fingerprint: preview.data.fingerprint, planId: preview.data.planId }
  const saved = await query(page, 'repeaty_apply_changes', input)
  expect(saved).toMatchObject({ status: 'ok', data: { replayed: false } })
  const repeated = await query(page, 'repeaty_apply_changes', input)
  expect(repeated).toEqual({ ...saved, data: { ...saved.data, replayed: true } })
  const sources = await query(page, 'repeaty_query_library', {
    kind: 'sources',
    text: '自动化材料',
  })
  expect(sources).toMatchObject({ status: 'ok', data: { total: 1 } })
  const status = await query(page, 'repeaty_operation_status', { operationId: request.operationId })
  expect(status).toMatchObject({ status: 'ok', data: { found: true, receipt: { replayed: true } } })
  expect(await query(page, 'repeaty_operation_status', { operationId: 'missing' })).toMatchObject({
    status: 'ok',
    data: { found: false },
  })
  await page.getByRole('switch', { name: '允许 CLI / MCP 批量修改', exact: true }).click()
  expect(await query(page, 'repeaty_apply_changes', input)).toMatchObject({
    status: 'error',
    code: 'permission-denied',
  })
  await page.reload()
  await openSettings(page, 'connections.mcp')
  await page.getByRole('button', { name: '开启 MCP', exact: true }).click()
  await page.getByRole('switch', { name: '允许 CLI / MCP 查询整库', exact: true }).click()
  expect(
    await query(page, 'repeaty_operation_status', { operationId: request.operationId }),
  ).toMatchObject(status)
})

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
  await openSettings(page, 'connections.mcp')
  const dialog = page.getByRole('region', { name: '桌面设置' })
  const mcp = dialog.getByRole('region', { name: 'MCP 连接' })
  await selectUiValue(mcp.getByLabel('MCP 客户端', { exact: true }), 'http')
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
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await setInterfaceLanguage(page, 'en')
  await openSettings(page, 'connections.mcp')
  await expect(page.getByRole('region', { name: 'MCP connection' })).toContainText('read-only')
  await page.setViewportSize({ width: 720, height: 850 })
  await page.getByRole('button', { name: 'Show connection configuration' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mcp-settings-en.png'), fullPage: true })
  await page.reload()
  await openSettings(page, 'connections.mcp')
  await expect(page.getByRole('region', { name: 'MCP connection' }).getByRole('status')).toHaveText(
    'Disabled',
  )
  expect(await storedLibrary(page)).toEqual(before)
})

test('closing a workspace disables MCP until a directory is opened', async ({ page }) => {
  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await page.getByRole('button', { name: '关闭目录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '打开文件夹，开始学习' })).toBeVisible()
  await openSettings(page, 'connections.mcp')
  await expect(page.getByRole('button', { name: '开启 MCP' })).toBeDisabled()
})

test('client configurations can be copied before enabling MCP and reused after restart', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSettings(page, 'connections.mcp')
  const dialog = page.getByRole('region', { name: '桌面设置' })
  const mcp = dialog.getByRole('region', { name: 'MCP 连接' })
  const client = mcp.getByLabel('MCP 客户端', { exact: true })
  const configurations = new Map<string, string>()
  for (const [name, file] of [
    ['codex', '~/.codex/config.toml'],
    ['claude-code', '.mcp.json'],
    ['claude-desktop', 'claude_desktop_config.json'],
  ]) {
    await selectUiValue(client, name!)
    await expect(mcp.locator('textarea')).toHaveCount(0)
    await mcp.getByRole('button', { name: '显示连接配置' }).click()
    const field = mcp.getByLabel('客户端连接配置')
    const configuration = await field.inputValue()
    configurations.set(name!, configuration)
    expect(configuration).not.toMatch(/Authorization|Bearer|43123/)
    expect(configuration).toContain('--mcp-stdio')
    await expect(mcp).toContainText(file!)
    if (name === 'codex') expect(configuration).toContain('[mcp_servers.repeaty]')
    else
      expect(JSON.parse(configuration).mcpServers.repeaty.args).toEqual([
        '--mcp-stdio',
        '--connection-file',
        '/test/Repeaty 用户/mcp.connection.json',
      ])
    expect(
      await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16)
    await mcp.getByRole('button', { name: '复制配置' }).click()
    await expect(mcp.getByRole('button', { name: '已复制' })).toBeVisible()
    // Windows clipboard text uses CRLF; textarea values use LF on every platform.
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
      configuration,
    )
  }
  await mcp.getByRole('button', { name: '隐藏连接配置' }).click()
  await expect(mcp.locator('textarea')).toHaveCount(0)
  await mcp.getByRole('button', { name: '开启 MCP' }).click()
  await mcp.getByRole('button', { name: '显示连接配置' }).click()
  expect(await mcp.getByLabel('客户端连接配置').inputValue()).toBe(
    configurations.get('claude-desktop'),
  )
  await mcp.getByRole('button', { name: '关闭 MCP' }).click()
  await expect(mcp.locator('textarea')).toHaveCount(0)
  await selectUiValue(client, 'http')
  await expect(mcp.getByRole('button', { name: '显示连接配置' })).toHaveCount(0)
  await page.reload()
  await setInterfaceLanguage(page, 'en')
  await openSettings(page, 'connections.mcp')
  await page.setViewportSize({ width: 390, height: 844 })
  const englishMcp = page.getByRole('region', { name: 'MCP connection' })
  await expect(englishMcp.getByRole('status')).toHaveText('Disabled')
  await englishMcp.getByRole('button', { name: 'Show connection configuration' }).click()
  expect(await englishMcp.getByLabel('Client configuration').inputValue()).toBe(
    configurations.get('codex'),
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mcp-clients-narrow-en.png'), fullPage: true })
})
