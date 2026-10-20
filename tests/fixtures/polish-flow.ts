import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fixture, input, now } from '../../src/core/test-fixtures'
import { saveNote, type Library } from '../../src/core/model'

export async function seedPolish(page: Page, library = fixture()) {
  await page.goto('./')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'polish.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
export async function reviewPolishFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  let library = fixture({ front: 'History card', back: 'Original answer', format: 'markdown' })
  const id = library.cards[0]!.id
  library = saveNote(
    library,
    { ...input, front: 'Next card', back: 'Next answer' },
    undefined,
    false,
    new Date(now.getTime() + 1000),
  )
  library.reviews = [1, 2, 3, 4].map((rating, i) => ({
    id: `past-${i}`,
    cardId: id,
    rating: rating as 1 | 2 | 3 | 4,
    reviewedAt: new Date(now.getTime() + i * 1000).toISOString(),
    nextDue: now.toISOString(),
    studyDay: '2026-10-17',
    kind: 'legacy',
    source: 'normal',
  }))
  await seedPolish(page, library)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByLabel('显示最近几次评分', { exact: true }).fill('2')
  await page.getByLabel('显示最近几次评分', { exact: true }).blur()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await expect(page.locator('.deck-study-status .new dd')).toHaveText('2')
  await page.locator('.deck-review').click()
  await expect(page.locator('.flashcard')).toContainText('History card')
  await expect(page.locator('.review-history-dots')).toHaveCount(0)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.review-history-dots .history-dot')).toHaveCount(3)
  await expect(page.locator('.review-history-dots .rating-3')).toHaveCount(1)
  await expect(page.locator('.review-history-dots .rating-4')).toHaveCount(1)
  await expect(page.locator('.review-history-dots .current')).toHaveCSS(
    'border-top-style',
    'dashed',
  )
  const before = await read()
  await page.locator('.flashcard').click()
  await page.keyboard.press('e')
  const editor = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await expect(editor).toBeVisible()
  await editor
    .locator('#card-front')
    .fill('**修改：**重新学习\n\n```python\ndef answer():\n    return 42\n```')
  await editor.locator('#card-back').fill('Updated answer')
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('.flashcard strong')).toHaveText('修改：')
  await expect(page.locator('.flashcard .hljs-keyword').first()).toBeVisible()
  await expect(page.locator('.card-answer')).toHaveCount(0)
  await expect(page.locator('.review-history-dots')).toHaveCount(0)
  const edited = await read()
  expect([...edited.cards].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    [...before.cards].sort((a, b) => a.id.localeCompare(b.id)),
  )
  expect(edited.reviews).toEqual(before.reviews)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer')).toContainText('Updated answer')
  await page.getByLabel('更多操作', { exact: true }).click()
  await page.locator('.review-menu').getByRole('button', { name: /编辑/ }).click()
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await expect(page.locator('.card-answer')).toContainText('Updated answer')
  await page.getByRole('button', { name: /^简单/ }).click()
  await expect(page.locator('.flashcard')).toContainText('Next card')
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.review-history-dots .history-dot')).toHaveCount(1)
  expect((await read()).reviews).toHaveLength(5)
  await page.getByRole('button', { name: '撤销上次评分', exact: true }).click()
  expect((await read()).reviews).toEqual(before.reviews)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByLabel('翻面后才显示历史', { exact: true }).uncheck()
  await page.reload()
  await page.locator('.deck-review').click()
  await expect(page.locator('.review-history-dots .history-dot')).toHaveCount(3)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('switch', { name: '启用 答题历史', exact: true }).uncheck()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.locator('.deck-review').click()
  await expect(page.locator('.review-history-dots')).toHaveCount(0)
  expect([...(await read()).cards].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    [...before.cards].sort((a, b) => a.id.localeCompare(b.id)),
  )
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('switch', { name: '启用 答题历史', exact: true }).check()
  await page.getByLabel('界面语言').selectOption('en')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByLabel('Number of recent ratings', { exact: true })).toHaveValue('2')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('history-settings-en.png'), fullPage: true })
}

export async function skillSettingsFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await seedPolish(page)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('信息通知', { exact: true }).uncheck()
  await page.getByLabel('警告通知', { exact: true }).uncheck()
  await page.getByRole('tab', { name: 'AI 制卡', exact: true }).click()
  await expect(page.getByLabel('制卡说明（可直接粘贴到 AI 聊天中）')).toHaveValue(
    /name: repeaty-cards/,
  )
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 SKILL.md', exact: true }).click()
  const file = await downloading
  expect(await readFile((await file.path())!, 'utf8')).toContain('type,front,back,tags,format')
  await page.getByRole('button', { name: '全部卡片', exact: false }).click()
  await page.getByRole('button', { name: '批量导入', exact: true }).click()
  await page
    .getByLabel('选择 CSV / TSV 文件')
    .setInputFiles('public/skills/repeaty-cards/example.csv')
  await page.getByRole('button', { name: '检查并预览', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('共 2 条笔记，将生成 2 张卡片')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await read()).notes).toHaveLength(3)
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByLabel('信息通知', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('警告通知', { exact: true })).not.toBeChecked()
  await page.getByLabel('界面语言').selectOption('en')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('settings-general-en.png'), fullPage: true })
}
