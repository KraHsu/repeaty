import { test as base, expect } from '@playwright/test'
export { storedLibrary } from '../fixtures/stored-library'
export const test = base.extend<{ native: void; emptyWorkspace: void }>({
  native: [
    async ({ context }, use) => {
      let configured: string[] = []
      await context.route('**/__native/leetcode', (route) => {
        const request = route.request().postDataJSON()
        return route.fulfill({
          json:
            request.action === 'account'
              ? {
                  site: request.site,
                  state: configured.includes(request.site) ? 'authenticated' : 'unconfigured',
                  ...(configured.includes(request.site)
                    ? { username: request.site === 'leetcode.cn' ? 'tester-cn' : 'tester-com' }
                    : {}),
                }
              : { version: 1, configured },
        })
      })
      await context.route('**/__native/leetcode/credentials', (route) => {
        const { site, action } = route.request().postDataJSON()
        configured = configured.filter((s) => s !== site)
        if (action === 'save') configured.push(site)
        return route.fulfill({ json: { configured } })
      })
      // Only this test harness emulates IPC over intercepted URLs. Production uses invoke().
      await context.addInitScript(() => {
        let exporting: { filename: string; chunks: Uint8Array[] } | undefined
        let callbackId = 0,
          mcpEnabled = false,
          mcpAvailable = false,
          mcpScope = '',
          mcpEpoch = 0,
          mcpSequence = 0,
          mcpKey = 0,
          requestId = 0
        let channel: { onmessage(request: unknown): void } | undefined
        const pending = new Map<string, (value: unknown) => void>()
        Object.defineProperty(window, '__repeatyTestMcpFailReply', { value: false, writable: true })
        const status = () => ({
          enabled: mcpEnabled,
          available: mcpAvailable,
          url: mcpEnabled ? 'http://127.0.0.1:43123/mcp' : null,
        })
        Object.defineProperty(window, '__repeatyTestMcpCall', {
          value: (tool: string, args: Record<string, unknown>, scope = mcpScope) => {
            if (!mcpEnabled || !channel) throw new Error('not-enabled')
            const id = `test-read-${++requestId}`
            return new Promise((resolve) => {
              pending.set(id, resolve)
              channel!.onmessage({ id, scope, query: { tool, arguments: args } })
            })
          },
        })
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
          value: {
            transformCallback: () => ++callbackId,
            unregisterCallback: () => {},
            invoke: async (command: string, args: Record<string, unknown>) => {
              if (command === 'mcp_attach') {
                channel = args.onRequest as typeof channel
                mcpEnabled = false
                mcpSequence = 0
                return 'test-attachment'
              }
              if (command === 'mcp_workspace') {
                const workspace = args.workspace as {
                  scope: string
                  scopeEpoch: number
                  sequence: number
                  available: boolean
                }
                if (workspace.sequence <= mcpSequence) return
                if (workspace.scope !== mcpScope || workspace.scopeEpoch !== mcpEpoch)
                  mcpEnabled = false
                mcpScope = workspace.scope
                mcpEpoch = workspace.scopeEpoch
                mcpSequence = workspace.sequence
                mcpAvailable = workspace.available && mcpScope.startsWith('local:')
                return
              }
              if (command === 'mcp_status') return status()
              if (command === 'mcp_start') {
                if (!mcpAvailable) throw 'library-unavailable'
                mcpEnabled = true
                mcpKey++
                return status()
              }
              if (command === 'mcp_stop') {
                mcpEnabled = false
                return status()
              }
              if (command === 'mcp_client_configuration') {
                if (args.client === 'http') {
                  if (!mcpEnabled) throw 'library-unavailable'
                  return JSON.stringify(
                    {
                      mcpServers: {
                        repeaty: {
                          type: 'http',
                          url: status().url,
                          headers: { Authorization: `Bearer test-key-${mcpKey}` },
                        },
                      },
                    },
                    null,
                    2,
                  )
                }
                const command = '/test/Repeaty 用户/repeaty-desktop'
                const params = [
                  '--mcp-stdio',
                  '--connection-file',
                  '/test/Repeaty 用户/mcp.connection.json',
                ]
                if (args.client === 'codex')
                  return `[mcp_servers.repeaty]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(params)}\n`
                return JSON.stringify(
                  { mcpServers: { repeaty: { command, args: params } } },
                  null,
                  2,
                )
              }
              if (command === 'mcp_configuration') {
                if (!mcpEnabled) throw 'library-unavailable'
                return {
                  mcpServers: {
                    repeaty: {
                      type: 'http',
                      url: status().url,
                      headers: { Authorization: `Bearer test-key-${mcpKey}` },
                    },
                  },
                }
              }
              if (command === 'mcp_reply') {
                if (
                  (window as unknown as { __repeatyTestMcpFailReply: boolean })
                    .__repeatyTestMcpFailReply
                ) {
                  pending.get(args.id as string)?.({ status: 'error', code: 'read-timeout' })
                  pending.delete(args.id as string)
                  throw 'library-unavailable'
                }
                pending.get(args.id as string)?.(args.reply)
                pending.delete(args.id as string)
                return
              }
              if (command === 'export_begin') {
                exporting = { filename: args.filename as string, chunks: [] }
                return 'test-export'
              }
              if (command === 'export_write') {
                exporting!.chunks.push(
                  Uint8Array.from(atob(args.chunk as string), (c) => c.charCodeAt(0)),
                )
                return
              }
              if (command === 'export_cancel') {
                exporting = undefined
                return
              }
              if (command === 'export_finish') {
                const link = document.createElement('a')
                link.href = URL.createObjectURL(new Blob(exporting!.chunks as BlobPart[]))
                link.download = exporting!.filename
                link.click()
                exporting = undefined
                return
              }
              if (command === 'desktop_config')
                return { endpoint: localStorage.getItem('test.endpoint') ?? '' }
              if (command === 'set_endpoint') {
                localStorage.setItem('test.endpoint', args.endpoint as string)
                return
              }
              if (command === 'open_external') {
                window.open(args.url as string, '_blank')
                return
              }
              if (command === 'local_plugin') {
                const response = await fetch(
                  `/__native/${args.id}${args.operation === 'credentials' ? '/credentials' : ''}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(args.payload),
                  },
                )
                const value = await response.json()
                if (!response.ok) throw value.error
                return value
              }
              if (command === 'upstream_request') throw 'request-failed'
              throw `Unexpected command: ${command}`
            },
          },
        })
      })
      await use()
    },
    { auto: true },
  ],
  emptyWorkspace: [
    async ({ page, native: _native }, use) => {
      await page.goto('./')
      await page.locator('.deck-title').click()
      await page.getByRole('button', { name: '删除当前卡组' }).click()
      await page.getByRole('button', { name: '确认删除', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await use()
    },
    { auto: true },
  ],
})
export { expect }
