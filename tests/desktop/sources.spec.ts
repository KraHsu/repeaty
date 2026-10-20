import { test, expect, storedLibrary } from './fixture'
import {
  createSourceDeck,
  previewSource,
  saveSource,
  createExcerptCard,
  sourceText,
  sourceQuote,
} from '../fixtures/source-flow'
import { readFile } from 'node:fs/promises'

test('desktop stores local sources, creates excerpts, exports the snapshot through native IPC and retains it after restart', async ({
  page,
}) => {
  await createSourceDeck(page)
  await previewSource(page)
  await saveSource(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出原文', exact: true }).click()
  expect(await readFile((await (await download).path())!, 'utf8')).toBe(sourceText)
  await createExcerptCard(page)
  await page.reload()
  const saved = await storedLibrary(page)
  expect(saved.sources).toHaveLength(1)
  expect(saved.notes).toMatchObject([
    { value: { excerpt: { quote: sourceQuote, start: sourceText.lastIndexOf(sourceQuote) } } },
  ])
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText(sourceQuote)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.reload()
  const rated = await storedLibrary(page)
  expect(rated.reviews).toHaveLength(1)
  expect(rated.sources).toEqual(saved.sources)
})
