import { selectUiValue } from './ui-flow'
import { setResponsiveViewport } from './viewport-flow'
import { setInterfaceLanguage } from './settings-flow'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fixture, input, now } from '../../src/core/test-fixtures'
import { saveNote, type Library } from '../../src/core/model'
import { parseArchive } from '../../src/core/archive'
import { importReading, moveReading, saveReading, readingText } from './reading-flow'
import { queueView } from './reading-queue-flow'
import { storedLibrary } from './stored-library'

export async function readBrowserLibrary(page: Page): Promise<Library> {
  const rows = await storedLibrary(page)
  return {
    version: 18,
    ...Object.fromEntries(
      Object.entries(rows).map(([key, rows]) => [
        key,
        (rows as { value: unknown }[]).map((row) => row.value),
      ]),
    ),
  } as Library
}
export async function seedMixedCards(page: Page) {
  let library = fixture({ front: 'Mixed first', back: 'First answer' })
  for (let i = 2; i <= 3; i++)
    library = saveNote(
      library,
      { ...input, front: `Mixed ${i}`, back: `Answer ${i}` },
      undefined,
      false,
      now,
    )
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'mixed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ format: 'repeaty-backup', version: 13, library, assets: [] }),
    ),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
export async function adaptiveDialog(page: Page) {
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '读过，安排下次', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '读过，安排下次', exact: true })
  await selectUiValue(dialog.getByLabel('间隔方式', { exact: true }), 'adaptive')
  return dialog
}
export async function adaptiveFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await seedMixedCards(page)
  await importReading(page, 'Adaptive material', 'plain', readingText)
  await moveReading(page, 0.55)
  await saveReading(page)
  const before = await read()
  let dialog = await adaptiveDialog(page)
  await expect(dialog).toContainText('本次间隔：2天')
  await dialog.getByLabel('已经熟悉', { exact: true }).check()
  await expect(dialog).toContainText('本次间隔：3天')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect((await read()).sources[0]!.adaptiveReading).toBeUndefined()
  dialog = await adaptiveDialog(page)
  await dialog.getByLabel('已经熟悉', { exact: true }).check()
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const scheduled = await read(),
    source = scheduled.sources[0]!
  expect(source.adaptiveReading).toMatchObject({ intervalDays: 3, readCount: 1, feedback: 'easy' })
  expect(source.reading!.offset).toBeGreaterThan(0)
  expect(scheduled.cards).toEqual(before.cards)
  expect(scheduled.reviews).toEqual(before.reviews)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await queueView(page, '稍后阅读')
  dialog = await adaptiveDialog(page)
  await expect(dialog.getByLabel('间隔方式')).toHaveAttribute('value', 'adaptive')
  await dialog.getByLabel('需要再读', { exact: true }).check()
  await expect(dialog).toContainText('本次间隔：2天')
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const second = (await read()).sources[0]!
  expect(second.adaptiveReading).toMatchObject({ intervalDays: 2, readCount: 2, feedback: 'again' })
  await page.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
  expect((await read()).sources[0]!.adaptiveReading).toEqual(source.adaptiveReading)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const file = await download
  const bytes = await readFile((await file.path())!)
  const restored = await parseArchive(new Blob([new Uint8Array(bytes)]))
  expect(restored.library.sources[0]!.adaptiveReading).toEqual(source.adaptiveReading)
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page.getByRole('button', { name: /^Read later 1$/ }).click()
  await page.getByRole('button', { name: 'Read and schedule next', exact: true }).click()
  await selectUiValue(page.getByLabel('Interval method', { exact: true }), 'adaptive')
  await setResponsiveViewport(page, 390, 844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('adaptive-reading-en.png'), fullPage: true })
}
export async function startMixed(page: Page) {
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始混合学习', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '开始混合学习', exact: true })
  await dialog.getByLabel('每轮先复习几张卡片？', { exact: true }).fill('1')
  await dialog.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
export async function mixedFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await seedMixedCards(page)
  await importReading(page, 'Mixed reading A', 'plain', readingText)
  await importReading(page, 'Mixed reading B', 'plain', readingText)
  const before = await read()
  await startMixed(page)
  const mixed = page.getByRole('region', { name: '混合学习', exact: true })
  const grade = async () => {
    await mixed.getByRole('button', { name: '显示答案', exact: true }).click()
    await mixed.getByRole('button', { name: /^简单/ }).click()
  }
  await grade()
  await expect(mixed.getByRole('heading', { name: 'Mixed reading A', exact: true })).toBeVisible()
  await moveReading(page, 0.6)
  let dialog = await adaptiveDialog(page)
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(mixed.locator('.flashcard')).toBeVisible()
  await expect(mixed).toContainText('已复习 1 次 · 已处理 1 篇')
  expect(
    (await read()).sources.find((s) => s.title === 'Mixed reading A')!.adaptiveReading?.readCount,
  ).toBe(1)
  await mixed.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
  await expect(mixed.getByRole('heading', { name: 'Mixed reading A', exact: true })).toBeVisible()
  expect((await read()).reviews).toHaveLength(1)
  await mixed.getByRole('button', { name: '撤销上次评分', exact: true }).click()
  await expect(mixed.locator('.flashcard')).toBeVisible()
  expect((await read()).reviews).toHaveLength(0)
  await grade()
  await expect(mixed.getByRole('heading', { name: 'Mixed reading A', exact: true })).toBeVisible()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  dialog = await adaptiveDialog(page)
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(mixed.locator('.flashcard')).toBeVisible()
  await grade()
  await expect(mixed.getByRole('heading', { name: 'Mixed reading B', exact: true })).toBeVisible()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await mixed.getByRole('button', { name: '完成阅读，继续学习', exact: true }).click()
  await grade()
  await expect(mixed.getByRole('heading', { name: '本轮混合学习结束', exact: true })).toBeVisible()
  await expect(mixed).toContainText('已复习 3 次 · 已处理 2 篇')
  const after = await read()
  expect(after.reviews).toHaveLength(3)
  expect(after.cards).toHaveLength(before.cards.length)
  expect(after.sources.find((s) => s.title === 'Mixed reading A')!.adaptiveReading?.readCount).toBe(
    1,
  )
  await page.screenshot({ path: info.outputPath('mixed-study-complete.png'), fullPage: true })
  await mixed.getByRole('button', { name: '返回学习概览', exact: true }).click()
  await page.reload()
  const restarted = await read()
  expect(restarted.reviews).toEqual(after.reviews)
  expect(restarted.sources).toEqual(after.sources)
  await page.getByRole('button', { name: '开始混合学习', exact: true }).click()
  await setResponsiveViewport(page, 390, 844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('mixed-study-narrow.png'), fullPage: true })
}
