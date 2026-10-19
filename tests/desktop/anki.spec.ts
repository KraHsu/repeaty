import { test, expect, storedLibrary } from './fixture'
import type { Library } from '../../src/core/model'
import { createImportDeck, previewAnki, confirmAnki } from '../fixtures/anki-flow'

test('desktop imports Anki with a local worker and persists complete notes and media', async ({
  page,
}) => {
  await createImportDeck(page)
  await previewAnki(page)
  await confirmAnki(page)
  await page.reload()
  const saved = await storedLibrary(page)
  expect(saved.notes).toHaveLength(4)
  expect(saved.cards).toHaveLength(6)
  expect(saved.reviews).toHaveLength(0)
  expect(saved.media).toHaveLength(2)
  await previewAnki(page, 'legacy')
  await expect(page.locator('.anki-preview')).toContainText('可导入 0 条，已存在 4 条')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await previewAnki(page, 'updated')
  await page.getByRole('button', { name: '选择所有内容不同的笔记', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled()
  await page.getByLabel('我已确认以上卡片变化').check()
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  const updated = await storedLibrary(page)
  expect(updated.notes).toHaveLength(5)
  expect(updated.cards).toHaveLength(6)
  const oldCards = (saved.cards as { value: Library['cards'][number] }[]).map((row) => row.value)
  for (const card of (updated.cards as { value: Library['cards'][number] }[])
    .map((row) => row.value)
    .filter((entry) => oldCards.some((old) => old.id === entry.id)))
    expect(card).toEqual(oldCards.find((old) => old.id === card.id))
  await previewAnki(page, 'updated')
  await expect(page.locator('.anki-preview')).toContainText('5 条相同，0 条内容不同')
})
