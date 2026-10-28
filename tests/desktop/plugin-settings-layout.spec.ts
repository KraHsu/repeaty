import { test, expect, storedLibrary } from './fixture'
import {
  openPluginManager,
  openPluginSettings,
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

for (const language of ['zh-CN', 'en'] as const) {
  test(`plugin details stay separate from registered settings and retain preferences (${language})`, async ({
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
            help: 'Where do I find these values?',
            docs: 'Full setup guide',
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
            help: '在哪里找到这两个值？',
            docs: '完整配置文档',
            configure: '配置插件',
            enableHistory: '启用 答题历史',
          }
    await page.setViewportSize({ width: 1280, height: 950 })
    await setInterfaceLanguage(page, language)
    const before = await storedLibrary(page)
    await openPluginManager(page)
    const dismiss = page.getByRole('button', { name: /^(关闭提示|Dismiss notification)$/ })
    while (await dismiss.count()) await dismiss.first().click()
    const historyDetails = page.locator('.plugin-settings').filter({
      has: page.getByRole('heading', { name: labels.history, exact: true, level: 2 }),
    })
    const leetcodeDetails = page.locator('.plugin-settings').filter({
      has: page.getByRole('heading', { name: 'LeetCode', exact: true, level: 2 }),
    })
    for (const details of [historyDetails, leetcodeDetails]) {
      await expect(details.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '20px')
      await expect(details.locator('dl')).toBeVisible()
      await expect(details.getByRole('spinbutton')).toHaveCount(0)
      await expect(details.locator('input[type=password]')).toHaveCount(0)
    }
    await expect(page.locator('.plugin-configuration')).toHaveCount(0)
    await fits(page, [historyDetails, leetcodeDetails])
    await page.screenshot({ path: info.outputPath('plugin-management.png') })
    await historyDetails.getByRole('button', { name: labels.configure, exact: true }).click()
    const history = page.locator('.plugin-configuration[data-plugin-id="review-history"]')
    const leetcode = page.locator('.plugin-configuration[data-plugin-id="leetcode"]')
    await expect(page.getByRole('tab', { name: /^(插件设置|Plugin settings)$/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(history).toBeFocused()
    await expect(page.locator('.plugin-settings')).toHaveCount(0)
    const china = leetcode.getByRole('region', { name: labels.chinaRegion, exact: true })
    const international = leetcode.getByRole('region', {
      name: labels.internationalRegion,
      exact: true,
    })
    await expect(china.getByRole('heading', { level: 3 })).toHaveText(labels.china)
    await expect(international.getByRole('heading', { level: 3 })).toHaveText(labels.international)
    for (const card of [history, leetcode]) {
      await expect(card.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '20px')
      await expect(card.locator('.ui-setting-group__description')).toHaveCSS('font-size', '14px')
    }
    for (const section of [china, international]) {
      await expect(section.getByRole('heading', { level: 3 })).toHaveCSS('font-size', '16px')
      await expect(section.locator('.ui-setting-section__description')).toHaveCSS(
        'font-size',
        '14px',
      )
    }
    for (const site of [china, international]) {
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
        await site.getByLabel('csrftoken', { exact: true }).evaluate((input) => {
          const field = input.closest('.ui-setting-field')!
          return getComputedStyle(field).borderTopStyle
        }),
      ).toBe('none')
      await expect(site.locator('details')).not.toHaveAttribute('open')
    }
    const help = china.locator('summary').filter({ hasText: labels.help })
    await help.click()
    await expect(china.getByRole('link', { name: labels.docs, exact: false })).toBeVisible()
    await help.click()
    await expect(china.locator('details')).not.toHaveAttribute('open')

    const length = history.getByRole('spinbutton', { name: labels.length, exact: true })
    await length.fill('7')
    await length.press('Tab')
    await history.getByRole('switch', { name: labels.reveal, exact: true }).uncheck()
    await expect
      .poll(() => savedHistoryPreferences(page))
      .toMatchObject({ historyLength: 7, historyAfterReveal: false })
    expect(await storedLibrary(page)).toEqual(before)
    await fits(page, [history, leetcode])
    const captureStyle = '.desktop-titlebar { visibility: hidden !important; }'
    await history.screenshot({
      path: info.outputPath('plugin-history-1280.png'),
      style: captureStyle,
    })
    await china.screenshot({
      path: info.outputPath('plugin-leetcode-cn-1280.png'),
      style: captureStyle,
    })
    await leetcode.screenshot({
      path: info.outputPath('plugin-leetcode-1280.png'),
      style: captureStyle,
    })

    await page.reload()
    await openPluginSettings(page)
    await expect(length).toHaveValue('7')
    await expect(
      history.getByRole('switch', { name: labels.reveal, exact: true }),
    ).not.toBeChecked()
    expect(await storedLibrary(page)).toEqual(before)
    await page.setViewportSize({ width: 500, height: 750 })
    await fits(page, [history, leetcode])
    await history.screenshot({
      path: info.outputPath('plugin-history-500.png'),
      style: captureStyle,
    })
    await china.screenshot({
      path: info.outputPath('plugin-leetcode-cn-500.png'),
      style: captureStyle,
    })
    await openPluginManager(page)
    await historyDetails.getByRole('switch', { name: labels.enableHistory, exact: true }).uncheck()
    await openPluginSettings(page)
    await expect(history).toHaveCount(0)
    await openPluginManager(page)
    await historyDetails.getByRole('switch', { name: labels.enableHistory, exact: true }).check()
    await openPluginSettings(page)
    await expect(length).toHaveValue('7')
    await expect(
      history.getByRole('switch', { name: labels.reveal, exact: true }),
    ).not.toBeChecked()
    expect(await storedLibrary(page)).toEqual(before)
  })
}
