import { test, expect, storedLibrary } from './fixture'
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
})
