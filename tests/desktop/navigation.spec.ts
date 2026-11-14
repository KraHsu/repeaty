import { test, expect } from './fixture'
import { setInterfaceLanguage } from '../fixtures/settings-flow'

for (const [width, height, language] of [
  [1280, 720, 'zh-CN'],
  [1280, 560, 'en'],
  [900, 600, 'zh-CN'],
] as const) {
  test(`overview creation and sidebar utilities stay reachable at ${width}x${height} (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await setInterfaceLanguage(page, language)
    await page
      .getByRole('button', { name: language === 'en' ? 'Overview' : '学习概览', exact: true })
      .click()
    const create = page
      .getByRole('button', {
        name: language === 'en' ? 'Create deck' : '创建卡组',
        exact: true,
      })
      .first()
    await create.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').locator('.modal-header button').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const help = page.locator('.sidebar-help')
    await help.scrollIntoViewIfNeeded()
    await expect(help).toBeInViewport()
    await expect(help).toHaveAccessibleName(language === 'en' ? 'Help' : '帮助')
    await help.click()
    await expect(
      page.getByRole('dialog', {
        name: language === 'en' ? 'Keyboard shortcuts' : '快捷键',
        exact: true,
      }),
    ).toBeVisible()
    await page.getByRole('dialog').locator('.modal-header button').click()
    const footer = await page.locator('.sidebar-bottom').boundingBox()
    expect(footer).not.toBeNull()
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(height)
  })
}
