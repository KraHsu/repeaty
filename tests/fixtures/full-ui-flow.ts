import {
  openCollection,
  fillCollectionText,
  previewCollection,
  commitCollection,
} from './collection-controls'
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { addSource, prepareSource } from '../../src/core/sources'
import { exportArchive } from '../../src/core/archive'
import type { MediaUpload } from '../../src/core/model'
import { readBrowserLibrary } from './adaptive-mixed-flow'
import { setResponsiveViewport } from './viewport-flow'
import { showSourceFilters } from './source-controls'

async function dismissNotices(page: Page) {
  const close = page.getByRole('button', { name: '关闭提示', exact: true })
  while (await close.count()) await close.first().click()
}

async function sharedControls(scope: Locator) {
  const fields = scope.locator(
    'input:visible:not(.sr-only):not([type="hidden"]):not([aria-hidden="true"]), textarea:visible',
  )
  expect(await fields.count()).toBeGreaterThan(0)
  for (const field of await fields.all()) await expect(field).toHaveAttribute('data-slot', 'base')
  const actions = scope.locator(
    'button:visible:not(.desktop-window-button):not(.source-list-title):not([role="checkbox"]):not([role="switch"]):not([role="radio"]):not([role="combobox"])',
  )
  expect(await actions.count()).toBeGreaterThan(0)
  for (const action of await actions.all()) await expect(action).toHaveClass(/\bui-button\b/)
  for (const control of await scope
    .locator('[role="checkbox"], [role="switch"], [role="radio"], [role="combobox"]')
    .all())
    await expect(control).toHaveAttribute('data-slot', 'base')
}

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
}

/** Populate pagination through a real backup, retaining the card authored in this test. */
async function sourcePages(page: Page) {
  let library = await readBrowserLibrary(page)
  const uploads: MediaUpload[] = []
  for (let index = 0; index < 20; index++) {
    const prepared = prepareSource(
      {
        title: `UI fixture ${index + 1}`,
        url: '',
        format: 'plain',
        content: 'Pagination fixture.',
      },
      new Date(Date.now() - 60_000 - index * 1000),
    )
    library = addSource(library, prepared.source, prepared.asset)
    uploads.push(prepared.asset)
  }
  const archive = (await exportArchive(
    library,
    async (id) => uploads.find((entry) => entry.meta.id === id)?.blob,
  ))!
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'full-ui-pagination.repeaty',
    mimeType: 'application/zip',
    buffer: Buffer.from(await archive.arrayBuffer()),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

export async function fullUiFlow(page: Page, info: TestInfo) {
  await page.setViewportSize({ width: 1280, height: 950 })
  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '创建卡组', exact: true }).first().click()
  let dialog = page.getByRole('dialog', { name: '创建卡组', exact: true })
  await sharedControls(dialog)
  await dialog.getByLabel('卡组名称', { exact: true }).fill('Unified GUI')
  await expect(dialog.locator('button[type="submit"]')).toHaveAttribute('data-variant', 'primary')
  await dialog.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await dismissNotices(page)

  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  dialog = page.getByRole('dialog', { name: '添加卡片', exact: true })
  await sharedControls(dialog)
  const front = dialog.getByLabel('正面 · 问题', { exact: true })
  await front.fill('The selected text remains intact.')
  await front.evaluate((element: HTMLTextAreaElement) => {
    element.focus()
    element.setSelectionRange(4, 17)
  })
  await dialog
    .getByRole('button', { name: '选中文字挖空 · Ctrl / ⌘ + Shift + C', exact: true })
    .click()
  await expect(front).toHaveValue('The {{c1::selected text}} remains intact.')
  await expect(dialog.getByLabel('笔记类型', { exact: true })).toHaveAttribute('value', 'cloze')
  await dialog.getByLabel('补充说明', { exact: false }).fill('The stored answer remains intact.')
  await expect(dialog.locator('.modal-header button')).toHaveAttribute('data-variant', 'ghost')
  await expect(dialog.locator('button[type="submit"]')).toHaveAttribute('data-variant', 'primary')
  await page.screenshot({ path: info.outputPath('unified-card-editor-wide.png') })
  await setResponsiveViewport(page, 390, 844)
  await fits(page)
  await page.setViewportSize({ width: 1280, height: 950 })
  await dialog.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await dismissNotices(page)

  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  const reveal = page.getByRole('button', { name: '显示答案', exact: true })
  await expect(reveal).toHaveAttribute('data-variant', 'primary')
  const undo = page.getByRole('button', { name: '撤销上次评分', exact: true })
  await expect(undo).toHaveClass(/\bui-button\b/)
  await expect(undo).toBeDisabled()
  await expect(undo).toHaveCSS('cursor', 'not-allowed')
  await reveal.click()
  for (const tone of ['again', 'hard', 'good', 'easy']) {
    const rating = page.locator(`.grade-button.${tone}`)
    await expect(rating).toHaveAttribute('data-variant', 'rating')
    await expect(rating).toHaveAttribute('data-tone', tone)
    await expect(rating).toBeEnabled()
  }
  const beforeEditing = await readBrowserLibrary(page)
  const menu = page.locator('.review-menu')
  await expect(menu).toHaveAttribute('aria-haspopup', 'menu')
  await menu.click()
  await expect(page.getByRole('menuitem', { name: /^编辑/ })).toBeEnabled()
  await page.getByRole('menuitem', { name: /^编辑/ }).click()
  dialog = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await sharedControls(dialog)
  await dialog.getByLabel('正面 · 问题', { exact: true }).fill('This edit must be discarded.')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.card-answer')).toContainText('The stored answer remains intact.')
  const afterEditing = await readBrowserLibrary(page)
  expect(afterEditing.reviews).toEqual(beforeEditing.reviews)
  expect(afterEditing.notes).toEqual(beforeEditing.notes)
  await page.screenshot({ path: info.outputPath('unified-review-wide.png'), fullPage: true })

  await sourcePages(page)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await dismissNotices(page)
  dialog = await openCollection(page)
  const content = 'A readable paragraph 中文🙂 with the shared GUI.\n\n'.repeat(80)
  await fillCollectionText(dialog, {
    title: 'Unified reading source',
    format: 'plain',
    text: content,
  })
  await sharedControls(dialog)
  await expect(dialog.getByRole('button', { name: '预览材料', exact: true })).toHaveAttribute(
    'data-variant',
    'primary',
  )
  await previewCollection(dialog)
  await commitCollection(dialog)
  const reader = page.getByRole('textbox', { name: '材料正文', exact: true })
  await expect(reader).toHaveAttribute('aria-busy', 'false')
  await expect(reader).toHaveAttribute('data-slot', 'base')
  await expect(reader).toHaveCSS('font-size', '18px')
  await expect(reader).toHaveJSProperty('readOnly', true)
  await expect(reader).toHaveValue(content)
  await showSourceFilters(page)
  for (const label of ['搜索材料', '材料类型', '优先级筛选'])
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('data-slot', 'base')
  const pagination = page.getByRole('navigation', { name: '材料列表分页', exact: true })
  await expect(pagination).toBeVisible()
  for (const button of await pagination.getByRole('button').all())
    await expect(button).toHaveClass(/\bui-button\b/)
  await pagination.getByRole('button', { name: '下一页', exact: true }).click()
  await pagination.getByRole('button', { name: '上一页', exact: true }).click()
  // Reading order puts the earlier due fixtures first; locate the new material via search.
  await page.getByLabel('搜索材料', { exact: true }).fill('Unified reading source')
  await page.locator('.source-list-title').filter({ hasText: 'Unified reading source' }).click()
  await page.getByRole('button', { name: '编辑材料信息', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '编辑材料信息', exact: true })
  await sharedControls(dialog)
  await dialog.getByLabel('材料标题', { exact: true }).fill('Discarded source title')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Unified reading source', exact: true }),
  ).toBeVisible()
  await dismissNotices(page)
  await page.evaluate(() => {
    const main = document.querySelector('.desktop-window > .main-content')
    if (main) main.scrollTo(0, 0)
    else window.scrollTo(0, 0)
  })
  await page.screenshot({ path: info.outputPath('unified-sources-wide.png') })
  await setResponsiveViewport(page, 390, 844)
  await expect(reader).toHaveAttribute('aria-busy', 'false')
  await fits(page)
  await expect(reader).toHaveCSS('font-size', '18px')
  expect((await readBrowserLibrary(page)).reviews).toEqual(beforeEditing.reviews)
}
