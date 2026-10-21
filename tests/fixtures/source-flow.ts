import { expect, type Page } from '@playwright/test'
export const sourceQuote = '间隔复习会根据记忆状态安排下一次学习。🙂'
export const sourceText =
  `# 学习笔记\n\n${sourceQuote}\n\n` +
  '上下文与长文本。More context.\n'.repeat(1600) +
  `\n${sourceQuote}\n\n$$R=e^{-t/S}$$\n\n![outside](https://example.invalid/tracker.png)\n<script>globalThis.sourceExecuted=true</script>`

export async function createSourceDeck(page: Page) {
  await page.getByRole('button', { name: '新建卡组', exact: true }).click()
  await page.getByLabel('卡组名称').fill('摘录卡组')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
export async function previewSource(page: Page) {
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByRole('button', { name: '导入材料', exact: true }).click()
  await page.getByLabel('选择材料文件').setInputFiles({
    name: '学习笔记.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(sourceText),
  })
  await expect(page.getByLabel('材料标题')).toHaveValue('学习笔记')
  await page.getByLabel('来源链接（可选）').fill('https://example.invalid/article')
}
export async function saveSource(page: Page) {
  await page.getByRole('button', { name: '保存材料', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(sourceText)
}
export async function selectSourceExcerpt(page: Page) {
  const start = sourceText.lastIndexOf(sourceQuote)
  await page.getByRole('textbox', { name: '材料正文', exact: true }).evaluate(
    (el: HTMLTextAreaElement, { start, end }) => {
      el.focus()
      el.setSelectionRange(start, end)
      el.dispatchEvent(new Event('select', { bubbles: true }))
    },
    { start, end: start + sourceQuote.length },
  )
  await expect(page.getByRole('button', { name: '用摘录制卡', exact: true })).toBeEnabled()
}
export async function createExcerptCard(page: Page) {
  await selectSourceExcerpt(page)
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await expect(page.getByLabel('背面 · 答案', { exact: true })).toHaveValue(sourceQuote)
  await page.getByLabel('正面 · 问题', { exact: true }).fill('间隔复习如何安排时间？')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Selecting an excerpt scrolls the reader; let that position finish autosaving.
  await expect(page.locator('.reading-progress')).toHaveAttribute('data-reading-status', 'saved')
}
