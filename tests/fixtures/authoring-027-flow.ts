import { expect, type Page, type TestInfo } from '@playwright/test'
import { fixture, input, now } from '../../src/core/test-fixtures'
import { saveNote } from '../../src/core/model'
import { seedPolish } from './polish-flow'

export async function rendering027Flow(page: Page, info: TestInfo) {
  const external: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url())
  })
  const front =
    'First line\nSecond line\n\nNext paragraph\n\n' +
    '\\(x^2\\)\n\n\\[\n\\frac{1}{2}\n\\]\n\n' +
    '| A | B |\n| - | - |\n| 1 | 2 |\n\n' +
    '<style>.styled { color: rgb(12, 34, 56) } .topbar { display: none } ' +
    '.styled { background: url(https://example.invalid/css) }</style>\n\n' +
    '<div class="styled" style="padding:12px;border:1px solid #ccc">Styled HTML</div>\n\n' +
    '<img alt="Inline picture" style="width:80px;height:40px" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=">\n\n' +
    '<img src="https://example.invalid/image" onerror="globalThis.cardExecuted=true">' +
    '<script>globalThis.cardExecuted=true</script>'
  let library = fixture({
    ...input,
    front,
    back: 'Answer line\nSame paragraph\n\nAnother paragraph',
    format: 'markdown',
  })
  library = saveNote(
    library,
    {
      ...input,
      format: 'plain',
      front: 'Plain first\nPlain second\n\n' + 'Long prose. '.repeat(40),
      back: 'Plain answer\nNext line\n\nNew paragraph',
    },
    undefined,
    false,
    new Date(now.getTime() + 1000),
  )
  await seedPolish(page, library)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.locator('.deck-review').click()
  const question = page.locator('.card-question')
  await expect(question.locator('.rich-content')).toHaveCSS('text-align', 'left')
  await expect(question.locator('.styled')).toHaveCSS('color', 'rgb(12, 34, 56)')
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(question.locator('.katex-display')).toHaveCount(1)
  await expect(question.locator('.katex')).toHaveCount(2)
  const layout = await question.evaluate((element) => {
    const content = element.querySelector('.rich-content')!.getBoundingClientRect()
    const paragraphs = element.querySelectorAll('p')
    const first = paragraphs[0]!,
      second = paragraphs[1]!
    const firstBounds = first.getBoundingClientRect(),
      secondBounds = second.getBoundingClientRect()
    const image = element.querySelector('img[alt="Inline picture"]')!.getBoundingClientRect()
    const table = element.querySelector('table')!.getBoundingClientRect()
    return {
      gap: secondBounds.top - firstBounds.bottom,
      lineHeight: parseFloat(getComputedStyle(first).lineHeight),
      imageCenter: Math.abs((image.left + image.right) / 2 - (content.left + content.right) / 2),
      tableCenter: Math.abs((table.left + table.right) / 2 - (content.left + content.right) / 2),
    }
  })
  expect(layout.gap).toBeGreaterThan(layout.lineHeight * 0.4)
  expect(layout.imageCenter).toBeLessThan(2)
  expect(layout.tableCenter).toBeLessThan(2)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer .card-content')).toHaveCSS('text-align', 'left')
  await page.getByRole('button', { name: /^良好/ }).click()
  await expect(question).toHaveClass(/long-content/)
  await expect(question.locator('.plain-content')).toHaveCSS('text-align', 'left')
  await expect(question.locator('.plain-paragraph')).toHaveCount(2)
  await expect(question.locator('.plain-paragraph').first()).toContainText(
    'Plain first\nPlain second',
  )
  expect(external).toEqual([])
  expect(
    await page.evaluate(() => (window as Window & { cardExecuted?: boolean }).cardExecuted),
  ).toBeUndefined()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('rendering-027-mobile.png'), fullPage: true })
}

export async function modal027Flow(page: Page) {
  await seedPolish(page)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '添加卡片', exact: true })
  await dialog.getByLabel('正面 · 问题', { exact: true }).fill('Keep this draft')
  const field = (await dialog.getByLabel('正面 · 问题', { exact: true }).boundingBox())!
  const inside = { x: field.x + 25, y: field.y + 25 },
    outside = { x: 5, y: 5 }
  for (const [start, end] of [
    [inside, outside],
    [outside, inside],
    [inside, inside],
  ]) {
    await page.mouse.move(start!.x, start!.y)
    await page.mouse.down()
    await page.mouse.move(end!.x, end!.y)
    await page.mouse.up()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('正面 · 问题', { exact: true })).toHaveValue('Keep this draft')
  }
  await page.mouse.click(outside.x, outside.y)
  await expect(dialog).toHaveCount(0)
}
