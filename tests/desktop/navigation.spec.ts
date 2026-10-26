import { test, expect } from './fixture'

for (const [width, height, language] of [
  [1280, 720, 'zh-CN'],
  [1280, 560, 'en'],
  [900, 600, 'zh-CN'],
] as const) {
  test(`sidebar deck creation stays reachable at ${width}x${height} (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await page.locator('.language-picker select').selectOption(language)
    const create = page.locator('.sidebar-section-title button')
    await create.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').locator('.modal-header button').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const footer = await page.locator('.sidebar-bottom').boundingBox()
    expect(footer).not.toBeNull()
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(height)
  })
}
