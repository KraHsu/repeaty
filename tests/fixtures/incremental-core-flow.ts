import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library } from '../../src/core/model'
import { parseArchive } from '../../src/core/archive'
import { sourceArrangement } from '../../src/core/reading-operations'
import { restoreFilters } from './reading-filter-flow'
import { queueView } from './reading-queue-flow'
import { changeSourceDetails } from './source-details-flow'
import { createSourceDeck } from './source-flow'
import { importReading } from './reading-flow'
import { saveIndependentExcerpt, selectForExcerpt } from './source-excerpt-flow'

async function openBatch(page: Page, operation: 'priority' | 'defer' | 'archive' | 'restore') {
  await page.getByRole('button', { name: '批量安排', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量安排', exact: true })
  await dialog.getByLabel('批量操作', { exact: true }).selectOption(operation)
  return dialog
}
async function confirmBatch(page: Page) {
  const dialog = page.getByRole('dialog', { name: '批量安排', exact: true })
  await dialog.getByRole('button', { name: '确认批量安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
export async function batchReadingFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await restoreFilters(page)
  const baseline = await read()
  await page.getByLabel('材料类型', { exact: true }).selectOption('excerpt')
  await page.getByLabel('优先级筛选', { exact: true }).selectOption('high')
  await page.getByLabel('搜索材料', { exact: true }).fill('Topic')
  await page.getByRole('button', { name: '选择本页', exact: true }).click()
  await expect(page.locator('.source-selection-toolbar')).toContainText('已选 20 篇材料')
  await page
    .locator('.source-list-pages')
    .getByRole('button', { name: '下一页', exact: true })
    .click()
  await page.getByRole('checkbox', { name: '选择材料「Topic 21」', exact: true }).check()
  await expect(page.locator('.source-selection-toolbar')).toContainText('已选 21 篇材料')
  let dialog = await openBatch(page, 'priority')
  await dialog.getByLabel('阅读优先级', { exact: true }).selectOption('low')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect((await read()).sources.map(sourceArrangement)).toEqual(
    baseline.sources.map(sourceArrangement),
  )
  dialog = await openBatch(page, 'priority')
  await dialog.getByLabel('阅读优先级', { exact: true }).selectOption('low')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('界面语言').selectOption('en')
  const english = page.getByRole('dialog', { name: 'Arrange selected sources', exact: true })
  await expect(english).toContainText('21 selected sources')
  expect(await english.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(
    await english
      .locator('select')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: info.outputPath('batch-reading-en.png'), fullPage: true })
  await page.getByLabel('Interface language').selectOption('zh-CN')
  await confirmBatch(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByRole('heading', { name: '没有匹配的材料', exact: true })).toBeVisible()
  const lowered = await read()
  const targets = lowered.sources.filter((source) => /^Topic \d\d$/.test(source.title))
  expect(targets).toHaveLength(21)
  expect(targets.every((source) => source.priority === 'low')).toBe(true)
  expect(lowered.cards).toEqual(baseline.cards)
  expect(lowered.reviews).toEqual(baseline.reviews)

  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByLabel('搜索材料', { exact: true }).fill('Topic 01')
  await changeSourceDetails(page, 'Later title🙂')
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束', exact: true })).toBeVisible()
  const rated = await read()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤销阅读安排', exact: true })).toHaveCount(0)
  const undone = await read()
  expect(undone.sources.map(sourceArrangement)).toEqual(baseline.sources.map(sourceArrangement))
  expect(undone.sources.find((source) => source.title === 'Later title🙂')).toBeDefined()
  expect(undone.cards).toEqual(rated.cards)
  expect(undone.reviews).toEqual(rated.reviews)

  await queueView(page, '全部材料')
  await page.getByLabel('材料类型', { exact: true }).selectOption('excerpt')
  const count = undone.sources.filter((source) => source.kind === 'excerpt').length
  const all = page.getByRole('button', { name: `选择全部筛选结果（${count}）`, exact: true })
  for (const operation of ['archive', 'defer', 'restore'] as const) {
    await all.click()
    dialog = await openBatch(page, operation)
    await expect(dialog).toContainText(`所选的 ${count} 篇材料`)
    if (operation === 'defer')
      await dialog.getByLabel('下次阅读日期', { exact: true }).fill('2099-12-31')
    await confirmBatch(page)
    const changed = await read()
    const affected = changed.sources.filter((source) => source.kind === 'excerpt')
    if (operation === 'archive')
      expect(affected.every((source) => source.queue?.state === 'archived')).toBe(true)
    if (operation === 'defer')
      expect(
        affected.every(
          (source) => source.queue?.state === 'active' && source.queue.availableOn === '2099-12-31',
        ),
      ).toBe(true)
    if (operation === 'restore')
      expect(
        affected.every(
          (source) => source.queue?.state === 'active' && source.queue.availableOn < '2099-12-31',
        ),
      ).toBe(true)
    await page.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
    expect((await read()).sources.map(sourceArrangement)).toEqual(
      undone.sources.map(sourceArrangement),
    )
  }
  await all.click()
  await openBatch(page, 'archive')
  await confirmBatch(page)
  const persisted = await read()
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  expect((await read()).sources.map(sourceArrangement)).toEqual(
    persisted.sources.map(sourceArrangement),
  )
  await expect(page.getByRole('button', { name: '撤销阅读安排', exact: true })).toHaveCount(0)
}

export async function nestedDailyFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await createSourceDeck(page)
  const sentence = '重复的段落 变量🙂 and repeated text.'
  const text = `# Long original\n\n${(sentence + '\n\n').repeat(300)}\n## End\n\n$$R=e^{-t/S}$$`
  await importReading(page, 'Original🙂', 'markdown', text)
  const start = text.lastIndexOf(sentence)
  await selectForExcerpt(page, start, start + sentence.length)
  await saveIndependentExcerpt(page, 'Paragraph🙂')
  await expect(page.getByRole('heading', { name: 'Paragraph🙂', exact: true })).toBeVisible()
  const at = sentence.indexOf('变量')
  await selectForExcerpt(page, at, at + '变量🙂'.length)
  await saveIndependentExcerpt(page, 'Key idea🙂')
  await expect(page.locator('.source-text')).toHaveValue('变量🙂')
  await expect(page.locator('.source-ancestry')).toHaveText('Original🙂Paragraph🙂Key idea🙂')
  const tree = await read()
  const root = tree.sources.find((source) => source.title === 'Original🙂')!
  const child = tree.sources.find((source) => source.title === 'Paragraph🙂')!
  const leaf = tree.sources.find((source) => source.title === 'Key idea🙂')!
  expect(child.origin).toEqual({ sourceId: root.id, start, end: start + sentence.length })
  expect(leaf.origin).toEqual({ sourceId: child.id, start: at, end: at + 4 })
  await page.getByRole('button', { name: '用此摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('What is the key idea?')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await expect(page.getByRole('region', { name: '今日阅读', exact: true })).toContainText(
    '1 篇原文 · 2 篇摘录',
  )
  await page.getByRole('button', { name: '开始今日阅读', exact: true }).click()
  await expect(page.locator('.reading-round strong')).toHaveText('第 1 篇，共 3 篇')
  await expect(page.getByRole('heading', { name: root.title, exact: true })).toBeVisible()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: child.title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
  await expect(page.locator('.reading-round strong')).toHaveText('第 1 篇，共 3 篇')
  await expect(page.getByRole('heading', { name: root.title, exact: true })).toBeVisible()
  for (let i = 0; i < 3; i++) {
    const next = page.getByRole('button', { name: i === 2 ? '完成本轮' : '下一篇', exact: true })
    await expect(next).toBeEnabled()
    await next.click()
  }
  await page.getByRole('button', { name: '去复习卡片', exact: true }).click()
  await expect(page.locator('.card-question')).toContainText('What is the key idea?')
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText('变量🙂')
  await page.getByRole('button', { name: '查看出处', exact: true }).click()
  await expect(page.getByRole('dialog', { name: child.title, exact: true })).toBeVisible()
  await expect(page.locator('.source-original mark')).toHaveText('变量🙂')
  await page.getByRole('button', { name: '查看出处', exact: true }).click()
  await expect(page.getByRole('dialog', { name: root.title, exact: true })).toBeVisible()
  await expect(page.locator('.source-original mark')).toHaveText('变量🙂')
  expect(
    await page
      .locator('.source-original mark')
      .evaluate((el) => el.previousSibling?.textContent?.length),
  ).toBe(start + at)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  )
  await page.screenshot({ path: info.outputPath('nested-source-context.png'), fullPage: true })
  await page
    .getByRole('navigation', { name: '出处路径', exact: true })
    .getByRole('button', { name: child.title, exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: child.title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回摘录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: leaf.title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: /良好/ }).click()
  const rated = await read()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: child.title }).click()
  await page.getByRole('button', { name: '删除材料', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.locator('.source-list-title').filter({ hasText: leaf.title }).click()
  await expect(page.locator('.source-text')).toHaveValue('变量🙂')
  await expect(page.getByText('原文已删除，摘录内容仍保留。', { exact: true })).toBeVisible()
  const detached = await read()
  expect(detached.sources.find((source) => source.id === leaf.id)!.origin).toBeUndefined()
  expect(detached.cards).toEqual(rated.cards)
  expect(detached.reviews).toEqual(rated.reviews)
  expect(detached.notes[0]!.excerpt?.sourceId).toBe(leaf.id)
  await page.reload()
  expect((await read()).sources).toEqual(detached.sources)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const backup = await parseArchive(new Blob([await readFile((await (await download).path())!)]))
  expect([...backup.library.sources].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    [...detached.sources].sort((a, b) => a.id.localeCompare(b.id)),
  )
  expect(backup.library.cards).toEqual(detached.cards)
}

export async function batchRetryFlow(
  page: Page,
  read: () => Promise<Library>,
  reject: (enabled: boolean) => Promise<void>,
) {
  await importReading(page, 'Batch A', 'plain', 'First context\n'.repeat(100))
  await importReading(page, 'Batch B', 'plain', 'Second context\n'.repeat(100))
  await page.getByRole('button', { name: '选择本页', exact: true }).click()
  const before = await read()
  const dialog = await openBatch(page, 'archive')
  await reject(true)
  await dialog.getByRole('button', { name: '确认批量安排', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect((await read()).sources.map(sourceArrangement)).toEqual(
    before.sources.map(sourceArrangement),
  )
  await expect(dialog.getByRole('button', { name: '确认批量安排', exact: true })).toBeEnabled()
  await reject(false)
  await confirmBatch(page)
  const after = await read()
  expect(after.sources.every((source) => source.queue?.state === 'archived')).toBe(true)
  await reject(true)
  await page.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
  await expect(page.locator('.notice.error')).toBeVisible()
  expect((await read()).sources.map(sourceArrangement)).toEqual(
    after.sources.map(sourceArrangement),
  )
  await expect(page.getByRole('button', { name: '撤销阅读安排', exact: true })).toBeEnabled()
  await reject(false)
  await page.getByRole('button', { name: '撤销阅读安排', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤销阅读安排', exact: true })).toHaveCount(0)
  expect((await read()).sources.map(sourceArrangement)).toEqual(
    before.sources.map(sourceArrangement),
  )
}
