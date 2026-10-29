import { expect, test, type Page } from '@playwright/test'
import { openSettings, selectSettingsCategory } from './fixtures/settings-flow'

function category(page: Page, key: string) {
  return page.locator(`.settings-categories [data-category-key="${key}"]`)
}

async function expectSelectionAligned(page: Page, key: string) {
  await expect(category(page, key)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.settings-categories .branched-menu__selection')).toHaveCSS(
    'opacity',
    '1',
  )
  await expect
    .poll(() =>
      page.locator('.settings-categories').evaluate((menu, key) => {
        const selection = menu.querySelector('.branched-menu__selection')!.getBoundingClientRect()
        const row = menu
          .querySelector(`[data-category-key="${key}"]`)!
          .parentElement!.getBoundingClientRect()
        return Math.max(
          Math.abs(selection.left - row.left),
          Math.abs(selection.top - row.top),
          Math.abs(selection.width - row.width),
          Math.abs(selection.height - row.height),
        )
      }, key),
    )
    .toBeLessThanOrEqual(1)
}

/** Sample real rendered geometry from the click onward so driver waits cannot skip the motion. */
async function sampleSelection(page: Page, keys: string[]) {
  return page.locator('.settings-categories').evaluate(async (menu, keys) => {
    const selection = menu.querySelector<HTMLElement>('.branched-menu__selection')!
    const target = (key: string) =>
      menu.querySelector<HTMLButtonElement>(`[data-category-key="${key}"]`)!
    const bounds = (element: Element) => {
      const { left, top, width, height } = element.getBoundingClientRect()
      return { left, top, width, height }
    }
    const initial = bounds(selection)
    const frames: {
      selection: ReturnType<typeof bounds>
      row: ReturnType<typeof bounds>
      running: number
    }[] = []
    const frame = async () => {
      await new Promise(requestAnimationFrame)
      frames.push({
        selection: bounds(selection),
        row: bounds(target(keys.at(-1)!).parentElement!),
        running: selection.getAnimations().filter((animation) => animation.playState === 'running')
          .length,
      })
    }
    // Let each change begin painting before the next click supersedes it.
    for (const key of keys) {
      target(key).click()
      await frame()
      await frame()
    }
    const lastClickFrame = frames.length - 2
    const end = performance.now() + 400
    while (performance.now() < end) await frame()
    return { initial, frames, lastClickFrame }
  }, keys)
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  await page.goto('./')
  await openSettings(page)
  await expectSelectionAligned(page, 'general')
})

test('settings selection slides between rows, follows the final click, and realigns after folding in both themes', async ({
  page,
}, info) => {
  const selection = page.locator('.settings-categories .branched-menu__selection')
  await expect(selection).toHaveCount(1)
  await expect(selection).toHaveAttribute('aria-hidden', 'true')
  await expect(selection).toHaveCSS('pointer-events', 'none')
  const colors: string[] = []

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
    await selectSettingsCategory(page, 'general')
    await expectSelectionAligned(page, 'general')
    colors.push(await selection.evaluate((element) => getComputedStyle(element).backgroundColor))
    expect(colors.at(-1)).not.toBe('rgba(0, 0, 0, 0)')

    const motion = await sampleSelection(page, ['general.notifications'])
    const final = motion.frames.at(-1)!
    expect(final.row.top - motion.initial.top).toBeGreaterThan(40)
    expect(
      motion.frames.some(
        ({ selection }) =>
          selection.top > motion.initial.top + 1 && selection.top < final.row.top - 1,
      ),
    ).toBe(true)
    await expectSelectionAligned(page, 'general.notifications')

    const rapid = await sampleSelection(page, [
      'general.appearance',
      'general.notifications',
      'general',
    ])
    await expectSelectionAligned(page, 'general')
    expect(rapid.frames.at(-1)!.running).toBe(0)
    expect(
      Math.abs(rapid.frames.at(-1)!.selection.top - rapid.frames.at(-1)!.row.top),
    ).toBeLessThanOrEqual(1)
    await expect(page.locator('.settings-categories [aria-selected="true"]')).toHaveCount(1)

    // Folding a preceding branch moves the selected row even though its key does not change.
    await selectSettingsCategory(page, 'tools')
    await expectSelectionAligned(page, 'tools')
    const general = category(page, 'general')
    const toggle = general.locator('..').locator('.branched-menu__toggle')
    const expandedTop = (await category(page, 'tools').boundingBox())!.y
    await toggle.click()
    await expect(general).toHaveAttribute('aria-expanded', 'false')
    await expect
      .poll(async () => (await category(page, 'tools').boundingBox())!.y)
      .toBeLessThan(expandedTop - 40)
    await expectSelectionAligned(page, 'tools')
    await toggle.click()
    await expect(general).toHaveAttribute('aria-expanded', 'true')
    await expect
      .poll(async () => Math.abs((await category(page, 'tools').boundingBox())!.y - expandedTop))
      .toBeLessThanOrEqual(1)
    await expectSelectionAligned(page, 'tools')

    await selectSettingsCategory(page, 'general.appearance')
    await expectSelectionAligned(page, 'general.appearance')
    await toggle.click()
    await expect(general).toHaveAttribute('aria-expanded', 'false')
    await expect(selection).toHaveCSS('opacity', '0')
    await toggle.click()
    await expect(general).toHaveAttribute('aria-expanded', 'true')
    await expectSelectionAligned(page, 'general.appearance')
    await page.screenshot({
      path: info.outputPath(`settings-menu-selection-${theme}.png`),
      animations: 'disabled',
    })
  }
  expect(colors[0]).not.toBe(colors[1])
})

test('reduced motion moves the settings selection directly to the final row', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const motion = await sampleSelection(page, ['general.notifications'])
  // Allow Vue's post-render measurement to complete; subsequent frames must stay at the target.
  const settled = motion.frames.slice(motion.lastClickFrame + 2)
  expect(settled.length).toBeGreaterThan(0)
  for (const { selection, row, running } of settled) {
    expect(running).toBe(0)
    expect(
      Math.max(
        Math.abs(selection.left - row.left),
        Math.abs(selection.top - row.top),
        Math.abs(selection.width - row.width),
        Math.abs(selection.height - row.height),
      ),
    ).toBeLessThanOrEqual(1)
  }
  await expectSelectionAligned(page, 'general.notifications')
})
