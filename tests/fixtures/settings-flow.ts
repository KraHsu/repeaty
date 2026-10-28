import { expect, type Locator, type Page } from '@playwright/test'
import { selectUiValue as chooseUiValue } from './ui-flow'

export async function selectUiOption(page: Page, control: Locator, label: string | RegExp) {
  if (typeof label === 'string') return chooseUiValue(control, { label })
  await control.click()
  await page.getByRole('option', { name: label, exact: typeof label === 'string' }).click()
}
export function uiOption(page: Page, value: string) {
  return page
    .getByRole('option')
    .filter({ has: page.locator(`[data-select-value=${JSON.stringify(value)}]`) })
}
export async function selectUiValue(_page: Page, control: Locator, value: string) {
  await chooseUiValue(control, value)
}

export async function confirmPluginAction(page: Page) {
  const confirmation = page
    .getByRole('dialog')
    .filter({ has: page.locator('[data-plugin-confirm]') })
  await confirmation.locator('[data-plugin-confirm]').click()
  await expect(confirmation).toHaveCount(0)
}

export async function openSettings(page: Page, category = 'general') {
  await page
    .locator('.main-nav')
    .getByRole('button', { name: /^(设置|Settings)$/ })
    .click()
  await selectSettingsCategory(page, category)
}

export async function selectSettingsCategory(page: Page, category: string) {
  // Navigation mounts Settings asynchronously; inspect its responsive controls only
  // after that page exists, otherwise isVisible() can choose the wrong layout.
  await expect(page.locator('.settings-page')).toBeVisible()
  const compactCategory = page.locator('.settings-mobile-category').getByRole('combobox')
  if (await compactCategory.isVisible()) {
    await chooseUiValue(compactCategory, category)
    await expect(compactCategory).toHaveAttribute('value', category)
    return
  }
  const navigation = page.getByRole('tree', { name: /^(设置分类|Settings categories)$/ })
  const segments = category.split('.')
  for (let depth = 1; depth < segments.length; depth++) {
    const ancestor = navigation.locator(
      `[data-category-key="${segments.slice(0, depth).join('.')}"]`,
    )
    if ((await ancestor.getAttribute('aria-expanded')) === 'false') {
      await ancestor.focus()
      await ancestor.press('ArrowRight')
      await expect(ancestor).toHaveAttribute('aria-expanded', 'true')
    }
  }
  const target = navigation.locator(`[data-category-key="${category}"]`)
  await target.click()
  await expect(target).toHaveAttribute('aria-selected', 'true')
}

// Entering Settings follows the same navigation rules as any other sidebar item.
// Callers explicitly reopen the view or dialog they want to inspect afterwards.
export async function setInterfaceLanguage(page: Page, language: 'zh-CN' | 'en') {
  await openSettings(page)
  await selectUiOption(
    page,
    page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }),
    language === 'en' ? 'English' : '中文（简体）',
  )
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

export async function openPluginSettings(page: Page, pluginId = 'review-history') {
  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await page
    .locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)
    .getByRole('button', { name: /^(配置插件|Configure plugin)$/ })
    .click()
}

export async function selectPlugin(page: Page, pluginId: string) {
  const item = page.locator(`.plugin-directory-item[data-plugin-select="${pluginId}"]`)
  await item.click()
  await expect(item).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)).toBeVisible()
}

export async function openPluginManager(page: Page) {
  await page
    .locator('.main-nav')
    .getByRole('button', { name: /^(插件|Plugins)$/ })
    .click()
}
