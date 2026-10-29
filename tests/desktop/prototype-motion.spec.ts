import { test, expect } from './fixture'

test('deck selection retains the prototype motion without stale selections and respects reduced motion', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
  await expect(page.locator('.b-deck-tile')).toHaveCount(1)
  await page.getByRole('button', { name: '创建卡组', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '创建卡组', exact: true })
  await dialog.getByLabel('卡组名称', { exact: true }).fill('Motion selection')
  await dialog.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
  await expect(page.locator('.b-deck-tile')).toHaveCount(2)

  const animateSelection = () =>
    page.evaluate(async () => {
      const tiles = [...document.querySelectorAll<HTMLButtonElement>('.b-deck-tile')]
      // Rapid input must cancel the previous feedback, not queue stale animations.
      tiles[0]!.click()
      tiles[1]!.click()
      tiles[0]!.click()
      await new Promise(requestAnimationFrame)
      const stage = document.querySelector('.b-focus-stage')!
      return stage
        .getAnimations()
        .filter((animation) => !(animation instanceof CSSAnimation))
        .map((animation) => ({
          duration: animation.effect!.getTiming().duration,
          keyframes: (animation.effect as KeyframeEffect).getKeyframes(),
        }))
    })
  const active = await animateSelection()
  expect(active).toHaveLength(1)
  expect(active[0]!.duration).toBe(220)
  expect(active[0]!.keyframes[0]!.transform).toBe('translateY(6px)')
  const selectedName = await page.locator('.b-deck-tile').first().locator('.deck-title').innerText()
  await expect(page.locator('.b-focus-card h2')).toHaveText(selectedName)
  await expect(page.locator('.b-deck-tile').first()).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() =>
      page.locator('.b-focus-stage').evaluate((element) => getComputedStyle(element).opacity),
    )
    .toBe('1')
  await page.screenshot({ path: info.outputPath('prototype-home.png'), animations: 'disabled' })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await animateSelection()).toEqual([])
  await expect(page.locator('.b-focus-card h2')).toHaveText(selectedName)
  expect(
    await page
      .locator('.b-focus-stage')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none')
  await page.locator('.b-start-review').click()
  await expect(page.locator('.flashcard')).toBeVisible()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer')).toBeVisible()
  await expect(page.locator('.grade-button')).toHaveCount(4)
  await page.screenshot({
    path: info.outputPath('prototype-review-answer.png'),
    animations: 'disabled',
  })
})
