import { expect, type Page } from '@playwright/test'

/** Source-offset scenarios explicitly select raw text; Markdown otherwise opens in preview. */
export async function showSourceText(page: Page) {
  await expect(page.locator('.source-text, .source-markdown-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  if (await page.locator('.source-markdown-preview').isVisible())
    await page
      .locator('.source-reader')
      .getByRole('button', { name: /^(查看 Markdown 原文|View Markdown source)$/ })
      .click()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
}

export async function showSourceFilters(page: Page) {
  const region = page.locator('.source-filters')
  if (await region.isVisible()) return
  const toggle = page.getByRole('button', { name: /^(筛选材料|Filter materials)$/ })
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(page.locator('.source-filters')).toBeVisible()
}

export async function showSourceSelection(page: Page) {
  if (await page.locator('.source-selection-toolbar').isVisible()) return
  const toggle = page.getByRole('button', { name: /^(批量选择|Select multiple)$/ })
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(page.locator('.source-selection-toolbar')).toBeVisible()
}
