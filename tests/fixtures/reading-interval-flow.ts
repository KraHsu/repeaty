import { selectUiValue } from './ui-flow'
import { setResponsiveViewport } from './viewport-flow'
import { setInterfaceLanguage } from './settings-flow'
import { notesAfterSourceRekey } from './source-flow'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library } from '../../src/core/model'
import { parseArchive } from '../../src/core/archive'
import { createSourceDeck } from './source-flow'
import { importReading, moveReading, readingText, saveReading } from './reading-flow'
import { queueView } from './reading-queue-flow'
import { startRound } from './reading-round-flow'
import { saveIndependentExcerpt, selectForExcerpt } from './source-excerpt-flow'

export async function openReadSchedule(page: Page, days: number) {
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '读过，安排下次', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '读过，安排下次', exact: true })
  await expect(dialog.locator('[aria-current="step"]')).toHaveText(`${days}天`)
  return dialog
}

async function selectSource(page: Page, title: string) {
  await page.locator('.source-list-title').filter({ hasText: title }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
}

export async function readingIntervalFlow(
  page: Page,
  read: () => Promise<Library>,
  info: TestInfo,
) {
  await createSourceDeck(page)
  await importReading(page, 'Interval root', 'plain', readingText)
  await page.locator('.source-text').evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 12)
    element.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('Interval control card')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  const before = await read()
  const root = before.sources[0]!
  const { tomorrow, threeDays } = await page.evaluate(() => {
    const after = (days: number) => {
      const date = new Date()
      date.setDate(date.getDate() + days)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    return { tomorrow: after(1), threeDays: after(3) }
  })
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await moveReading(page, 0.55)
  await saveReading(page)
  expect((await read()).sources[0]!.readingIntervalDays).toBeUndefined()
  await startRound(page, 'Interval root')
  let dialog = await openReadSchedule(page, 1)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect((await read()).sources[0]!.readingIntervalDays).toBeUndefined()
  expect((await read()).sources[0]!.queue).toBeUndefined()
  await expect(page.getByRole('region', { name: '本轮阅读', exact: true })).toContainText(
    '第 1 篇，共 1 篇',
  )
  dialog = await openReadSchedule(page, 1)
  await setResponsiveViewport(page, 390, 844)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(
    await dialog
      .locator('.source-interval-summary')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16)
  await page.screenshot({
    path: info.outputPath('reading-interval-zh.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: '本轮结束', exact: true })).toBeVisible()
  const first = (await read()).sources.find((source) => source.id === root.id)!
  expect(first.readingIntervalDays).toBe(1)
  expect(first.queue).toEqual({ state: 'active', availableOn: tomorrow })
  expect(first.reading!.offset).toBeGreaterThan(500)
  await page.getByRole('button', { name: '返回材料', exact: true }).click()
  await queueView(page, '稍后阅读')
  await selectSource(page, root.title)
  await selectForExcerpt(page, 0, 4000)
  await saveIndependentExcerpt(page, 'Interval child')
  expect(
    (await read()).sources.find((source) => source.kind === 'excerpt')!.readingIntervalDays,
  ).toBeUndefined()
  dialog = await openReadSchedule(page, 1)
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const child = (await read()).sources.find((source) => source.kind === 'excerpt')!
  expect(child.readingIntervalDays).toBe(1)
  expect(child.queue!.availableOn).toBe(tomorrow)
  expect((await read()).sources.find((source) => source.id === root.id)!.readingIntervalDays).toBe(
    1,
  )

  await queueView(page, '稍后阅读')
  await selectSource(page, root.title)
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Reading queue', exact: true })
    .getByRole('button', { name: /^Read later/ })
    .click()
  await selectSource(page, root.title)
  await page.getByRole('button', { name: 'Read and schedule next', exact: true }).click()
  const english = page.getByRole('dialog', { name: 'Read and schedule next', exact: true })
  await expect(english.locator('[aria-current="step"]')).toHaveText('3 days')
  await expect(english.locator('.source-interval-date')).toContainText(
    await page.evaluate((date) => new Date(`${date}T12:00:00`).toLocaleDateString('en'), threeDays),
  )
  expect(await english.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({
    path: info.outputPath('reading-interval-en.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await english.getByRole('button', { name: 'Save reading schedule', exact: true }).click()
  await expect(english).toHaveCount(0)
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await queueView(page, '稍后阅读')
  await selectSource(page, root.title)
  const second = (await read()).sources.find((source) => source.id === root.id)!
  expect(second.readingIntervalDays).toBe(3)
  expect(second.queue!.availableOn).toBe(threeDays)
  await page.getByRole('button', { name: '稍后阅读', exact: true }).click()
  const manual = page.getByRole('dialog', { name: '稍后阅读', exact: true })
  await manual.getByLabel('下次阅读日期').fill('2099-06-12')
  await manual.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(manual).toHaveCount(0)
  await selectUiValue(page.getByLabel('学习优先级', { exact: true }), '1')
  await expect(page.getByLabel('学习优先级', { exact: true })).toHaveAttribute('value', '1')
  const custom = (await read()).sources.find((source) => source.id === root.id)!
  expect(custom.readingIntervalDays).toBe(3)
  expect(custom.queue!.availableOn).toBe('2099-06-12')
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await queueView(page, '已归档')
  await expect(page.getByRole('button', { name: '读过，安排下次', exact: true })).toHaveCount(0)
  expect((await read()).sources.find((source) => source.id === root.id)!.readingIntervalDays).toBe(
    3,
  )
  await page.getByRole('button', { name: '加入待阅读', exact: true }).click()
  await queueView(page, '待阅读')
  const restored = (await read()).sources.find((source) => source.id === root.id)!
  await page.getByRole('button', { name: '重置间隔', exact: true }).click()
  let reset = page.getByRole('dialog', { name: '重置间隔', exact: true })
  await reset.getByRole('button', { name: '取消', exact: true }).click()
  expect((await read()).sources.find((source) => source.id === root.id)!.readingIntervalDays).toBe(
    3,
  )
  await page.getByRole('button', { name: '重置间隔', exact: true }).click()
  reset = page.getByRole('dialog', { name: '重置间隔', exact: true })
  await reset.getByRole('button', { name: '重置间隔', exact: true }).click()
  await expect(reset).toHaveCount(0)
  const cleared = (await read()).sources.find((source) => source.id === root.id)!
  expect(cleared.readingIntervalDays).toBeUndefined()
  expect(cleared.queue).toEqual(restored.queue)
  expect(cleared.studyPriority).toBe(1)
  dialog = await openReadSchedule(page, 1)
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  const backup = await parseArchive(new Blob([bytes]))
  expect(backup.library.version).toBe(18)
  expect(backup.library.sources.map((source) => source.readingIntervalDays)).toEqual([1, 1])
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await queueView(page, '稍后阅读')
  await selectSource(page, root.title)
  await page.getByRole('button', { name: '重置间隔', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '重置间隔', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page
    .getByLabel('导入备份文件')
    .setInputFiles({ name: 'intervals.repeaty', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await queueView(page, '稍后阅读')
  await selectSource(page, root.title)
  const after = await read()
  expect(after.sources.find((source) => source.id === root.id)!.readingIntervalDays).toBe(1)
  expect(after.sources.find((source) => source.id === child.id)!.readingIntervalDays).toBe(1)
  for (const store of ['notes', 'cards', 'reviews', 'practices', 'attempts'] as const)
    expect(after[store]).toEqual(
      store === 'notes' ? notesAfterSourceRekey(before, after) : before[store],
    )
  dialog = await openReadSchedule(page, 3)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
}
