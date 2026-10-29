import { expect, type Page, type TestInfo } from '@playwright/test'
import { storedLibrary } from './stored-library'

async function prepare(page: Page) {
  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '创建卡组', exact: true }).first().click()
  await page.getByLabel('卡组名称', { exact: true }).fill('Search "notes"')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('Search completion marker')
  await page.getByLabel('背面 · 答案', { exact: true }).fill('Autocomplete must preserve progress.')
  await page.getByLabel('标签', { exact: false }).fill('英语, two words, say "hello"')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.main-nav').getByRole('button', { name: '全部卡片', exact: true }).click()
  return page.getByRole('combobox', { name: '搜索卡片', exact: true })
}

export async function searchCompletionFlow(page: Page, info: TestInfo) {
  await page.setViewportSize({ width: 1280, height: 900 })
  const search = await prepare(page)
  const before = await storedLibrary(page)
  await search.focus()
  await expect(page.getByRole('option').filter({ hasText: 'is:due' })).toBeVisible()
  await expect(search).toHaveAttribute('aria-autocomplete', 'list')
  const icon = await page.locator('.card-search [data-slot="leadingIcon"]').boundingBox()
  const field = (await search.boundingBox())!
  expect(icon).not.toBeNull()
  expect(icon!.x).toBeGreaterThan(field.x)
  expect(icon!.x + icon!.width).toBeLessThan(field.x + field.width)
  expect(Math.abs(icon!.y + icon!.height / 2 - field.y - field.height / 2)).toBeLessThanOrEqual(1)

  await search.fill('tag:two')
  await search.press('Home')
  expect(await search.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(0)
  await search.press('End')
  expect(await search.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(7)
  await search.fill('tag:two')
  await expect(page.getByRole('option')).toHaveCount(1)
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(search).toHaveValue('tag:"two words" ')
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await expect(
    page.getByRole('button', { name: 'Search completion marker', exact: true }),
  ).toBeVisible()

  const mixed = 'is:new tag:tw type:basic'
  await search.fill(mixed)
  await search.evaluate((element, caret) => {
    ;(element as HTMLInputElement).setSelectionRange(caret, caret)
    element.dispatchEvent(new Event('select', { bubbles: true }))
  }, mixed.indexOf(' type:'))
  await search.press('ArrowDown')
  await expect(page.getByRole('option')).toHaveCount(1)
  await search.press('Enter')
  await expect(search).toHaveValue('is:new tag:"two words" type:basic')
  expect(await search.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(
    'is:new tag:"two words" '.length,
  )

  await search.fill('deck:"Search')
  await page.getByRole('option').filter({ hasText: 'deck:' }).click()
  await expect(search).toHaveValue('deck:"Search \\"notes\\"" ')
  await expect(
    page.getByRole('button', { name: 'Search completion marker', exact: true }),
  ).toBeVisible()

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
    await search.fill('-tag:"say')
    await expect(page.getByRole('option')).toHaveCount(1)
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    await expect(list).toHaveCSS('opacity', '1')
    await expect(list).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.screenshot({
      path: info.outputPath(`search-completion-${theme}.png`),
      animations: 'disabled',
    })
    await search.press('Escape')
    await expect(search).toHaveValue('-tag:"say')
    await expect(search).toBeFocused()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await search.press('ArrowDown')
    await page.getByRole('option').click()
    await expect(search).toHaveValue('-tag:"say \\"hello\\"" ')
    await expect(page.getByRole('heading', { name: '没有匹配的卡片', exact: true })).toBeVisible()
  }

  await search.fill('unmatched free text')
  await search.press('Enter')
  await search.press('Tab')
  await expect(search).toHaveValue('unmatched free text')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  expect(await storedLibrary(page)).toEqual(before)
}

export async function searchCompletionCompositionFlow(page: Page, info: TestInfo, width: number) {
  const search = await prepare(page)
  await page.setViewportSize({ width, height: 900 })
  await search.fill('tag:')
  await expect(page.getByRole('option')).not.toHaveCount(0)
  await search.evaluate((element) => {
    const input = element as HTMLInputElement
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.value = 'tag:英'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '英', isComposing: true }))
  })
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await search.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    )
  })
  await expect(search).toHaveValue('tag:英')
  await search.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '英' }))
  })
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(page.getByRole('option')).toContainText('tag:英语')
  await expect(page.getByRole('listbox')).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: info.outputPath(`search-completion-narrow-${width}.png`),
    animations: 'disabled',
  })
  const popup = (await page.getByRole('listbox').boundingBox())!
  expect(popup.x).toBeGreaterThanOrEqual(0)
  expect(popup.x + popup.width).toBeLessThanOrEqual(width)
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(search).toHaveValue('tag:英语 ')
  await expect(page.getByRole('heading', { name: '全部卡片', exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Search completion marker', exact: true }),
  ).toBeVisible()
}
