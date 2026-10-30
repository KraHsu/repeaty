import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildPlugin } from '../../packages/plugin-api/build.mjs'
import {
  openCollection,
  previewCollection,
  commitCollection,
  fillCollectionText,
  cancelCollection,
} from './collection-controls'
import { localLibrary } from './source-excerpt-flow'
import { confirmPluginAction, enableInstalledPlugin, openPluginManager } from './settings-flow'
import { selectUiValue } from './ui-flow'
import { showSourceText } from './source-controls'

const nav = (page: Page, name: string) =>
  page.locator('.main-nav').getByRole('button', { name, exact: true })
const inbox = (page: Page) =>
  page.locator('.material-sections').getByRole('button', { name: /收件箱/ })
const connections = (page: Page) =>
  page.locator('.material-sections').getByRole('button', { name: '来源', exact: true })

async function organize(page: Page, title?: string) {
  await page.getByRole('button', { name: '整理到阅读材料', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '整理到阅读材料', exact: true })
  if (title) await dialog.getByLabel('材料标题', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '移入阅读材料', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

/** Same assertions against IndexedDB and the real Rust-backed workspace fixture. */
export async function collectionInboxFlow(page: Page, info: TestInfo) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const before = await localLibrary(page)
  await nav(page, '学习材料').click()
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: 1024, height: 768 })
  const draft = await openCollection(page, 'inbox')
  await fillCollectionText(draft, { title: '暂不保存的草稿', text: '只预览控件布局，不保存正文。' })
  await expect(draft.getByRole('button', { name: '预览材料', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await expect(draft.getByTestId('collection-files')).toHaveAttribute('tabindex', '-1')
  await expect(draft.getByTestId('collection-directory')).toHaveAttribute('tabindex', '-1')
  await page.screenshot({
    path: info.outputPath('p5-collection-text-1024.png'),
    animations: 'disabled',
  })
  await cancelCollection(draft)
  await page.setViewportSize(viewport)
  const dialog = await openCollection(page, 'inbox')
  const text = '  保留开头空格、中文🙂与末尾空行。\n\n'
  await dialog.getByTestId('collection-files').setInputFiles([
    { name: '批量原文.txt', mimeType: 'text/plain', buffer: Buffer.from(text) },
    {
      name: '稍后阅读.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 稍后阅读\n\n先收集，再整理。\n'),
    },
    { name: '不选择.txt', mimeType: 'text/plain', buffer: Buffer.from('这份内容不应保存。') },
  ])
  await previewCollection(dialog)
  await expect(
    dialog.getByRole('list', { name: '收集预览', exact: true }).locator('li'),
  ).toHaveCount(3)
  await dialog.getByRole('checkbox', { name: '选择 不选择', exact: true }).uncheck()
  expect((await localLibrary(page)).sources).toEqual(before.sources)
  await commitCollection(dialog, 'inbox')
  await expect(page.locator('.inbox-list button')).toHaveCount(2)
  const collected = await localLibrary(page)
  expect(collected.sources).toHaveLength(before.sources.length + 2)
  expect(collected.sources.every((source) => source.inbox?.state === 'new')).toBe(true)
  expect(collected.cards).toEqual(before.cards)
  expect(collected.reviews).toEqual(before.reviews)
  await page.reload()
  await nav(page, '学习材料').click()
  await inbox(page).click()
  await page.locator('.inbox-list button').filter({ hasText: '批量原文' }).click()
  await expect.poll(() => page.locator('.inbox-content .source-original').textContent()).toBe(text)
  await page.getByRole('button', { name: '归档', exact: true }).click()
  await expect(page.locator('.inbox-list button')).toHaveCount(1)
  await page.reload()
  await nav(page, '学习材料').click()
  await inbox(page).click()
  await page.getByRole('button', { name: /已归档/ }).click()
  await expect(page.locator('.inbox-list button')).toHaveCount(1)
  await expect.poll(() => page.locator('.inbox-content .source-original').textContent()).toBe(text)
  await page.getByRole('button', { name: '恢复到收件箱', exact: true }).click()
  await page.getByRole('button', { name: /待整理/ }).click()
  await page.locator('.inbox-list button').filter({ hasText: '批量原文' }).click()
  await organize(page, '整理后的原文')
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(text)
  const organized = (await localLibrary(page)).sources.find(
    (source) => source.title === '整理后的原文',
  )!
  expect(organized.inbox).toBeUndefined()
  expect(organized.id).toBe(collected.sources.find((source) => source.title === '批量原文')!.id)
  expect(organized.mediaId).toBe(
    collected.sources.find((source) => source.title === '批量原文')!.mediaId,
  )

  // Recursive selection preserves relative paths, so equal basenames remain distinct documents.
  const directory = info.outputPath('batch-directory')
  await mkdir(join(directory, 'a'), { recursive: true })
  await mkdir(join(directory, 'b'), { recursive: true })
  await mkdir(join(directory, '.private'), { recursive: true })
  await writeFile(join(directory, 'a', '重名.txt'), '目录 A 的正文。')
  await writeFile(join(directory, 'b', '重名.txt'), '目录 B 的正文。')
  await writeFile(join(directory, '.private', 'secret.txt'), '不可导入')
  await writeFile(join(directory, 'draft.tmp'), '不可导入')
  const recursive = await openCollection(page, 'inbox')
  await recursive.getByTestId('collection-directory').setInputFiles(directory)
  await expect(recursive.getByRole('list', { name: '待收集文件' }).locator('li')).toHaveCount(2)
  await expect(recursive.locator('.collection-skipped')).toContainText('已跳过 2 项')
  await previewCollection(recursive)
  await expect(recursive.getByRole('checkbox', { name: '选择 重名', exact: true })).toHaveCount(2)
  await commitCollection(recursive, 'inbox')
  const named = (await localLibrary(page)).sources.filter((source) => source.title === '重名')
  expect(named).toHaveLength(2)
  expect(new Set(named.map((source) => source.id)).size).toBe(2)
  expect(new Set(named.map((source) => source.inbox?.name)).size).toBe(2)
  const repeated = await openCollection(page, 'inbox')
  await repeated.getByTestId('collection-directory').setInputFiles(directory)
  await previewCollection(repeated)
  await expect(repeated.locator('.collection-candidate-status')).toHaveText(['已收集', '已收集'])
  await commitCollection(repeated, 'inbox')
  expect((await localLibrary(page)).sources.filter((source) => source.title === '重名')).toEqual(
    named,
  )
  await page.screenshot({
    path: info.outputPath('p5-inbox.png'),
    animations: 'disabled',
    fullPage: true,
  })
  expect(errors).toEqual([])
}

async function directoryBytes(directory: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {}
  async function walk(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name
      if (entry.isDirectory()) await walk(join(path, entry.name), `${name}/`)
      else entries[name] = (await readFile(join(path, entry.name))).toString('base64')
    }
  }
  await walk(directory, '')
  return entries
}

export type DirectoryChooser = (dialog: Locator, path: string) => Promise<void>
export const browserDirectoryChooser: DirectoryChooser = async (dialog, path) => {
  await dialog.getByTestId('connection-directory').setInputFiles(path)
}

export async function sourceConnectionFlow(page: Page, info: TestInfo, choose: DirectoryChooser) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const vault = info.outputPath('obsidian-vault')
  await mkdir(join(vault, 'A'), { recursive: true })
  await mkdir(join(vault, 'B'), { recursive: true })
  await mkdir(join(vault, 'assets'), { recursive: true })
  await mkdir(join(vault, '.obsidian'), { recursive: true })
  const original =
    '# 阅读入口\n\n旧版内容。\n\n[[A/重名#目标段落|查看精确目标]]\n\n[[重名]]\n\n![[assets/图.png]]\n'
  await writeFile(join(vault, '入口.md'), original)
  await writeFile(
    join(vault, 'A', '重名.md'),
    '# 重名\n\nA 目录的目标。\n\n## 目标段落\n\n准确定位，不按标题误选。\n',
  )
  await writeFile(join(vault, 'B', '重名.md'), '# 重名\n\nB 目录中不同的正文。\n')
  await writeFile(join(vault, '.obsidian', 'preferences.json'), '{"private":true}')
  await writeFile(join(vault, 'draft.tmp'), 'private draft')
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  await writeFile(join(vault, 'assets', '图.png'), image)
  const unchanged = await directoryBytes(vault)
  const bundle = await buildPlugin(resolve('plugins/obsidian'), {
    outdir: info.outputPath('obsidian-plugin'),
  })
  await openPluginManager(page)
  await page.locator('.plugins-page input[type=file]').setInputFiles({
    name: 'obsidian.repeaty-plugin',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  })
  await confirmPluginAction(page)
  await enableInstalledPlugin(page, 'obsidian')
  await nav(page, '学习材料').click()
  await connections(page).click()
  await page.getByRole('button', { name: '新建连接', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '新建连接', exact: true })
  await selectUiValue(
    dialog.getByRole('combobox', { name: '来源类型', exact: true }),
    'obsidian:vault',
  )
  await choose(dialog, vault)
  await dialog.getByLabel('连接名称', { exact: true }).fill('P5 笔记来源')
  await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const before = await localLibrary(page)
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.locator('.connection-pending button')).toHaveCount(3)
  expect((await localLibrary(page)).sources).toEqual(before.sources)
  expect((await localLibrary(page)).sourceCandidates).toHaveLength(3)
  for (let remaining = 3; remaining > 0; remaining--) {
    await page.getByRole('button', { name: '收集到收件箱', exact: true }).click()
    await expect(page.locator('.connection-pending button')).toHaveCount(remaining - 1)
  }
  const accepted = await localLibrary(page)
  expect(accepted.sources).toHaveLength(3)
  expect(accepted.sources.filter((source) => source.title === '重名')).toHaveLength(2)
  const entry = accepted.sources.find((source) => source.title === '阅读入口')!
  expect(entry.binding?.links).toEqual([
    { targetKey: 'A/重名.md', label: '查看精确目标', anchor: '目标段落' },
  ])
  expect(entry.document?.resources).toHaveLength(1)
  expect(entry.document!.resources![0]!.path).toBe('assets/图.png')
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.getByRole('heading', { name: '没有待确认的变化', exact: true })).toBeVisible()
  expect((await localLibrary(page)).sources).toEqual(accepted.sources)
  expect(await directoryBytes(vault)).toEqual(unchanged)

  await inbox(page).click()
  await page.locator('.inbox-list button').filter({ hasText: '阅读入口' }).click()
  await page.getByRole('button', { name: '查看 Markdown 原文', exact: true }).click()
  await expect(page.locator('.inbox-content .source-original')).toContainText('[[重名]]')
  await page.getByRole('button', { name: '阅读 Markdown 预览', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('.inbox-content .source-markdown-preview img')
        .evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
    )
    .toBe(true)
  await organize(page)
  // Organize target documents too, then exercise the stored link through the real reader.
  for (let remaining = 2; remaining > 0; remaining--) {
    await inbox(page).click()
    await page.locator('.inbox-list button').first().click()
    await organize(page)
  }
  await page.locator('.source-list-title').filter({ hasText: '阅读入口' }).click()
  await page
    .locator('.source-markdown-preview')
    .getByRole('link', { name: '查看精确目标', exact: true })
    .click()
  await showSourceText(page)
  await expect(page.locator('.source-text')).toHaveValue(/A 目录的目标/)
  expect((await localLibrary(page)).cards).toEqual(before.cards)

  const changed = original.replace('旧版内容。', '新版内容，必须明确确认后才能替换。')
  await writeFile(join(vault, '入口.md'), changed)
  const externalVersion = await directoryBytes(vault)
  await connections(page).click()
  await page.getByRole('button', { name: '连接设置', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '连接设置', exact: true })
  await choose(dialog, vault)
  await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.locator('.connection-pending button')).toHaveCount(1)
  await expect(page.locator('.connection-diff pre').first()).toContainText('旧版内容。')
  await expect(page.locator('.connection-diff pre').last()).toContainText('新版内容')
  expect((await localLibrary(page)).sources.find((source) => source.id === entry.id)!.mediaId).toBe(
    entry.mediaId,
  )
  await page.screenshot({
    path: info.outputPath('p5-source-update.png'),
    animations: 'disabled',
    fullPage: true,
  })
  await page.reload()
  await nav(page, '学习材料').click()
  await connections(page).click()
  await expect(page.locator('.connection-diff pre').last()).toContainText('新版内容')
  expect((await localLibrary(page)).sources.find((source) => source.id === entry.id)!.mediaId).toBe(
    entry.mediaId,
  )
  await page.getByRole('button', { name: '采用来源更新', exact: true }).click()
  await expect(page.locator('.connection-pending button')).toHaveCount(0)
  const updated = (await localLibrary(page)).sources.find((source) => source.id === entry.id)!
  expect(updated.mediaId).not.toBe(entry.mediaId)
  expect(updated.versions?.some((version) => version.mediaId === entry.mediaId)).toBe(true)
  expect(updated.binding?.acceptedMediaId).toBe(updated.mediaId)
  expect(await directoryBytes(vault)).toEqual(externalVersion)
  await page.getByRole('button', { name: '断开', exact: true }).click()
  await page.getByRole('button', { name: '确认断开', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  const retained = await localLibrary(page)
  expect(retained.sources.find((source) => source.id === entry.id)).toEqual(updated)
  expect(retained.sourceConnections[0]!.status).toBe('disconnected')
  expect(retained.cards).toEqual(before.cards)
  expect(retained.reviews).toEqual(before.reviews)
  expect(await directoryBytes(vault)).toEqual(externalVersion)
  expect(errors).toEqual([])
}
