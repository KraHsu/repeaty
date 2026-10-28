import { selectUiValue } from './fixtures/ui-flow'
import { setInterfaceLanguage } from './fixtures/settings-flow'
import { test, expect } from './fixtures/empty-workspace'
import { createImportDeck, previewAnki, confirmAnki } from './fixtures/anki-flow'
import { ankiNoteId } from '../src/core/anki/types'
import { parseArchive } from '../src/core/archive'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

async function backup(page: Page) {
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  return parseArchive(new Blob([await readFile((await (await download).path())!)]))
}
const selector = (guid: string) => `.anki-change[data-note-id="${ankiNoteId(`rpt-${guid}`)}"]`

test('compares repeated exports, updates selected content and media, and confirms variant changes', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await createImportDeck(page)
  await previewAnki(page)
  await confirmAnki(page)
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('What')
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await selectUiValue(page.getByLabel('练习模式'), 'true')
  await page.getByRole('button', { name: '开始专项练习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮练习结束' })).toBeVisible()
  const before = await backup(page)
  await previewAnki(page, 'updated')
  await expect(page.locator('.anki-preview')).toContainText('3 条内容不同')
  await expect(page.locator('.anki-preview')).toContainText('1 条相同')
  await expect(page.locator('.anki-preview')).toContainText('已选择更新 0 条笔记')
  const basic = page.locator(selector('basic'))
  await basic.getByRole('button', { name: '查看内容比较', exact: true }).click()
  await expect(basic.locator('.anki-compare-side').first()).toContainText('2 + 2')
  await expect(basic.locator('.anki-compare-side').last()).toContainText('3 + 3')
  await expect(basic.locator('.anki-compare-side').last()).toContainText('中文长文本')
  await expect(basic.locator('audio')).toHaveCount(2)
  await expect(basic.getByRole('img', { name: 'pixel.png' })).toHaveCount(3)
  await page.screenshot({ path: testInfo.outputPath('comparison-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await setInterfaceLanguage(page, 'en')
  await previewAnki(page, 'updated')
  await basic.getByRole('button', { name: 'Compare content', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(basic).toContainText('Content in Repeaty')
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  )
  expect(await basic.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('comparison-mobile-en.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await setInterfaceLanguage(page, 'zh-CN')
  await previewAnki(page, 'updated')
  await basic.getByRole('button', { name: '查看内容比较', exact: true }).click()
  await basic.getByLabel('采用文件内容').check()
  await expect(page.locator('.anki-preview')).toContainText('已选择更新 1 条笔记')
  await expect(page.locator('.anki-card-impact')).toHaveCount(0)
  const reportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载报告', exact: true }).click()
  const report = JSON.parse(await readFile((await (await reportDownload).path())!, 'utf8'))
  expect(report.version).toBe(2)
  expect(report.notes.find((note: { guid: string }) => note.guid === 'rpt-basic').decision).toBe(
    'update',
  )
  expect(report.notes.find((note: { guid: string }) => note.guid === 'rpt-reverse').decision).toBe(
    'keep',
  )
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  const after = await backup(page)
  expect(
    after.library.cards.filter((card) => before.library.cards.some((old) => old.id === card.id)),
  ).toEqual(before.library.cards)
  expect(after.library.cards).toHaveLength(7)
  expect(after.library.reviews).toEqual(before.library.reviews)
  const beforeImage = before.assets.find((asset) => asset.meta.name === 'pixel.png')!
  const afterImage = after.assets.find((asset) => asset.meta.name === 'pixel.png')!
  expect(afterImage.meta.id).toBe(beforeImage.meta.id)
  const beforeAudio = before.assets.find((asset) => asset.meta.name === 'voice.wav')!
  const afterAudio = after.assets.find((asset) => asset.meta.name === 'voice.wav')!
  expect(afterAudio.meta.id).not.toBe(beforeAudio.meta.id)
  expect(Buffer.from(await afterAudio.blob.arrayBuffer())).not.toEqual(
    Buffer.from(await beforeAudio.blob.arrayBuffer()),
  )
  await previewAnki(page, 'updated')
  await expect(page.locator('.anki-preview')).toContainText('2 条内容不同')
  await page.locator(selector('reverse')).getByLabel('采用文件内容').check()
  await page.locator(selector('cloze')).getByLabel('采用文件内容').check()
  await expect(page.locator('.anki-card-impact')).toContainText('新增 1 张卡片、移除 2 张卡片')
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled()
  const acknowledgement = page.getByLabel('我已确认以上卡片变化')
  await acknowledgement.check()
  await page.locator(selector('cloze')).getByLabel('采用文件内容').uncheck()
  await expect(acknowledgement).not.toBeChecked()
  await page.locator(selector('cloze')).getByLabel('采用文件内容').check()
  await acknowledgement.check()
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  const final = await backup(page)
  expect(final.library.cards).toHaveLength(6)
  expect(final.library.reviews).toEqual(before.library.reviews)
  expect(
    final.library.cards
      .filter((card) => card.noteId === ankiNoteId('rpt-cloze'))
      .map((card) => card.variant),
  ).toEqual(['cloze:1', 'cloze:3'])
  await previewAnki(page, 'updated')
  await expect(page.locator('.anki-preview')).toContainText('5 条相同，0 条内容不同')
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})
