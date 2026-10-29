import { expect, type Page, type TestInfo } from '@playwright/test'

function navigationButton(page: Page, name: string) {
  return page.locator('#primary-navigation').getByRole('button', { name, exact: true })
}

export async function expectSidebarSelectionAligned(page: Page, name: string) {
  await expect(navigationButton(page, name)).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.sidebar-nav-selection')).toHaveCSS('opacity', '1')
  await expect
    .poll(() =>
      page.locator('#primary-navigation').evaluate((nav) => {
        const selection = nav.querySelector('.sidebar-nav-selection')!.getBoundingClientRect()
        const active = nav.querySelector('.nav-link[aria-current="page"]')!.getBoundingClientRect()
        return Math.max(
          Math.abs(selection.left - active.left),
          Math.abs(selection.top - active.top),
          Math.abs(selection.width - active.width),
          Math.abs(selection.height - active.height),
        )
      }),
    )
    .toBeLessThanOrEqual(1)
}

/** Sample from the DOM click so Playwright actionability waits cannot skip the transition. */
async function sampleSidebarSelection(page: Page, names: string[]) {
  return page.locator('#primary-navigation').evaluate(async (nav, names) => {
    const selection = nav.querySelector<HTMLElement>('.sidebar-nav-selection')!
    const target = (name: string) =>
      [...nav.querySelectorAll<HTMLButtonElement>('.nav-link')].find(
        (button) => button.getAttribute('aria-label') === name,
      )!
    const bounds = (element: Element) => {
      const { left, top, width, height } = element.getBoundingClientRect()
      return { left, top, width, height }
    }
    const initial = bounds(selection)
    const frames: {
      selection: ReturnType<typeof bounds>
      target: ReturnType<typeof bounds>
      running: number
    }[] = []
    const frame = async () => {
      await new Promise(requestAnimationFrame)
      frames.push({
        selection: bounds(selection),
        target: bounds(target(names.at(-1)!)),
        running: selection.getAnimations().filter((animation) => animation.playState === 'running')
          .length,
      })
    }
    for (const name of names) {
      target(name).click()
      await frame()
      await frame()
    }
    const end = performance.now() + 400
    while (performance.now() < end) await frame()
    return { initial, frames }
  }, names)
}

async function toggleSidebarWithWidthCheck(page: Page) {
  const widths = await page.evaluate(async () => {
    const nav = document.querySelector('#primary-navigation')!
    const selection = nav.querySelector('.sidebar-nav-selection')!
    const active = nav.querySelector('.nav-link[aria-current="page"]')!
    document.querySelector<HTMLButtonElement>('.sidebar-toggle')!.click()
    const frames: { active: number; selection: number }[] = []
    const end = performance.now() + 400
    while (performance.now() < end) {
      await new Promise(requestAnimationFrame)
      frames.push({
        active: active.getBoundingClientRect().width,
        selection: selection.getBoundingClientRect().width,
      })
    }
    return frames
  })
  expect(Math.abs(widths.at(-1)!.active - widths[0]!.active)).toBeGreaterThan(40)
  for (const frame of widths) {
    expect(Math.abs(frame.active - frame.selection)).toBeLessThanOrEqual(1)
  }
}

export async function sidebarSelectionMotionFlow(page: Page, info: TestInfo, desktop: boolean) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  await navigationButton(page, '学习概览').click()
  await expectSidebarSelectionAligned(page, '学习概览')
  const selection = page.locator('.sidebar-nav-selection')
  await expect(selection).toHaveCount(1)
  await expect(selection).toHaveAttribute('aria-hidden', 'true')
  await expect(selection).toHaveCSS('pointer-events', 'none')
  const toggle = page.locator('.sidebar-toggle')
  const separator = page.getByRole('separator', { name: '调整侧栏宽度', exact: true })
  const colors: string[] = []

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
    colors.push(await selection.evaluate((element) => getComputedStyle(element).backgroundColor))
    expect(colors.at(-1)).not.toBe('rgba(0, 0, 0, 0)')

    for (const expanded of [false, true]) {
      if ((await toggle.getAttribute('aria-expanded')) !== String(expanded))
        await toggleSidebarWithWidthCheck(page)
      await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
      await expect(page.locator('.sidebar')).toHaveCSS('width', expanded ? '208px' : '80px')
      await navigationButton(page, '学习概览').click()
      await expectSidebarSelectionAligned(page, '学习概览')
      const motion = await sampleSidebarSelection(page, ['学习材料'])
      const final = motion.frames.at(-1)!
      expect(final.target.top - motion.initial.top).toBeGreaterThan(40)
      expect(
        motion.frames.some(
          ({ selection }) =>
            selection.top > motion.initial.top + 1 && selection.top < final.target.top - 1,
        ),
      ).toBe(true)
      await expectSidebarSelectionAligned(page, '学习材料')

      const rapid = await sampleSidebarSelection(page, ['全部卡片', '学习材料', '设置'])
      await expectSidebarSelectionAligned(page, '设置')
      expect(rapid.frames.at(-1)!.running).toBe(0)
      await expect(page.locator('#primary-navigation [aria-current="page"]')).toHaveCount(1)
      await page.screenshot({
        path: info.outputPath(
          `sidebar-selection-${theme}-${expanded ? 'expanded' : 'collapsed'}.png`,
        ),
        animations: 'disabled',
      })
    }
  }
  expect(colors[0]).not.toBe(colors[1])

  // A held drag crosses the icon/text breakpoint; the background must not trail the live width.
  const box = (await separator.boundingBox())!
  const start = { x: box.x + box.width / 2, y: box.y + 90 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await expect(page.locator('.app-layout')).toHaveClass(/sidebar-resizing/)
  for (const width of [100, 300]) {
    await page.mouse.move(start.x + width - 208, start.y, { steps: 3 })
    await expect(separator).toHaveAttribute('aria-valuenow', String(width))
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    })
    await expectSidebarSelectionAligned(page, '设置')
    expect(
      await selection.evaluate(
        (element) =>
          element.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    ).toBe(0)
  }
  await page.mouse.up()
  await expect(page.locator('.app-layout')).not.toHaveClass(/sidebar-resizing/)

  // The same selection follows a clamped/scrolled desktop rail or wrapped mobile web navigation.
  await page.setViewportSize({ width: desktop ? 500 : 390, height: 400 })
  await navigationButton(page, '学习概览').click()
  await expectSidebarSelectionAligned(page, '学习概览')
  await navigationButton(page, '设置').click()
  await expectSidebarSelectionAligned(page, '设置')
  await expect(navigationButton(page, '设置')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('sidebar-selection-narrow.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.locator('.sidebar')).toHaveCSS('width', '300px')
  await expectSidebarSelectionAligned(page, '设置')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await expectSidebarSelectionAligned(page, '设置')
  await navigationButton(page, '学习材料').click()
  await expectSidebarSelectionAligned(page, '学习材料')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('sidebar-selection-large-font.png') })
}

export async function sidebarSelectionReducedMotionFlow(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const toggle = page.locator('.sidebar-toggle')
  for (const expanded of [false, true]) {
    if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
    await navigationButton(page, '学习概览').click()
    await expectSidebarSelectionAligned(page, '学习概览')
    const motion = await sampleSidebarSelection(page, ['设置'])
    // Vue's post-render measurement gets two frames; no later frame may animate or lag behind.
    const settled = motion.frames.slice(2)
    expect(settled.length).toBeGreaterThan(0)
    for (const { selection, target, running } of settled) {
      expect(running).toBe(0)
      expect(
        Math.max(
          Math.abs(selection.left - target.left),
          Math.abs(selection.top - target.top),
          Math.abs(selection.width - target.width),
          Math.abs(selection.height - target.height),
        ),
      ).toBeLessThanOrEqual(1)
    }
    await expectSidebarSelectionAligned(page, '设置')
  }
}
