import { selectUiValue } from './ui-flow'
import { setResponsiveViewport } from './viewport-flow'
import { setInterfaceLanguage } from './settings-flow'
import { notesAfterSourceRekey } from './source-flow'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library } from '../../src/core/model'
import { parseArchive } from '../../src/core/archive'
import { createSourceDeck } from './source-flow'
import { importReading, moveReading, readingMarkdown } from './reading-flow'

export async function queueView(page: Page, name: '待阅读' | '稍后阅读' | '已归档' | '全部材料') {
  await page
    .getByRole('navigation', { name: '阅读队列', exact: true })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
}

export async function readingQueueFlow(page: Page, read: () => Promise<Library>, info: TestInfo) {
  await createSourceDeck(page)
  await importReading(page, 'Queue A', 'markdown', readingMarkdown)
  await page.locator('.source-text').evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 12)
    element.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('Queue control card')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await importReading(page, 'Queue B', 'plain', 'Another material\n'.repeat(500))
  const baseline = await read()
  const first = baseline.sources.find((source) => source.title === 'Queue A')!
  await expect(page.getByLabel('阅读优先级', { exact: true })).toHaveAttribute('value', 'normal')
  expect(baseline.sources.every((source) => source.priority === undefined)).toBe(true)
  await page.locator('.source-list-title').filter({ hasText: 'Queue A' }).click()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await moveReading(page, 0.55)
  const priority = page.getByLabel('阅读优先级', { exact: true })
  await selectUiValue(priority, 'low')
  await expect(priority).toHaveAttribute('value', 'low')
  await expect(page.locator('.source-list-title')).toHaveText(['Queue B', 'Queue A'])
  await expect(page.getByRole('heading', { name: 'Queue A', exact: true })).toBeVisible()
  const lowered = (await read()).sources.find((source) => source.id === first.id)!
  expect(lowered.queue).toBeUndefined()
  expect(lowered.reading!.offset).toBeGreaterThan(500)
  expect(
    await page.locator('.source-text').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(500)
  await selectUiValue(priority, 'high')
  await expect(priority).toHaveAttribute('value', 'high')
  await expect(page.locator('.source-list-title')).toHaveText(['Queue A', 'Queue B'])
  await moveReading(page, 0.6)
  // Do not wait for the idle save: archiving must capture the current position.
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Queue B', exact: true })).toBeVisible()
  const archived = (await read()).sources.find((source) => source.id === first.id)!
  expect(archived.queue?.state).toBe('archived')
  expect(archived.priority).toBe('high')
  expect(archived.reading!.offset).toBeGreaterThan(500)
  await queueView(page, '已归档')
  await expect(page.getByRole('heading', { name: 'Queue A', exact: true })).toBeVisible()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  expect(
    await page.locator('.source-text').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(500)
  await page.getByRole('button', { name: '加入待阅读', exact: true }).click()
  await expect(page.locator('.source-reader')).toHaveCount(0)
  await queueView(page, '待阅读')
  await page.locator('.source-list-title').filter({ hasText: 'Queue A' }).click()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')

  const { today, tomorrow, later, week, custom } = await page.evaluate(() => {
    const now = new Date()
    const key = (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    const after = (days: number) => {
      const date = new Date(now)
      date.setDate(date.getDate() + days)
      return key(date)
    }
    return {
      today: key(now),
      tomorrow: after(1),
      later: after(3),
      week: after(7),
      custom: after(4),
    }
  })
  await page.getByRole('button', { name: '稍后阅读', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '稍后阅读', exact: true })
  const shortcuts = dialog.getByRole('group', { name: '快捷安排' })
  const tomorrowButton = shortcuts.getByRole('button', { name: /^明天/ })
  const laterButton = shortcuts.getByRole('button', { name: /^3 天后/ })
  const weekButton = shortcuts.getByRole('button', { name: /^1 周后/ })
  await expect(tomorrowButton).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByLabel('下次阅读日期')).toHaveValue(tomorrow)
  for (const [button, date] of [
    [tomorrowButton, tomorrow],
    [laterButton, later],
    [weekButton, week],
  ] as const) {
    await expect(button.locator('time')).toHaveAttribute('datetime', date)
    const displayed = await page.evaluate(
      (date) => new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN'),
      date,
    )
    await expect(button.locator('time')).toHaveText(displayed)
  }
  // A preset selects a date; keyboard activation must not submit the form.
  await weekButton.focus()
  await weekButton.press('Space')
  await expect(dialog.getByLabel('下次阅读日期')).toHaveValue(week)
  await expect(weekButton).toHaveAttribute('aria-pressed', 'true')
  await expect(tomorrowButton).toHaveAttribute('aria-pressed', 'false')
  expect((await read()).sources.find((source) => source.id === first.id)!.queue?.availableOn).toBe(
    today,
  )
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await setResponsiveViewport(page, 390, 844)
  await page.getByRole('button', { name: '稍后阅读', exact: true }).click()
  await expect(dialog.getByLabel('下次阅读日期')).toHaveValue(tomorrow)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({
    path: info.outputPath('reading-shortcuts-zh.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await dialog.getByLabel('下次阅读日期').fill(today)
  await dialog.getByRole('button', { name: '保存阅读安排' }).click()
  await expect(dialog).toBeVisible()
  expect((await read()).sources.find((source) => source.id === first.id)!.queue?.availableOn).toBe(
    today,
  )
  await dialog.getByLabel('下次阅读日期').fill(custom)
  await expect(shortcuts.locator('[aria-pressed="true"]')).toHaveCount(0)
  await expect(dialog.getByLabel('下次阅读日期')).toHaveValue(custom)
  await laterButton.click()
  await expect(dialog.getByLabel('下次阅读日期')).toHaveValue(later)
  await expect(laterButton).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: '保存阅读安排' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Queue B', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.locator('.source-list-title')).toHaveText(['Queue B'])
  await queueView(page, '稍后阅读')
  await expect(page.locator('.source-list-title')).toHaveText(['Queue A'])
  const planned = (await read()).sources.find((source) => source.id === first.id)!
  expect(planned.queue).toEqual({ state: 'active', availableOn: later })
  expect(planned.priority).toBe('high')
  expect(planned.reading!.offset).toBeGreaterThan(500)
  await setResponsiveViewport(page, 390, 844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('reading-queue-zh.png'), fullPage: true })
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Reading queue', exact: true })
    .getByRole('button', { name: /^Read later/ })
    .click()
  await page.locator('.source-list-title').filter({ hasText: 'Queue A' }).click()
  await expect(
    page
      .getByRole('navigation', { name: 'Reading queue' })
      .getByRole('button', { name: /^Read later/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Read now', exact: true })).toBeVisible()
  await expect(page.getByLabel('Reading priority', { exact: true })).toHaveAttribute(
    'value',
    'high',
  )
  await page.getByLabel('Reading priority', { exact: true }).click()
  await expect(page.getByRole('option', { name: 'High', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('option', { name: 'High', exact: true }).press('Escape')
  await page.getByRole('button', { name: 'Read later', exact: true }).click()
  const englishDialog = page.getByRole('dialog', { name: 'Read later', exact: true })
  const englishShortcuts = englishDialog.getByRole('group', { name: 'Quick schedule' })
  await expect(englishShortcuts.getByRole('button', { name: /^Tomorrow/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await englishShortcuts.getByRole('button', { name: /^In 1 week/ }).click()
  await expect(englishShortcuts.getByRole('button', { name: /^In 1 week/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(englishDialog.getByLabel('Next reading date')).toHaveValue(week)
  await expect(englishShortcuts.getByRole('button', { name: /^In 3 days/ })).toBeVisible()
  expect(
    await englishDialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({
    path: info.outputPath('reading-shortcuts-en.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await englishDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await read()).sources.find((source) => source.id === first.id)!.queue).toEqual(
    planned.queue,
  )
  await setInterfaceLanguage(page, 'zh-CN')

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  const backup = await parseArchive(new Blob([bytes]))
  expect(backup.library.sources.find((source) => source.id === first.id)!.queue).toEqual(
    planned.queue,
  )
  expect(backup.library.sources.find((source) => source.id === first.id)!.priority).toBe('high')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await queueView(page, '稍后阅读')
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.locator('.source-reader')).toHaveCount(0)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page
    .getByLabel('导入备份文件')
    .setInputFiles({ name: 'queue.repeaty', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await read()).sources.find((source) => source.id === first.id)!.queue).toEqual(
    planned.queue,
  )
  expect((await read()).sources.find((source) => source.id === first.id)!.priority).toBe('high')

  // Changing only wall-clock time leaves real timers running. The application's
  // regular clock tick must make the deferred material available without a write.
  await page.clock.setFixedTime(new Date(`${later}T12:00:00`))
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.locator('.source-list-title')).toHaveText(['Queue A', 'Queue B'], {
    timeout: 15000,
  })
  const after = await read()
  expect(after.sources.find((source) => source.id === first.id)!.queue).toEqual(planned.queue)
  for (const store of ['notes', 'cards', 'reviews', 'practices', 'attempts'] as const)
    expect(after[store]).toEqual(
      store === 'notes' ? notesAfterSourceRekey(baseline, after) : baseline[store],
    )
  await page.locator('.source-list-title').filter({ hasText: 'Queue A' }).click()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  expect(
    await page.locator('.source-text').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(500)
}
