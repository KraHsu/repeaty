import { expect, type Page } from '@playwright/test'

export async function openSettings(page: Page, category = 'general') {
  await page
    .locator('.main-nav')
    .getByRole('button', { name: /^(设置|Settings)$/ })
    .click()
  await page.locator('.settings-categories').locator(`[data-category-key="${category}"]`).click()
}

// Entering Settings follows the same navigation rules as any other sidebar item.
// Callers explicitly reopen the view or dialog they want to inspect afterwards.
export async function setInterfaceLanguage(page: Page, language: 'zh-CN' | 'en') {
  await openSettings(page)
  await page
    .getByRole('combobox', { name: /^(界面语言|Interface language)$/ })
    .selectOption(language)
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

export async function openPluginSettings(page: Page, pluginId = 'review-history') {
  await openPluginManager(page)
  await page
    .locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)
    .getByRole('button', { name: /^(配置插件|Configure plugin)$/ })
    .click()
}

export async function openPluginManager(page: Page) {
  await openSettings(page, 'plugins')
}
