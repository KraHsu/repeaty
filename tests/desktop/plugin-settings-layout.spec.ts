import { test, expect, storedLibrary } from './fixture'
import {
  openPluginManager,
  openPluginSettings,
  openSettings,
  selectPlugin,
  setInterfaceLanguage,
} from '../fixtures/settings-flow'
import type { Locator, Page } from '@playwright/test'

async function savedHistoryPreferences(page: Page) {
  return page.evaluate(async () => {
    const { invoke } = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__
    const { active } = (await invoke('workspace_status')) as { active: { token: string } }
    const value = await invoke('workspace_read', {
      token: active.token,
      request: { type: 'value', namespace: 'settings', id: 'plugin:review-history:preferences' },
    })
    return JSON.parse(typeof value === 'string' ? value : '{}') as Record<string, unknown>
  })
}
async function fits(page: Page, cards: Locator[]) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  for (const card of cards)
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
}
const category = (page: Page, key: string) =>
  page.locator(`.settings-categories [data-category-key="${key}"]`)

for (const language of ['zh-CN', 'en'] as const) {
  test(`application and plugin settings share subject categories and preserve preferences (${language})`, async ({
    page,
  }, info) => {
    const labels =
      language === 'en'
        ? {
            history: 'Review history',
            length: 'Number of ratings',
            reveal: 'Show history after revealing the answer',
            china: 'China',
            chinaRegion: 'China · leetcode.cn',
            international: 'International',
            internationalRegion: 'International · leetcode.com',
            unconfigured: 'Credentials not configured',
            configure: 'Configure plugin',
            enableHistory: 'Enable Review history',
          }
        : {
            history: '答题历史',
            length: '显示条数',
            reveal: '翻面后才显示历史',
            china: '中国站',
            chinaRegion: '中国站 · leetcode.cn',
            international: '国际站',
            internationalRegion: '国际站 · leetcode.com',
            unconfigured: '未配置登录信息',
            configure: '配置插件',
            enableHistory: '启用 答题历史',
          }
    await page.setViewportSize({ width: 1280, height: 950 })
    await setInterfaceLanguage(page, language)
    const before = await storedLibrary(page)
    await openPluginManager(page)
    const dismiss = page.getByRole('button', { name: /^(关闭提示|Dismiss notification)$/ })
    while (await dismiss.count()) await dismiss.first().click()
    const pluginNavigation = page
      .locator('.main-nav')
      .getByRole('button', { name: /^(插件|Plugins)$/ })
    await expect(pluginNavigation).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.settings-categories')).toHaveCount(0)
    const historyDetails = page.locator('.plugin-settings[data-plugin-id="review-history"]')
    const leetcodeDetails = page.locator('.plugin-settings[data-plugin-id="leetcode"]')
    for (const [id, details] of [
      ['review-history', historyDetails],
      ['leetcode', leetcodeDetails],
    ] as const) {
      await selectPlugin(page, id)
      await expect(details.locator(':scope > [data-slot="header"] h2')).toHaveCSS(
        'font-size',
        '24px',
      )
      await expect(details.locator('dl')).toBeVisible()
      await expect(details.getByRole('spinbutton')).toHaveCount(0)
      await expect(details.locator('input[type=password]')).toHaveCount(0)
      await expect(details.locator('.plugin-readme-trigger')).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      await fits(page, [details])
    }
    await expect(leetcodeDetails.locator('.plugin-readme')).toContainText('LEETCODE_SESSION')
    await expect(leetcodeDetails.locator('input[type=password]')).toHaveCount(0)
    await leetcodeDetails.locator('.plugin-readme-trigger').click()
    await fits(page, [leetcodeDetails])
    await page.screenshot({ path: info.outputPath('plugin-management.png') })
    await selectPlugin(page, 'review-history')
    await historyDetails.getByRole('button', { name: labels.configure, exact: true }).click()
    const navigation = page.getByRole('tree', { name: /^(设置分类|Settings categories)$/ })
    await expect(navigation).toBeVisible()
    await expect(navigation.locator('[data-category-key="plugins"]')).toHaveCount(0)
    const navigationBox = (await navigation.boundingBox())!
    const contentBox = (await page.locator('.settings-panel').boundingBox())!
    expect(navigationBox.x + navigationBox.width).toBeLessThanOrEqual(contentBox.x)
    const history = page.locator('.settings-configuration[data-plugin-id="review-history"]')
    const leetcode = page.locator('.settings-configuration[data-plugin-id="leetcode"]')
    await expect(category(page, 'study.review')).toHaveAttribute('aria-selected', 'true')
    await expect(history).toBeFocused()
    await expect(leetcode).toHaveCount(0)
    const length = history.getByRole('spinbutton', { name: labels.length, exact: true })
    await length.fill('7')
    await length.press('Tab')
    await history.getByRole('switch', { name: labels.reveal, exact: true }).uncheck()
    await expect
      .poll(() => savedHistoryPreferences(page))
      .toMatchObject({ historyLength: 7, historyAfterReveal: false })
    expect(await storedLibrary(page)).toEqual(before)
    const captureStyle = '.desktop-titlebar { visibility: hidden !important; }'
    await history.screenshot({
      path: info.outputPath('plugin-history-1280.png'),
      style: captureStyle,
    })
    await category(page, 'study').click()
    await expect(length).toHaveValue('7')
    await category(page, 'general').click()
    await expect(
      page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }),
    ).toBeVisible()
    await expect(page.getByRole('switch', { name: /^(信息通知|Information)$/ })).toBeVisible()
    await expect(history).toHaveCount(0)
    await category(page, 'connections').click()
    await expect(page.getByRole('region', { name: /^(MCP 连接|MCP connection)$/ })).toBeVisible()
    await expect(leetcode).toBeVisible()
    await category(page, 'connections.mcp').click()
    await expect(leetcode).toHaveCount(0)
    await category(page, 'connections.leetcode').click()
    const china = leetcode.getByRole('region', { name: labels.chinaRegion, exact: true })
    const international = leetcode.getByRole('region', {
      name: labels.internationalRegion,
      exact: true,
    })
    await expect(china.getByRole('heading', { level: 3 })).toHaveText(labels.china)
    await expect(international.getByRole('heading', { level: 3 })).toHaveText(labels.international)
    await expect(leetcode.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '18px')
    await expect(leetcode.locator('.ui-setting-group__description')).toHaveCSS('font-size', '14px')
    for (const site of [china, international]) {
      await expect(site.getByRole('heading', { level: 3 })).toHaveCSS('font-size', '16px')
      await expect(site.getByRole('status')).toContainText(labels.unconfigured)
      await expect(site.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveAttribute(
        'type',
        'password',
      )
      await expect(site.getByLabel('csrftoken', { exact: true })).toHaveAttribute(
        'type',
        'password',
      )
      expect(
        await site
          .getByLabel('csrftoken', { exact: true })
          .evaluate(
            (input) => getComputedStyle(input.closest('.ui-setting-field')!).borderTopStyle,
          ),
      ).toBe('none')
      await expect(site.locator('details')).toHaveCount(0)
    }
    await fits(page, [leetcode])
    await leetcode.screenshot({
      path: info.outputPath('plugin-leetcode-1280.png'),
      style: captureStyle,
    })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    try {
      await fits(page, [leetcode])
      await expect(
        leetcode.getByRole('button', { name: /^(插件说明|Plugin documentation)$/ }),
      ).toHaveCSS('font-size', '32px')
      await page.screenshot({
        path: info.outputPath('plugin-settings-font-200.png'),
        style: captureStyle,
      })
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('font-size')
      })
    }
    await leetcode.getByRole('button', { name: /^(插件说明|Plugin documentation)$/ }).click()
    await expect(pluginNavigation).toHaveAttribute('aria-current', 'page')
    await expect(navigation).toHaveCount(0)
    await expect(leetcodeDetails.locator('.plugin-readme-trigger')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(leetcodeDetails.locator('.plugin-readme-trigger')).toBeFocused()
    await expect(leetcodeDetails.locator('input[type=password]')).toHaveCount(0)
    await page.reload()
    await openPluginSettings(page)
    await expect(length).toHaveValue('7')
    await expect(
      history.getByRole('switch', { name: labels.reveal, exact: true }),
    ).not.toBeChecked()
    await page.setViewportSize({ width: 500, height: 750 })
    await fits(page, [history])
    await history.screenshot({
      path: info.outputPath('plugin-history-500.png'),
      style: captureStyle,
    })
    await openPluginSettings(page, 'leetcode')
    await fits(page, [leetcode])
    await china.screenshot({
      path: info.outputPath('plugin-leetcode-cn-500.png'),
      style: captureStyle,
    })
    await openPluginManager(page)
    await selectPlugin(page, 'review-history')
    await historyDetails.getByRole('switch', { name: labels.enableHistory, exact: true }).click()
    await expect(
      historyDetails.getByRole('switch', { name: labels.enableHistory, exact: true }),
    ).not.toBeChecked()
    await openSettings(page)
    await expect(history).toHaveCount(0)
    await expect(category(page, 'study.review')).toHaveCount(0)
    await openPluginManager(page)
    await selectPlugin(page, 'review-history')
    await historyDetails.getByRole('switch', { name: labels.enableHistory, exact: true }).click()
    await expect(
      historyDetails.getByRole('switch', { name: labels.enableHistory, exact: true }),
    ).toBeChecked()
    await openPluginSettings(page)
    await expect(length).toHaveValue('7')
    await expect(
      history.getByRole('switch', { name: labels.reveal, exact: true }),
    ).not.toBeChecked()
    expect(await storedLibrary(page)).toEqual(before)
  })
}
