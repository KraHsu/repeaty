import { test, expect } from '@playwright/test'
import { reviewPolishFlow, skillSettingsFlow, seedPolish } from './fixtures/polish-flow'
import { readBrowserLibrary, startMixed } from './fixtures/adaptive-mixed-flow'
import { importReading, readingText } from './fixtures/reading-flow'
import { fixture, now } from '../src/core/test-fixtures'
import { selectSettingsCategory } from './fixtures/settings-flow'

test('review editing, Chinese emphasis, code highlighting and configurable history work together', async ({
  page,
}, info) => {
  await reviewPolishFlow(page, () => readBrowserLibrary(page), info)
})
test('settings and the no-MCP skill persist and import through CSV', async ({ page }, info) => {
  await skillSettingsFlow(page, () => readBrowserLibrary(page), info)
})
test('info expires, warnings persist until dismissed, and popup preferences preserve warnings', async ({
  page,
}) => {
  const library = fixture({ type: 'reversed' })
  library.decks[0]!.leechThreshold = 1
  const card = library.cards[0]!
  card.createdAt = new Date(now.getTime() - 1000).toISOString()
  card.schedule = {
    ...card.schedule,
    state: 2,
    stability: 2,
    difficulty: 5,
    reps: 3,
    elapsed_days: 3,
    scheduled_days: 3,
    last_review: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
  }
  await seedPolish(page, library)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.locator('.deck-review').click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^重来/ }).click()
  const info = page.locator('.notification.info').filter({ hasText: '关联卡片' }),
    warning = page.locator('.notification.warning')
  await expect(info).toBeVisible()
  await expect(warning).toContainText('顽固卡')
  await expect(info).toHaveCount(0, { timeout: 8000 })
  await expect(warning).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('警告通知', { exact: true }).uncheck()
  await expect(page.locator('.inline-notifications .warning')).toContainText('顽固卡')
  await page.locator('.inline-notifications .warning button').click()
  await expect(warning).toHaveCount(0)
})

test('a failed grade keeps the current answer and can be retried once, with a manually dismissed error', async ({
  page,
}) => {
  await seedPolish(page)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.locator('.deck-review').click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    Object.assign(window, { failGrade: true })
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'cards' && (window as unknown as { failGrade: boolean }).failGrade)
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.locator('.grade-button.good').click()
  await expect(page.locator('.notification.error')).toContainText('存储空间不足')
  await expect(page.locator('.card-answer')).toBeVisible()
  expect((await readBrowserLibrary(page)).reviews).toHaveLength(0)
  await page.evaluate(() => Object.assign(window, { failGrade: false }))
  await page.locator('.grade-button.good').click()
  await expect(page.locator('.flashcard')).toHaveCount(0)
  expect((await readBrowserLibrary(page)).reviews).toHaveLength(1)
  await expect(page.locator('.notification.error')).toBeVisible()
  await page.locator('.notification.error button').click()
  await expect(page.locator('.notification.error')).toHaveCount(0)
})
test('the no-MCP instructions remain available offline', async ({ page, context }) => {
  await page.goto('./')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await context.setOffline(true)
  await selectSettingsCategory(page, 'tools.ai')
  await expect(page.getByLabel('制卡说明（可直接粘贴到 AI 聊天中）')).toHaveValue(
    /name: repeaty-cards/,
  )
})

test('editing a cloze during mixed study restarts its question and preserves the reading ratio and undo', async ({
  page,
}) => {
  const library = fixture({
    type: 'cloze',
    format: 'markdown',
    front: '{{c1::Original}} and {{c2::Other}}',
    back: 'Extra',
  })
  library.cards.find((card) => card.variant === 'cloze:1')!.createdAt = new Date(
    now.getTime() - 1000,
  ).toISOString()
  await seedPolish(page, library)
  await importReading(page, 'Mixed edit context', 'plain', readingText)
  await startMixed(page)
  await page.locator('.flashcard').click()
  await page.keyboard.press('e')
  const editor = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await editor.locator('#card-front').fill('{{c1::Changed}} and {{c2::Other}}')
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('.card-answer')).toHaveCount(0)
  await expect(page.locator('.mixed-header')).toContainText('已复习 0 次 · 已处理 0 篇')
  expect((await readBrowserLibrary(page)).reviews).toHaveLength(0)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer')).toContainText('Changed')
  await page.locator('.grade-button.easy').click()
  await expect(page.locator('.source-reader')).toContainText('Mixed edit context')
  await expect(page.locator('.mixed-header')).toContainText('已复习 1 次 · 已处理 0 篇')
  await page.getByRole('button', { name: '撤销上次评分', exact: true }).click()
  await expect(page.locator('.flashcard')).toBeVisible()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer')).toContainText('Changed')
  expect((await readBrowserLibrary(page)).reviews).toHaveLength(0)
})
