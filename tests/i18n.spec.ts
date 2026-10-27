import { openSettings, setInterfaceLanguage } from './fixtures/settings-flow'
import { expect, test } from '@playwright/test'

test.use({ locale: 'en-US' })

for (const width of [320, 390, 768, 1440]) {
  test(`language controls remain usable at ${width}px and survive reload`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('.topbar select')).toHaveCount(0)
    await setInterfaceLanguage(page, 'zh-CN')
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await page.reload()
    await openSettings(page)
    await expect(page.getByLabel('界面语言')).toHaveValue('zh-CN')
    await setInterfaceLanguage(page, 'en')
    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Create deck', exact: true }).last(),
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
}

test('Settings language switching preserves authored cards and saved filters across navigation', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Create deck', exact: true }).last().click()
  await page.getByLabel('Deck name', { exact: true }).fill('我的卡组')
  await page.getByRole('button', { name: 'Save deck', exact: true }).click()
  await page.getByRole('button', { name: 'Add card', exact: true }).first().click()
  await page.getByLabel('Front · Question').fill('中文问题')
  await page.getByLabel('Back · Answer').fill('中文答案')
  await page.getByRole('button', { name: 'Save card', exact: true }).click()
  await page.getByText('Advanced search, saved filters & focused practice', { exact: true }).click()
  await page.getByLabel('Filter by status').selectOption({ label: 'New' })
  await page.getByLabel('Filter name').fill('我的筛选')
  await page.getByRole('button', { name: 'Save as new filter', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Filter saved')
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: /^全部卡片/ }).click()
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await page.getByLabel('常用筛选', { exact: true }).selectOption({ label: '我的筛选' })
  await expect(page.getByLabel('筛选状态')).toHaveValue('新卡片')
  await expect(page.getByLabel('筛选名称')).toHaveValue('我的筛选')
  await setInterfaceLanguage(page, 'en')
  await page.locator('.sidebar').getByRole('button', { name: '我的卡组', exact: true }).click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await expect(page.locator('.card-answer')).toContainText('中文答案')
  await setInterfaceLanguage(page, 'zh-CN')
  await expect(page.locator('.card-answer')).toHaveCount(0)
  await page.locator('.sidebar').getByRole('button', { name: '我的卡组', exact: true }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer')).toContainText('中文答案')
  await expect(page.getByRole('button', { name: /重来/ })).toBeVisible()
  await setInterfaceLanguage(page, 'en')
  await page.locator('.sidebar').getByRole('button', { name: '我的卡组', exact: true }).click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByRole('button', { name: 'Show answer', exact: true }).click()
  await page.getByRole('button', { name: /Easy/ }).click()
  await expect(page.getByRole('heading', { name: 'Review session finished' })).toBeVisible()
  await page.getByRole('button', { name: 'Undo last rating' }).click()
  await expect(page.getByRole('heading', { name: '中文问题' })).toBeVisible()
})

test('English remains available offline along with its CSV example and install manifest', async ({
  page,
  context,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Data & backups', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ready offline', exact: true })).toBeVisible()
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  const assets = await page.evaluate(async () => {
    const [manifest, csv] = await Promise.all([
      fetch('manifest.en.webmanifest'),
      fetch('example.en.csv'),
    ])
    return { lang: (await manifest.json()).lang, example: await csv.text() }
  })
  expect(assets.lang).toBe('en')
  expect(assets.example).toContain('What is active recall?')
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await expect(page.getByRole('heading', { name: '学习概览' })).toBeVisible()
})
