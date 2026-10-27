import { test as base, expect } from '@playwright/test'
import { workspaceRuntime } from '../fixtures/workspace-runtime'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installPluginHostFixture } from '../fixtures/plugin-host'
export { storedLibrary } from '../fixtures/stored-library'
export const test = base.extend<{ native: void; emptyWorkspace: void }>({
  native: [
    async ({ context }, use) => {
      const root = await mkdtemp(join(tmpdir(), 'repeaty-browser-workspace-'))
      const path = join(root, 'library')
      await mkdir(path)
      const runtime = workspaceRuntime(join(root, 'device'))
      const status = await runtime.call<{ epoch: string }>('workspace_status')
      await runtime.call('workspace_choose', { epoch: status.epoch, mode: 'create', path })
      await installPluginHostFixture(context, runtime, root)
      let choices = 0
      await context.exposeBinding(
        '__repeatyWorkspace',
        async (_, command: string, args: Record<string, unknown> = {}) => {
          if (command === 'workspace_choose') {
            const path = join(root, 'chosen-' + ++choices)
            await mkdir(path)
            return runtime.call(command, { ...args, path })
          }
          return runtime.call(command, args)
        },
      )
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
        let watchId = 0
        let watching: { id: string; timer: ReturnType<typeof setInterval> } | undefined
        const pending = new Map<string, (value: unknown) => void>()
        const callbacks = new Map<number, (value: unknown) => void>()
        const listeners = new Map<number, { event: string; callback: number }>()
        let listenerId = 0
        const desktopWindow = {
          maximized: false,
          focused: true,
          calls: [] as string[],
          failNext: '',
          update(state: { maximized?: boolean; focused?: boolean }) {
            if (state.maximized !== undefined) {
              desktopWindow.maximized = state.maximized
              emitWindowEvent('tauri://resize', { width: innerWidth, height: innerHeight })
            }
            if (state.focused !== undefined) {
              desktopWindow.focused = state.focused
              emitWindowEvent(state.focused ? 'tauri://focus' : 'tauri://blur', null)
            }
          },
        }
        function emitWindowEvent(event: string, payload: unknown) {
          for (const [id, listener] of listeners)
            if (listener.event === event) callbacks.get(listener.callback)?.({ event, id, payload })
        }
        Object.defineProperty(window, '__repeatyTestWindow', { value: desktopWindow })
        Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
          value: {
            unregisterListener: (_event: string, id: number) => {
              const listener = listeners.get(id)
              if (listener) callbacks.delete(listener.callback)
              listeners.delete(id)
            },
          },
        })
        Object.defineProperty(window, '__repeatyTestMcpFailReply', { value: false, writable: true })
        Object.defineProperty(window, '__repeatyTestDropWatchEvents', {
          value: false,
          writable: true,
        })
        Object.defineProperty(window, '__repeatyTestDroppedWatchEvents', {
          value: 0,
          writable: true,
        })
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
            metadata: {
              currentWindow: { label: 'main' },
              currentWebview: { label: 'main', windowLabel: 'main' },
            },
            transformCallback: (callback: (value: unknown) => void, once = false) => {
              const id = ++callbackId
              callbacks.set(id, (value) => {
                if (once) callbacks.delete(id)
                callback(value)
              })
              return id
            },
            unregisterCallback: (id: number) => callbacks.delete(id),
            invoke: async (command: string, args: Record<string, unknown>) => {
              if (command === 'plugin:event|listen') {
                const id = ++listenerId
                listeners.set(id, { event: args.event as string, callback: args.handler as number })
                return id
              }
              if (command === 'plugin:event|unlisten') {
                listeners.delete(args.eventId as number)
                return
              }
              if (command.startsWith('plugin:window|')) {
                const action = command.slice('plugin:window|'.length)
                if (args.label !== 'main') throw Error('Unexpected window label')
                if (action === 'is_maximized') return desktopWindow.maximized
                if (action === 'is_focused') return desktopWindow.focused
                if (action === 'is_fullscreen') return false
                desktopWindow.calls.push(action)
                if (desktopWindow.failNext === action) {
                  desktopWindow.failNext = ''
                  throw Error('test-window-operation-failed')
                }
                if (action === 'toggle_maximize')
                  desktopWindow.update({ maximized: !desktopWindow.maximized })
                else if (!['minimize', 'close', 'start_dragging'].includes(action))
                  throw Error(`Unexpected window operation: ${action}`)
                // This fixture records requests only; it never controls an OS window.
                return
              }
              if (command === 'workspace_watch') {
                if (watching) clearInterval(watching.timer)
                const id = 'watch-' + ++watchId
                const listener = args.onChange as { onmessage(event: unknown): void }
                let waiting = false
                const timer = setInterval(async () => {
                  if (waiting || watching?.id !== id) return
                  waiting = true
                  try {
                    const value = await (
                      window as unknown as {
                        __repeatyWorkspace(command: string, args: unknown): Promise<unknown>
                      }
                    ).__repeatyWorkspace('workspace_changes', { token: args.token })
                    if (value && watching?.id === id) {
                      const controls = window as unknown as {
                        __repeatyTestDropWatchEvents: boolean
                        __repeatyTestDroppedWatchEvents: number
                      }
                      if (controls.__repeatyTestDropWatchEvents)
                        controls.__repeatyTestDroppedWatchEvents++
                      else listener.onmessage(value)
                    }
                  } catch {
                    clearInterval(timer)
                  } finally {
                    waiting = false
                  }
                }, 100)
                watching = { id, timer }
                return id
              }
              if (command === 'workspace_unwatch') {
                if (watching && watching.id === args.id) {
                  clearInterval(watching.timer)
                  watching = undefined
                }
                return
              }
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
              if (command === 'workspace_write') {
                const request = args.request as {
                  type: string
                  input?: { consumeCardDraft?: string }
                }
                const flags = window as unknown as Record<string, boolean>
                if (
                  (flags.failDraftSave &&
                    request.type === 'commit' &&
                    request.input?.consumeCardDraft) ||
                  (flags.failDraftAdd && request.type === 'draft-add') ||
                  (flags.failDraftEdit && request.type === 'draft-update') ||
                  (flags.failDraftDiscard && request.type === 'draft-remove')
                )
                  throw 'storage-error'
              }
              if (command.startsWith('workspace_'))
                return (
                  window as unknown as {
                    __repeatyWorkspace(
                      command: string,
                      args: Record<string, unknown>,
                    ): Promise<unknown>
                  }
                ).__repeatyWorkspace(command, args)
              if (command === 'open_external') {
                window.open(args.url as string, '_blank')
                return
              }
              if (command === 'plugin_host')
                return (
                  window as unknown as {
                    __repeatyPluginInvoke(args: Record<string, unknown>): Promise<unknown>
                  }
                ).__repeatyPluginInvoke(args)
              throw `Unexpected command: ${command}`
            },
          },
        })
      })
      try {
        await use()
      } finally {
        // Stop browser watchers before ending the native host's input stream.
        await context.close()
        await runtime.close()
        await rm(root, { recursive: true, force: true })
      }
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
