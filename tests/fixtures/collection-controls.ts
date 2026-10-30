import { expect, type Locator, type Page } from '@playwright/test'
import { selectUiValue } from './ui-flow'

/** Exercise the public two-step collection flow; never seed the collection service. */
export async function openCollection(page: Page, destination: 'library' | 'inbox' = 'library') {
  await page
    .locator('.app-page-header__actions')
    .getByRole('button', { name: '收集材料', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: '收集材料', exact: true })
  await selectUiValue(dialog.getByRole('combobox', { name: '保存到', exact: true }), destination)
  return dialog
}

export async function fillCollectionText(
  dialog: Locator,
  input: { title: string; text: string; format?: 'plain' | 'markdown'; url?: string },
) {
  await dialog.getByRole('button', { name: '粘贴或输入文字', exact: true }).click()
  await dialog.getByLabel('标题（可选）', { exact: true }).fill(input.title)
  await selectUiValue(
    dialog.getByRole('combobox', { name: '格式', exact: true }),
    input.format ?? 'markdown',
  )
  // Keep all leading/trailing bytes: reading offsets and source versions depend on them.
  await dialog.getByRole('textbox', { name: '正文', exact: true }).fill(input.text)
  if (input.url) await dialog.getByLabel('来源链接（可选）', { exact: true }).fill(input.url)
}

export async function previewCollection(dialog: Locator) {
  await dialog.getByRole('button', { name: '预览材料', exact: true }).click()
}

export async function selectCollectionImporter(dialog: Locator, importer: string) {
  for (const control of await dialog.getByTestId('collection-importer').all())
    await selectUiValue(control, importer)
}

export async function commitCollection(
  dialog: Locator,
  destination: 'library' | 'inbox' = 'library',
) {
  await dialog
    .getByRole('button', {
      name: destination === 'inbox' ? '保存到收件箱' : '保存到阅读材料',
      exact: true,
    })
    .click()
  await expect(dialog).toHaveCount(0)
}

export async function cancelCollection(dialog: Locator) {
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
