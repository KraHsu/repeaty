import { selectUiValue } from './ui-flow'
import { expect, type Page } from '@playwright/test'

export async function createImportDeck(page: Page) {
  await page.getByRole('button', { name: '新建卡组', exact: true }).click()
  await page.getByLabel('卡组名称').fill('From Anki')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
export async function previewAnki(page: Page, format: 'modern' | 'legacy' | 'updated' = 'modern') {
  await page.getByRole('button', { name: /^(全部卡片|All cards)/ }).click()
  await page.getByRole('button', { name: /^(批量导入|Bulk import)$/ }).click()
  await selectUiValue(page.getByLabel(/^(导入格式|Import format)$/), 'anki')
  await page
    .getByLabel(/^(选择 Anki 文件|Choose Anki file)$/)
    .setInputFiles(`tests/fixtures/anki/${format}.apkg`)
  await expect(page.locator('.anki-preview')).toContainText(
    new RegExp(`(共 ${format === 'updated' ? 5 : 7} 条笔记|${format === 'updated' ? 5 : 7} notes)`),
    { timeout: 20_000 },
  )
}
export async function confirmAnki(page: Page) {
  await expect(page.locator('.anki-preview')).toContainText('可导入 4 条，已存在 0 条，跳过 3 条')
  await expect(page.locator('.anki-preview')).toContainText('将添加 6 张新卡和 2 个附件')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('tbody tr')).toHaveCount(6)
}
