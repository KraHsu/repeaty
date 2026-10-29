import { expect, type Page, type TestInfo } from '@playwright/test'

async function navigate(page: Page, name: string) {
  await page.locator('.main-nav').getByRole('button', { name, exact: true }).click()
  await expect(page.locator('.app-page-header h1')).toHaveText(name)
}

export async function pageHeaderFlow(page: Page, info: TestInfo, narrowWidth: number) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await navigate(page, '学习概览')
  if (!(await page.locator('.b-deck-tile').count())) {
    await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
    await expect(page.locator('.b-deck-tile').first()).toBeVisible()
  }
  const pages = [
    ['学习概览', 'overview'],
    ['全部卡片', 'cards'],
    ['学习材料', 'sources'],
  ] as const

  for (const [width, scale, theme] of [
    [1440, 1, 'light'],
    [narrowWidth, 1, 'dark'],
    [1440, 2, 'dark'],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(async (scale) => {
      document.documentElement.style.fontSize = `${scale * 100}%`
      await Promise.allSettled(
        document
          .querySelector('.main-content')!
          .getAnimations()
          .map((animation) => animation.finished),
      )
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    }, scale)
    const frames: { left: number; width: number; top: number }[] = []
    for (const [name, id] of pages) {
      await navigate(page, name)
      const header = page.locator('.app-page-header')
      const metrics = await header.evaluate((element) => {
        const header = element.getBoundingClientRect()
        const page = element.closest('.page')!
        const pageBox = page.getBoundingClientRect()
        const pageStyle = getComputedStyle(page)
        const title = element.querySelector('h1')!.getBoundingClientRect()
        const description = element.querySelector('p')!.getBoundingClientRect()
        const actions = element.querySelector('.app-page-header__actions')!
        const actionBox = actions.getBoundingClientRect()
        const buttons = [...actions.querySelectorAll('button')]
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
        const stacked = header.width <= 48 * rem
        return {
          left: header.left,
          width: header.width,
          top: header.top - pageBox.top,
          inset: Math.abs(header.left - pageBox.left - Number.parseFloat(pageStyle.paddingLeft)),
          rightInset: Math.abs(
            header.right - pageBox.right + Number.parseFloat(pageStyle.paddingRight),
          ),
          titleInset: Math.abs(title.left - header.left),
          actionAlignment: stacked
            ? Math.abs(actionBox.left - header.left)
            : Math.abs(actionBox.top - title.top),
          actionEdge: stacked ? 0 : Math.abs(actionBox.right - header.right),
          separation: stacked ? actionBox.top - description.bottom : 0,
          stacked,
          gap: Number.parseFloat(getComputedStyle(actions).gap),
          buttonCount: buttons.length,
          buttonsContained: buttons.every((button) => {
            const box = button.getBoundingClientRect()
            return (
              box.left >= header.left - 1 &&
              box.right <= header.right + 1 &&
              box.top >= header.top - 1 &&
              box.bottom <= header.bottom + 1 &&
              button.scrollWidth <= button.clientWidth + 1
            )
          }),
          minButtonHeight: Math.min(
            ...buttons.map((button) => button.getBoundingClientRect().height),
          ),
        }
      })
      frames.push(metrics)
      expect(metrics.inset).toBeLessThanOrEqual(1)
      expect(metrics.rightInset).toBeLessThanOrEqual(1)
      expect(metrics.titleInset).toBeLessThanOrEqual(1)
      expect(metrics.actionAlignment).toBeLessThanOrEqual(1)
      expect(metrics.actionEdge).toBeLessThanOrEqual(1)
      if (metrics.stacked) expect(metrics.separation).toBeGreaterThanOrEqual(16 * scale - 1)
      expect(metrics.gap).toBe(8 * scale)
      expect(metrics.buttonCount).toBeGreaterThan(0)
      expect(metrics.buttonsContained).toBe(true)
      expect(metrics.minButtonHeight).toBeGreaterThanOrEqual(44 * scale)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: info.outputPath(`page-header-${id}-${width}-${scale}.png`),
        animations: 'disabled',
      })
    }
    for (const frame of frames.slice(1)) {
      expect(Math.abs(frame.left - frames[0]!.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(frame.width - frames[0]!.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(frame.top - frames[0]!.top)).toBeLessThanOrEqual(1)
    }
  }

  // Slotting the controls must preserve their real application actions and focus return.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%'
  })
  for (const [name, action, dialog] of [
    ['学习概览', '添加卡片', '添加卡片'],
    ['全部卡片', '添加卡片', '添加卡片'],
    ['全部卡片', '批量导入', '批量导入笔记'],
    ['学习材料', '导入材料', '导入材料'],
  ]) {
    await navigate(page, name!)
    const button = page.locator('.app-page-header__actions').getByRole('button', {
      name: action,
      exact: true,
    })
    await button.click()
    const modal = page.getByRole('dialog', { name: dialog, exact: true })
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click()
    await expect(modal).toHaveCount(0)
    await expect(button).toBeFocused()
  }
}
