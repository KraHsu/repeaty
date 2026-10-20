import type { Page } from '@playwright/test'
import { test, expect, storedLibrary } from './fixture'
import {
  createSourceDeck,
  previewSource,
  saveSource,
  selectSourceExcerpt,
  sourceQuote,
} from '../fixtures/source-flow'

function query(page: Page, tool: string, args: Record<string, unknown> = {}) {
  return page.evaluate(
    ([tool, args]) =>
      (
        window as unknown as {
          __repeatyTestMcpCall(
            tool: string,
            args: Record<string, unknown>,
          ): Promise<{ status: string; data: Record<string, unknown>; code?: string }>
        }
      ).__repeatyTestMcpCall(tool, args),
    [tool, args] as const,
  )
}
async function prepareSource(page: Page) {
  await createSourceDeck(page)
  await previewSource(page)
  await saveSource(page)
  await selectSourceExcerpt(page)
  await page.getByRole('button', { name: '通过 MCP 制卡', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '通过 MCP 制卡', exact: true })
  await expect(dialog.getByRole('button', { name: '分享这段摘录' })).toBeDisabled()
  await dialog.getByRole('button', { name: '开启 MCP' }).click()
  await expect(dialog.getByRole('button', { name: '分享这段摘录' })).toBeEnabled()
  expect(await query(page, 'repeaty_selected_excerpt')).toMatchObject({
    status: 'error',
    code: 'selection-unavailable',
  })
  return dialog
}
async function share(page: Page) {
  await page.getByRole('button', { name: '分享这段摘录' }).click()
  await expect(page.getByRole('dialog', { name: '制卡草稿', exact: true })).toBeVisible()
  const selected = await query(page, 'repeaty_selected_excerpt')
  expect(selected).toMatchObject({ status: 'ok', data: { text: sourceQuote } })
  expect(JSON.stringify(selected)).not.toMatch(/tracker.png|sourceExecuted|More context/)
  return selected.data.selectionId
}

test('shared excerpts become editable drafts, save all three types with provenance, and retain only confirmed cards on restart', async ({
  page,
}, info) => {
  await prepareSource(page)
  const before = await storedLibrary(page)
  const selectionId = await share(page)
  const cards = [
    {
      type: 'basic',
      format: 'markdown',
      front: '题目 <script>globalThis.draftExecuted=true</script>',
      back: '初始答案',
      tags: ['FSRS', '待确认'],
    },
    { type: 'reversed', format: 'plain', front: 'spaced repetition', back: '间隔复习' },
    { type: 'cloze', front: '{{c1::间隔复习::方法}}会依据{{c2::记忆状态}}安排下一次学习。' },
  ]
  const input = { selectionId, requestId: 'batch-1', cards }
  const receipt = await query(page, 'repeaty_propose_cards', input)
  expect(receipt.status).toBe('ok')
  const queue = () => page.getByRole('dialog', { name: '制卡草稿', exact: true })
  await expect(queue().locator('.draft-list li')).toHaveCount(3)
  expect(await query(page, 'repeaty_propose_cards', input)).toEqual(receipt)
  expect(
    await query(page, 'repeaty_propose_cards', {
      ...input,
      cards: [{ type: 'cloze', front: 'Missing cloze' }],
    }),
  ).toMatchObject({ status: 'error', code: 'invalid-arguments' })
  expect(
    await query(page, 'repeaty_propose_cards', {
      ...input,
      cards: [{ type: 'basic', front: 'Changed', back: 'Answer' }],
    }),
  ).toMatchObject({ status: 'error', code: 'request-conflict' })
  expect(await storedLibrary(page)).toEqual(before)
  await queue().getByRole('button', { name: '检查并编辑' }).first().click()
  let editor = page.getByRole('dialog', { name: '确认制卡草稿' })
  await expect(editor.locator('#card-tags')).toHaveValue('FSRS, 待确认')
  await editor.locator('.note-preview summary').click()
  expect(
    await page.evaluate(() => (globalThis as Record<string, unknown>).draftExecuted),
  ).toBeUndefined()
  await editor.getByRole('button', { name: '关闭弹窗' }).click()
  await expect(queue().locator('.draft-list li')).toHaveCount(3)
  expect(await storedLibrary(page)).toEqual(before)
  // Stopping sharing closes external access but keeps received drafts reviewable.
  await queue().getByRole('button', { name: '停止分享' }).click()
  expect(await query(page, 'repeaty_selected_excerpt')).toMatchObject({
    status: 'error',
    code: 'selection-unavailable',
  })
  await queue().getByRole('button', { name: '检查并编辑' }).first().click()
  editor = page.getByRole('dialog', { name: '确认制卡草稿' })
  await editor.getByLabel('正面 · 问题', { exact: true }).fill('用户修改后的问题')
  await editor.getByLabel('背面 · 答案', { exact: true }).fill('用户确认的答案')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { failDraftSave: boolean }).failDraftSave = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if ((window as unknown as { failDraftSave: boolean }).failDraftSave && this.name === 'notes')
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await editor.getByRole('button', { name: '确认并保存卡片' }).click()
  await expect(editor.getByRole('alert')).toContainText('存储空间不足')
  expect(await storedLibrary(page)).toEqual(before)
  await expect(editor.getByLabel('正面 · 问题', { exact: true })).toHaveValue('用户修改后的问题')
  await page.evaluate(() => {
    ;(window as unknown as { failDraftSave: boolean }).failDraftSave = false
  })
  await editor.getByRole('button', { name: '确认并保存卡片' }).click()
  await expect(queue().locator('.draft-list li')).toHaveCount(2)
  for (let remaining = 2; remaining > 0; remaining--) {
    await queue().getByRole('button', { name: '检查并编辑' }).first().click()
    await page.getByRole('button', { name: '确认并保存卡片' }).click()
    await expect(queue().locator('.draft-list li')).toHaveCount(remaining - 1)
  }
  const saved = await storedLibrary(page)
  expect(saved.notes).toHaveLength(3)
  expect(saved.cards).toHaveLength(5)
  expect(saved.reviews).toHaveLength(0)
  expect(saved.notes).toMatchObject(
    Array.from({ length: 3 }, () => ({ value: { excerpt: { quote: sourceQuote } } })),
  )
  await queue().getByRole('button', { name: '关闭弹窗' }).click()
  // Share again for a new batch and leave it unconfirmed.
  await selectSourceExcerpt(page)
  await page.getByRole('button', { name: '通过 MCP 制卡', exact: true }).click()
  const nextSelection = await share(page)
  await query(page, 'repeaty_propose_cards', {
    selectionId: nextSelection,
    requestId: 'pending-restart',
    cards: [cards[0]],
  })
  await expect(queue().locator('.draft-list li')).toHaveCount(1)
  expect(await storedLibrary(page)).toEqual(saved)
  await queue().getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByLabel('界面语言').selectOption('en')
  await page.getByRole('button', { name: 'Card drafts (1)' }).click()
  await page.setViewportSize({ width: 720, height: 850 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('drafts-en.png'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('button', { name: /^Card drafts/ })).toHaveCount(0)
  expect(await storedLibrary(page)).toEqual(saved)
  // Provenance is ordinary saved card data and remains available during review.
  await page.getByRole('button', { name: 'Start review', exact: true }).first().click()
  await page.getByRole('button', { name: 'Show answer', exact: true }).click()
  await page.getByRole('button', { name: /^View source/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText(sourceQuote)
})

test('lost replies do not display drafts, retry is safe, and deleted sources cannot be saved', async ({
  page,
}) => {
  await prepareSource(page)
  const selectionId = await share(page)
  const before = await storedLibrary(page)
  const input = {
    selectionId,
    requestId: 'retry-batch',
    cards: [{ type: 'basic', front: 'Q'.repeat(9000), back: 'A' }],
  }
  await page.evaluate(() => {
    ;(window as unknown as { __repeatyTestMcpFailReply: boolean }).__repeatyTestMcpFailReply = true
  })
  expect(await query(page, 'repeaty_propose_cards', input)).toMatchObject({
    status: 'error',
    code: 'read-timeout',
  })
  const queue = page.getByRole('dialog', { name: '制卡草稿', exact: true })
  await expect(queue.locator('.draft-list li')).toHaveCount(0)
  await page.evaluate(() => {
    ;(window as unknown as { __repeatyTestMcpFailReply: boolean }).__repeatyTestMcpFailReply = false
  })
  const receipt = await query(page, 'repeaty_propose_cards', input)
  await expect(queue.locator('.draft-list li')).toHaveCount(1)
  expect(await query(page, 'repeaty_propose_cards', input)).toEqual(receipt)
  expect(await storedLibrary(page)).toEqual(before)
  await queue.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('button', { name: '删除材料', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await query(page, 'repeaty_selected_excerpt')).toMatchObject({
    status: 'error',
    code: 'selection-unavailable',
  })
  await page.getByRole('button', { name: '制卡草稿（1）', exact: true }).click()
  await expect(queue.getByRole('button', { name: '检查并编辑' })).toBeDisabled()
  await expect(queue).toContainText('材料或卡组已不存在')
  await queue.getByRole('button', { name: '丢弃草稿' }).click()
  await expect(queue.locator('.draft-list li')).toHaveCount(0)
  const after = await storedLibrary(page)
  expect(after.notes).toEqual(before.notes)
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
})
