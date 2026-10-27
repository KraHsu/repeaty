import { expect, type Page } from '@playwright/test'

export async function openSettings(page: Page, tab: 'general' | 'plugins' = 'general') {
  await page
    .locator('.main-nav')
    .getByRole('button', { name: /^(设置|Settings)$/ })
    .click()
  await page
    .getByRole('tab', { name: tab === 'plugins' ? /^(插件|Plugins)$/ : /^(通用|General)$/ })
    .click()
}

// Entering Settings follows the same navigation rules as any other sidebar item.
// Callers explicitly reopen the view or dialog they want to inspect afterwards.
export async function setInterfaceLanguage(page: Page, language: 'zh-CN' | 'en') {
  await openSettings(page)
  await page.locator('#settings-language').selectOption(language)
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

export async function openPluginSettings(page: Page) {
  await openSettings(page, 'plugins')
}
