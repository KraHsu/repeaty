import { test as base, expect } from '@playwright/test'

/** Existing-library scenarios start after the user has removed the welcome deck. */
export const test = base.extend<{ emptyWorkspace: void }>({
  emptyWorkspace: [
    async ({ page }, use) => {
      await page.goto('./')
      await page.locator('.deck-title').click()
      await page.getByRole('button', { name: /^(删除当前卡组|Delete current deck)$/ }).click()
      await page.getByRole('button', { name: /^(确认删除|Confirm delete)$/ }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await use()
    },
    { auto: true },
  ],
})
export { expect }
