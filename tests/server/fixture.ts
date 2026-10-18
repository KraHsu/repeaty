import { test as base, expect } from '@playwright/test'
export const headers: Record<string, string> = { 'X-Repeaty-Client': '1' }
export const test = base.extend<{ resetWorkspace: void }>({
  resetWorkspace: [
    async ({ context, request }, use) => {
      const response = await request.post('api/auth/register', {
        headers: { 'X-Repeaty-Client': '1' },
        data: {
          username: `test-${crypto.randomUUID().slice(0, 20)}`,
          password: 'test-account-password',
        },
      })
      expect(response.ok()).toBe(true)
      const { user } = await response.json()
      headers['X-Repeaty-User'] = user.id
      await context.addCookies((await request.storageState()).cookies)
      // Existing-library scenarios explicitly start after removing all cards.
      const saved = await request.post('api/library/commit', {
        headers,
        data: { expectedRevision: 0, patches: [] },
      })
      expect(saved.ok()).toBe(true)
      await use()
    },
    { auto: true },
  ],
})
export { expect }
