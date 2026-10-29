import { test, expect } from '@playwright/test'

test('card previews use stacked sections and consistent icon actions while toolbar labels stay intact', async ({
  page,
}, info) => {
  await page.goto('./')
  await page.locator('.main-nav').getByRole('button', { name: '全部卡片', exact: true }).click()
  const first = page.locator('.card-table tbody tr').first()
  await expect(first).toBeVisible()
  const question = first.locator('.card-row-title')
  const title = (await question.textContent())!.trim()
  const row = page
    .locator('.card-table tbody tr')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })

  for (const [width, scale] of [
    [1440, 1],
    [1024, 1],
    [390, 1],
    [1440, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = `${value * 100}%`
    }, scale)
    const layout = await row.evaluate((element) => {
      const question = element.querySelector('.card-row-title')!.getBoundingClientRect()
      const separator = element.querySelector('[role="separator"]')!.getBoundingClientRect()
      const answer = element.querySelector('.card-row-answer')!.getBoundingClientRect()
      const actions = [...element.querySelectorAll<HTMLButtonElement>('.row-actions button')].map(
        (button) => {
          const box = button.getBoundingClientRect()
          const icon = button.querySelector('svg')!.getBoundingClientRect()
          return {
            width: box.width,
            height: box.height,
            y: box.y,
            text: button.textContent!.trim(),
            label: button.getAttribute('aria-label'),
            title: button.title,
            dx: Math.abs(box.x + box.width / 2 - icon.x - icon.width / 2),
            dy: Math.abs(box.y + box.height / 2 - icon.y - icon.height / 2),
          }
        },
      )
      return {
        questionBottom: question.bottom,
        questionWidth: question.width,
        table: [...element.closest('table')!.querySelectorAll('th')].map((th) => ({
          width: th.getBoundingClientRect().width,
          sizing: getComputedStyle(th).boxSizing,
        })),
        separatorTop: separator.top,
        separatorBottom: separator.bottom,
        answerTop: answer.top,
        questionBorder: getComputedStyle(element.querySelector('.card-row-title')!).borderWidth,
        actions,
      }
    })
    expect(layout.separatorTop).toBeGreaterThanOrEqual(layout.questionBottom)
    expect(layout.answerTop).toBeGreaterThan(layout.separatorBottom)
    expect(layout.questionBorder).toBe('0px')
    expect(layout.questionWidth, JSON.stringify({ width, scale, layout })).toBeGreaterThanOrEqual(
      12 * 16 * scale,
    )
    expect(layout.actions).toHaveLength(3)
    for (const action of layout.actions) {
      expect(action.width).toBe(44 * scale)
      expect(action.height).toBe(44 * scale)
      expect(action.y).toBe(layout.actions[0]!.y)
      expect(action.text).toBe('')
      expect(action.label).toBeTruthy()
      expect(action.title).toBe(action.label)
      expect(action.dx).toBeLessThanOrEqual(1)
      expect(action.dy).toBeLessThanOrEqual(1)
    }
    const toolbar = await page.locator('.library-toolbar').evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const button = element.querySelector('.library-review')!
      const text = [...button.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      )!
      const range = document.createRange()
      range.selectNodeContents(text)
      return {
        textLines: range.getClientRects().length,
        fits: [...element.children].every((child) => {
          const box = child.getBoundingClientRect()
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
        }),
      }
    })
    expect(toolbar.textLines).toBe(1)
    expect(toolbar.fits).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath(`collection-${width}-${scale}.png`),
      fullPage: false,
      animations: 'disabled',
    })
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await row.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(row.getByRole('button', { name: '恢复', exact: true })).toBeVisible()
  await row.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(row.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
  await row.getByRole('button', { name: title, exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await expect(editor.getByLabel('正面 · 问题', { exact: true })).toHaveValue(title)
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  await row.getByRole('button', { name: `删除卡片 ${title}`, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(row).toBeVisible()
})
