import { openCollection, previewCollection, commitCollection } from './collection-controls'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlugin } from '../../packages/plugin-api/build.mjs'
import { fixture } from '../../src/core/test-fixtures'
import { addSource, prepareSource } from '../../src/core/sources'
import { exportBackup, parseBackup } from '../../src/core/backups'
import { parseArchive } from '../../src/core/archive'
import {
  confirmPluginAction,
  enableInstalledPlugin,
  openPluginManager,
  selectPlugin,
} from './settings-flow'
import { localLibrary } from './source-excerpt-flow'
import { selectUiValue } from './ui-flow'

const title = '公式叶子遮挡 · 分母与根号'
const latex = '\\frac{a+b}{c^2}=\\sqrt{x}+\\alpha'
const content = `从这个渲染后的公式选择元素：\n\n$$${latex}$$\n\n原始上下文保留。`
const nav = (page: Page, name: string) =>
  page.locator('.main-nav').getByRole('button', { name, exact: true })

async function prepare(page: Page, info: TestInfo) {
  const prepared = prepareSource({ title, url: '', format: 'markdown', content })
  const initial = fixture()
  initial.notes = []
  initial.cards = []
  const library = addSource(initial, prepared.source, prepared.asset)
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'formula-source.json',
    mimeType: 'application/json',
    buffer: Buffer.from(await exportBackup(library, async () => prepared.asset.blob)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const bundle = await buildPlugin(resolve('plugins/visual-occlusion'), {
    outdir: info.outputPath('visual-occlusion'),
  })
  await openPluginManager(page)
  await page.locator('.plugins-page input[type=file]').setInputFiles({
    name: 'visual-occlusion.repeaty-plugin',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  })
  await confirmPluginAction(page)
  await enableInstalledPlugin(page, 'visual-occlusion')
  const notifications = page
    .locator('.notification-center')
    .getByRole('button', { name: '关闭提示', exact: true })
  while (await notifications.count()) await notifications.first().click()
}

export async function formulaOcclusionFlow(page: Page, info: TestInfo) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await prepare(page, info)
  await nav(page, '学习材料').click()
  await page.locator('.source-list-title').filter({ hasText: title }).click()
  await page.getByRole('button', { name: '制作公式遮挡题', exact: true }).click()
  const tool = page.getByRole('dialog', { name: '制作公式遮挡题', exact: true })
  await tool.locator('[data-formula-leaf]').filter({ hasText: /^c$/ }).click()
  await tool.getByRole('button', { name: '添加遮挡区域', exact: true }).click()
  await tool.locator('[data-formula-leaf]').filter({ hasText: /^x$/ }).click()
  await tool.getByRole('button', { name: '添加遮挡区域', exact: true }).click()
  await page.screenshot({ path: info.outputPath('formula-region-authoring.png') })
  await tool.getByRole('button', { name: '创建 2 张卡片', exact: true }).click()
  await expect(tool).toHaveCount(0)
  const created = await localLibrary(page),
    note = created.notes[0]!,
    source = created.sources[0]!
  expect(created.cards).toHaveLength(2)
  expect(note.plugin?.variants).toHaveLength(2)
  expect(note.excerpt).toMatchObject({
    sourceId: source.id,
    mediaId: source.mediaId,
    quote: `$$${latex}$$`,
    locator: { kind: 'formula', latex },
  })
  expect(Object.values(note.plugin?.variantLocators ?? {})).toHaveLength(2)
  expect(created.cards.map((card) => card.variant).sort()).toEqual(
    note.plugin!.variants!.map((id) => `plugin:${id}`).sort(),
  )

  await nav(page, '学习概览').click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.locator('.vo-leaf-masked')).toHaveCount(1)
  const recalled = await page.locator('.vo-leaf-masked').textContent()
  expect(['c', 'x']).toContain(recalled)
  await page.getByRole('button', { name: '结束作答并查看答案', exact: true }).click()
  await expect(page.locator('.vo-leaf-masked')).toHaveCount(0)
  await page.getByRole('button', { name: /^查看原文/ }).click()
  const original = page.getByRole('dialog', { name: title, exact: true })
  await expect(original.locator('.vo-formula-source .vo-leaf-active')).toHaveText(recalled!)
  await original.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect.poll(async () => (await localLibrary(page)).reviews.length).toBe(1)
  const rated = await localLibrary(page),
    graded = rated.cards.find((card) => card.id === rated.reviews[0]!.cardId)!
  if (await page.getByRole('button', { name: '结束复习', exact: true }).isVisible())
    await page.getByRole('button', { name: '结束复习', exact: true }).click()

  await nav(page, '全部卡片').click()
  await page
    .getByRole('button', { name: /^编辑卡片/ })
    .first()
    .click()
  let editor = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  const regionKey = graded.variant.slice(7),
    regionLabel = (note.plugin!.data.regions as { id: string; label: string }[]).find(
      (region) => region.id === regionKey,
    )!.label
  await selectUiValue(editor.getByRole('combobox', { name: '遮挡区域', exact: true }), regionKey)
  await editor.getByRole('button', { name: '退役当前区域', exact: true }).click()
  await editor.getByRole('checkbox', { name: /确认/ }).check()
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect.poll(async () => (await localLibrary(page)).cards.length).toBe(1)
  expect((await localLibrary(page)).reviews).toHaveLength(0)

  await nav(page, '数据与备份').click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧版 JSON', exact: true }).click()
  const path = await (await download).path()
  const portable = parseBackup(await readFile(path!, 'utf8'))
  expect(portable.retired?.[0]?.cards[0]).toEqual(graded)
  expect(portable.retired?.[0]?.reviews).toEqual(rated.reviews)
  const archiveDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
  const archivePath = await (await archiveDownload).path(),
    bytes = await readFile(archivePath!)
  const archived = await parseArchive(new Blob([new Uint8Array(bytes).buffer]))
  expect(archived.retired?.[0]?.cards[0]).toEqual(graded)
  expect(archived.retired?.[0]?.reviews).toEqual(rated.reviews)
  await page
    .getByLabel('导入备份文件')
    .setInputFiles({ name: 'formula-retired.repeaty', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await nav(page, '全部卡片').click()
  await page
    .getByRole('button', { name: /^编辑卡片/ })
    .first()
    .click()
  editor = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await editor.getByRole('button', { name: `恢复 ${regionLabel}`, exact: true }).click()
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect.poll(async () => (await localLibrary(page)).cards.length).toBe(2)
  const restored = await localLibrary(page)
  expect(restored.cards.find((card) => card.id === graded.id)).toEqual(graded)
  expect(restored.reviews).toEqual(rated.reviews)

  await openPluginManager(page)
  await selectPlugin(page, 'visual-occlusion')
  const details = page.locator('.plugin-settings[data-plugin-id="visual-occlusion"]')
  await details.getByRole('switch', { name: '启用 图像与公式遮挡', exact: true }).click()
  const disabled = await localLibrary(page)
  expect(disabled.cards).toEqual(restored.cards)
  expect(disabled.notes).toEqual(restored.notes)
  expect(disabled.reviews).toEqual(restored.reviews)
  expect(errors).toEqual([])
}

export async function imageOcclusionFlow(page: Page, info: TestInfo) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await prepare(page, info)
  const encoded = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 400
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 600, 400)
      ctx.fillStyle = '#bd322e'
      ctx.fillRect(60, 80, 120, 120)
      ctx.fillStyle = '#40765a'
      ctx.fillRect(330, 120, 150, 160)
      return canvas.toDataURL('image/png').split(',')[1]!
    }),
    bytes = Buffer.from(encoded, 'base64')
  await nav(page, '学习材料').click()
  const imported = await openCollection(page)
  await imported
    .getByTestId('collection-files')
    .setInputFiles({ name: 'p4-regions.png', mimeType: 'image/png', buffer: bytes })
  await expect(imported).toContainText('p4-regions.png')
  await previewCollection(imported)
  await commitCollection(imported)
  await expect(imported).toHaveCount(0)
  await page.locator('.source-list-title').filter({ hasText: 'p4-regions.png' }).click()
  const reader = page.locator('.vo-reader')
  await expect(reader.locator('.vo-stage img')).toBeVisible()
  await reader.locator('.vo-stage img').evaluate((image: HTMLImageElement) => image.decode())
  const originalDownload = page.waitForEvent('download')
  await reader.getByRole('button', { name: '保存原件', exact: true }).click()
  expect(await readFile((await (await originalDownload).path())!)).toEqual(bytes)
  const bounds = await reader.locator('.vo-stage').boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width * 0.1, bounds!.y + bounds!.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width * 0.3, bounds!.y + bounds!.height * 0.5)
  await page.mouse.up()
  await page.getByRole('button', { name: '添加批注', exact: true }).click()
  await page
    .getByRole('textbox', { name: '批注内容', exact: true })
    .fill('红色区域的定位和原件应保持不变')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '编辑批注', exact: true })).toHaveCount(0)
  const source = (await localLibrary(page)).sources.find(
    (source) => source.title === 'p4-regions.png',
  )!
  expect(source.annotations).toHaveLength(1)
  expect(source.annotations![0]!.locator).toMatchObject({
    kind: 'image',
    sourceId: source.id,
    versionId: source.mediaId,
    x: expect.closeTo(0.1),
    y: expect.closeTo(0.2),
    width: expect.closeTo(0.2),
    height: expect.closeTo(0.3),
  })
  await page.locator('.source-annotations .annotation-quote').click()
  const annotation = page.getByRole('dialog', { name: 'p4-regions.png', exact: true })
  await expect(annotation.locator('.vo-stage img')).toBeVisible()
  await expect
    .poll(() =>
      annotation.locator('.vo-stage img').evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(120)
  await expect
    .poll(() =>
      annotation
        .locator('.vo-stage img')
        .evaluate((image: HTMLImageElement) => image.naturalHeight),
    )
    .toBe(120)
  await annotation.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '制作图片遮挡题', exact: true }).click()
  const tool = page.getByRole('dialog', { name: '制作图片遮挡题', exact: true })
  await expect(tool.getByRole('button', { name: '创建 1 张卡片', exact: true })).toBeEnabled()
  const stage = await tool.locator('.vo-stage').boundingBox()
  await page.mouse.move(stage!.x + stage!.width * 0.55, stage!.y + stage!.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(stage!.x + stage!.width * 0.8, stage!.y + stage!.height * 0.7)
  await page.mouse.up()
  await page.screenshot({ path: info.outputPath('image-region-authoring.png') })
  await tool.getByRole('button', { name: '创建 2 张卡片', exact: true }).click()
  await expect(tool).toHaveCount(0)
  const withCards = await localLibrary(page)
  expect(withCards.cards).toHaveLength(2)
  expect(withCards.notes[0]!.plugin?.data.kind).toBe('image')
  expect(withCards.notes[0]!.backMedia).toEqual([source.document!.originalMediaId])
  await nav(page, '学习概览').click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.locator('.vo-region.is-masked')).toHaveCount(1)
  await page.getByRole('button', { name: '结束作答并查看答案', exact: true }).click()
  await expect(page.locator('.vo-region.is-masked')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /良好/ })).toBeEnabled()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect.poll(async () => (await localLibrary(page)).reviews.length).toBe(1)
  expect(errors).toEqual([])
}
