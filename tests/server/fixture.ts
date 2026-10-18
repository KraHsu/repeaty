import { test as base, expect } from '@playwright/test'
import type { Library } from '../../src/core/model'
export const token = 'repeaty-test-access-key-123456789'
export const headers = { 'X-Repeaty-Client': '1', Authorization: `Bearer ${token}` }
export const test = base.extend<{ resetWorkspace: void }>({
  resetWorkspace: [
    async ({ request }, use) => {
      const response = await request.get('api/library', { headers })
      expect(response.ok()).toBe(true)
      const snapshot: { revision: number; library: Library } = await response.json()
      const patches = (
        ['decks', 'notes', 'cards', 'reviews', 'media', 'savedSearches'] as const
      ).flatMap((store) => snapshot.library[store].map((value) => ({ store, id: value.id })))
      const result = await request.post('api/library/commit', {
        headers,
        data: { expectedRevision: snapshot.revision, patches },
      })
      expect(result.ok()).toBe(true)
      for (const site of ['leetcode.cn', 'leetcode.com']) {
        const cleared = await request.post('api/plugins/leetcode/credentials', {
          headers,
          data: { action: 'clear', site },
        })
        expect(cleared.ok()).toBe(true)
      }
      await use()
    },
    { auto: true },
  ],
  context: async ({ context }, use) => {
    await context.addInitScript((key) => sessionStorage.setItem('repeaty.server.token', key), token)
    await use(context)
  },
})
export { expect }
