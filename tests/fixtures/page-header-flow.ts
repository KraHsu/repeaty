import { expect, type Page, type TestInfo } from '@playwright/test'
import { practiceHistoryFixture } from './practice-history'
import { selectUiValue } from './ui-flow'

async function navigate(page: Page, name: string, heading = name) {
  await page.locator('.main-nav').getByRole('button', { name, exact: true }).click()
  await expect(page.locator('.app-page-header h1')).toHaveText(heading)
  await expect(page.locator('.main-content .page')).toHaveCount(1)
}

async function pageEntrance(page: Page, reduced: boolean) {
  const motion = await page.locator('.app-page').evaluate(async (element, reduced) => {
    const animation = element
      .getAnimations()
      .find((animation) => (animation as CSSAnimation).animationName === 'app-page-enter')
    if (!animation || reduced) return { animated: !!animation, samples: [] }
    animation.pause()
    const samples = []
    for (const time of [0, 110, 220]) {
      animation.currentTime = time
      await new Promise(requestAnimationFrame)
      const title = element.querySelector('h1')!.getBoundingClientRect()
      samples.push({
        opacity: Number(getComputedStyle(element).opacity),
        top: title.top,
        left: title.left,
      })
    }
    animation.finish()
    return { animated: true, samples }
  }, reduced)
  expect(motion.animated).toBe(!reduced)
  if (!reduced) {
    expect(motion.samples[0]!.opacity).toBeLessThan(motion.samples[1]!.opacity)
    expect(motion.samples[1]!.opacity).toBeLessThan(motion.samples[2]!.opacity)
    expect(motion.samples[2]!.opacity).toBe(1)
    for (const sample of motion.samples.slice(1)) {
      expect(Math.abs(sample.top - motion.samples[0]!.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(sample.left - motion.samples[0]!.left)).toBeLessThanOrEqual(1)
    }
  }
}

export async function pageHeaderFlow(
  page: Page,
  info: TestInfo,
  narrowWidth: number,
  edition: 'web' | 'desktop',
) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Use the public restore flow so history is available in both editions without store injection.
  await navigate(page, '数据与备份')
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'page-header-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(practiceHistoryFixture(3))),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (const dismiss of await page.getByRole('button', { name: '关闭提示', exact: true }).all()) {
    await dismiss.click()
  }
  const pages = [
    ['学习概览', 'overview'],
    ['全部卡片', 'cards'],
    ['学习材料', 'sources'],
    ['练习历史', 'history'],
    ['设置', 'settings'],
    ['插件', 'plugins'],
    ['工作目录', 'workspace'],
    ['数据与备份', 'backup'],
  ] as const

  for (const [width, scale, theme] of [
    [1440, 1, 'light'],
    [narrowWidth, 1, 'dark'],
    [1440, 2, 'dark'],
  ] as const) {
    const reduced = width !== 1440 || scale !== 1
    await page.emulateMedia({
      colorScheme: theme,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    })
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
      await navigate(
        page,
        name,
        name === '工作目录' && edition === 'web' ? '在浏览器中打开工作目录' : name,
      )
      const header = page.locator('.app-page-header')
      await expect(header.locator('.app-page-header__description')).toBeVisible()
      await pageEntrance(page, reduced)
      const metrics = await header.evaluate((element) => {
        const header = element.getBoundingClientRect()
        const page = element.closest('.page')!
        const pageBox = page.getBoundingClientRect()
        const pageStyle = getComputedStyle(page)
        const title = element.querySelector('h1')!.getBoundingClientRect()
        const description = element.querySelector('p')?.getBoundingClientRect()
        const copy = element.querySelector('.app-page-header__copy')!.getBoundingClientRect()
        const actions = element.querySelector('.app-page-header__actions')
        const actionBox = actions?.getBoundingClientRect()
        const buttons = [...(actions?.querySelectorAll('button') ?? [])]
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
          descriptionInset: description ? Math.abs(description.left - header.left) : 0,
          descriptionGap: description ? description.top - title.bottom : undefined,
          copyRightInset: Math.abs(copy.right - header.right),
          hasActions: Boolean(actions),
          actionAlignment: actionBox
            ? stacked
              ? Math.abs(actionBox.left - header.left)
              : Math.abs(actionBox.top - title.top)
            : 0,
          actionEdge: stacked || !actionBox ? 0 : Math.abs(actionBox.right - header.right),
          separation: stacked && actionBox ? actionBox.top - (description ?? title).bottom : 0,
          stacked,
          gap: actions ? Number.parseFloat(getComputedStyle(actions).gap) : 0,
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
      expect(metrics.descriptionInset).toBeLessThanOrEqual(1)
      if (metrics.descriptionGap !== undefined) expect(metrics.descriptionGap).toBe(6 * scale)
      expect(metrics.hasActions).toBe(!['history', 'settings', 'backup'].includes(id))
      if (metrics.hasActions) {
        expect(metrics.actionAlignment).toBeLessThanOrEqual(1)
        expect(metrics.actionEdge).toBeLessThanOrEqual(1)
        if (metrics.stacked) expect(metrics.separation).toBeGreaterThanOrEqual(16 * scale - 1)
        expect(metrics.gap).toBe(8 * scale)
        expect(metrics.buttonCount).toBeGreaterThan(0)
        expect(metrics.buttonsContained).toBe(true)
        expect(metrics.minButtonHeight).toBeGreaterThanOrEqual(44 * scale)
      } else {
        // Pages without global actions use the full header width, without a phantom grid column.
        expect(metrics.copyRightInset).toBeLessThanOrEqual(1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      if (id === 'history') {
        const filters = page.locator('.history-filters')
        const search = filters.getByRole('textbox', { name: '搜索练习历史', exact: true })
        const question = filters.getByRole('combobox', { name: '筛选题目', exact: true })
        const deck = filters.getByRole('combobox', { name: '筛选卡组', exact: true })
        const result = filters.getByRole('combobox', { name: '判题结果', exact: true })
        await expect(search).toHaveAttribute('placeholder', '搜索题目')
        await expect(question).toContainText('全部题目')
        await expect(deck).toContainText('全部卡组')
        await expect(result).toContainText('全部结果')
        for (const control of [search, question, deck, result]) {
          await expect(control).toBeVisible()
          const fits = await control.evaluate((element) => {
            const bounds = element.closest('.history-filters')!.getBoundingClientRect()
            const box = element.getBoundingClientRect()
            return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
          })
          expect(fits).toBe(true)
        }
        await expect(page.locator('.practice-history')).toHaveCount(3)
      }
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
  await navigate(page, '练习历史')
  const search = page.getByRole('textbox', { name: '搜索练习历史', exact: true })
  await search.fill('Second problem')
  await expect(page.locator('.practice-history')).toHaveCount(1)
  await search.fill('no matching question')
  await expect(page.getByText('没有符合筛选条件的练习。', { exact: true })).toBeVisible()
  await search.clear()
  await expect(page.locator('.practice-history')).toHaveCount(3)
  const result = page.getByRole('combobox', { name: '判题结果', exact: true })
  await selectUiValue(result, { label: '通过' })
  await expect(page.locator('.practice-history')).toHaveCount(1)
  await selectUiValue(result, { label: '全部结果' })
  await expect(page.locator('.practice-history')).toHaveCount(3)
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

  await navigate(page, '插件')
  const install = page.locator('.app-page-header__actions').getByRole('button', {
    name: '安装插件包',
    exact: true,
  })
  const chooser = page.waitForEvent('filechooser')
  await install.click()
  expect((await chooser).isMultiple()).toBe(false)

  if (edition === 'web') {
    await navigate(page, '工作目录', '在浏览器中打开工作目录')
    const actions = page.locator('.app-page-header__actions')
    const fallback = actions.getByRole('button', { name: '使用文件夹选择', exact: true })
    const open = (await fallback.count())
      ? fallback
      : actions.getByRole('button', { name: '打开本地工作目录', exact: true })
    const directoryChooser = page.waitForEvent('filechooser')
    await open.click()
    expect((await directoryChooser).isMultiple()).toBe(true)
  }
}
