import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
export async function storedLibrary(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('repeaty')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    try {
      const result: Record<string, unknown> = {}
      for (const key of [
        'decks',
        'notes',
        'cards',
        'reviews',
        'media',
        'savedSearches',
        'practices',
        'attempts',
      ]) {
        result[key] = await new Promise((resolve, reject) => {
          const r = db.transaction(key).objectStore(key).getAll()
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
      }
      return result
    } finally {
      db.close()
    }
  })
}
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
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
          value: {
            invoke: async (command: string, args: Record<string, unknown>) => {
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
