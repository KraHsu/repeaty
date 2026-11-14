import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { storedLibrary } from './stored-library'
import { importReading } from './reading-flow'
import { createSourceDeck } from './source-flow'
import {
  confirmPluginAction,
  installOfficialPlugin,
  openPluginManager,
  selectPlugin,
  openSettings,
} from './settings-flow'
import type { Library } from '../../src/core/model'

const pluginId = 'format-cleanup'
const nav = (page: Page, title: string) =>
  page.locator('.main-nav').getByRole('button', { name: title, exact: true })
async function library(page: Page) {
  const rows = await storedLibrary(page)
  return Object.fromEntries(
    Object.entries(rows).map(([key, rows]) => [
      key,
      (rows as { value: unknown }[]).map((row) => row.value),
    ]),
  ) as unknown as Library
}
async function body(page: Page, expected: string) {
  await nav(page, '学习材料').click()
  await page.locator('.source-list-title').filter({ hasText: '格式清理验收' }).click()
  await expect(page.locator('.source-reader h2')).toHaveText('格式清理验收')
  const toggle = page.getByRole('button', { name: '查看 Markdown 原文', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await expect(page.locator('.source-text')).toHaveValue(expected)
}
export async function formatCleanupFlow(page: Page, edition: 'web' | 'desktop') {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await createSourceDeck(page)
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('格式清理不可更改的卡片')
  await page.getByLabel('背面 · 答案', { exact: true }).fill('卡片与调度保持不变')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  const original =
    '# foo 标题\n\nfoo 正文 \n\n```txt\nfoo code  \n```\n\n`foo` [foo](https://example.invalid/foo)'
  const cleaned =
    '# bar 标题\n\nbar 正文\n\n```txt\nfoo code  \n```\n\n`foo` [bar](https://example.invalid/foo)'
  await importReading(page, '格式清理验收', 'markdown', original)
  const before = await library(page),
    source = before.sources[0]!
  await openPluginManager(page)
  await installOfficialPlugin(page, pluginId)
  const details = page.locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)
  const enabled = details.getByRole('switch', { name: '启用 格式清理', exact: true })
  await expect(enabled).not.toBeChecked()
  await enabled.click()
  await expect(enabled).toBeChecked()
  await expect(details).toContainText('格式清理')

  await openSettings(page, 'tools.format-cleanup')
  await page.getByRole('button', { name: '添加规则', exact: true }).click()
  await page.getByRole('textbox', { name: '查找', exact: true }).fill('foo')
  await page.getByRole('textbox', { name: '替换为', exact: true }).fill('bar')
  await nav(page, '格式清理').click()
  await page.getByRole('button', { name: '预览清理', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '清理前的完整正文', exact: true })).toHaveValue(
    original,
  )
  await expect(page.getByRole('textbox', { name: '清理后的完整正文', exact: true })).toHaveValue(
    cleaned,
  )
  expect((await library(page)).sources[0]!.mediaId).toBe(source.mediaId)
  const evidence = resolve('docs/local-plans.local/foliole-coverage-2026-10-29/p3')
  await mkdir(evidence, { recursive: true })
  await page.screenshot({
    path: resolve(evidence, `format-cleanup-${edition}-preview.png`),
    fullPage: true,
  })
  await page.getByRole('button', { name: '应用清理', exact: true }).click()
  await expect(page.locator('.cleanup-page-body')).toContainText('已保存为新版本')
  await expect.poll(async () => (await library(page)).sources[0]!.mediaId).not.toBe(source.mediaId)
  const applied = await library(page),
    current = applied.sources[0]!
  expect(current.versions?.some((item) => item.mediaId === source.mediaId)).toBe(true)
  expect(applied.cards).toEqual(before.cards)
  expect(applied.notes).toEqual(before.notes)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await library(page)).sources[0]!.mediaId).toBe(source.mediaId)
  await body(page, original)
  // Run a new preview after undo; the old operation must never resurrect its result.
  await nav(page, '格式清理').click()
  await page.getByRole('button', { name: '预览清理', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '清理后的完整正文', exact: true })).toHaveValue(
    cleaned,
  )
  await page.getByRole('button', { name: '应用清理', exact: true }).click()
  await expect(page.locator('.cleanup-page-body')).toContainText('已保存为新版本')
  await body(page, cleaned)
  await openPluginManager(page)
  // Leaving the reader flushes its final reading position before comparing uninstall results.
  await expect.poll(async () => (await library(page)).sources[0]!.reading?.view).toBe('source')
  const saved = await library(page)
  await selectPlugin(page, pluginId)
  await details.getByRole('switch', { name: '启用 格式清理', exact: true }).click()
  await expect(nav(page, '格式清理')).toHaveCount(0)
  await details.getByRole('switch', { name: '启用 格式清理', exact: true }).click()
  await expect(nav(page, '格式清理')).toBeVisible()
  await details.getByRole('button', { name: '卸载插件', exact: true }).click()
  await confirmPluginAction(page)
  await expect(nav(page, '格式清理')).toHaveCount(0)
  const after = await library(page)
  expect(after.sources).toEqual(saved.sources)
  expect(after.cards).toEqual(before.cards)
  expect(after.notes).toEqual(before.notes)
  await page.reload()
  await expect(nav(page, '格式清理')).toHaveCount(0)
  await body(page, cleaned)
}
