import {
  openCollection,
  previewCollection,
  commitCollection,
  cancelCollection,
} from './collection-controls'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlugin } from '../../packages/plugin-api/build.mjs'
import { fixture } from '../../src/core/test-fixtures'
import type { PluginBundle } from '../../src/plugins/package'
import { confirmPluginAction, openPluginManager, selectPlugin } from './settings-flow'
import { localLibrary } from './source-excerpt-flow'
import { selectUiValue } from './ui-flow'

const id = 'structured-study-example'
const title = '材料插件：重复文本定位'
const quote = '第二次回忆🧩保留版本与出处。'
const text = `第一段：${quote}\n\n中间的上下文。\n\n最后一段：${quote}`
const studyDocument = JSON.stringify({
  version: 1,
  chapters: [
    { id: 'first', title, body: text },
    { id: 'second', title: '材料插件：第二章', body: '每章独立导入，但原文件保持原始字节。' },
  ],
})
const nav = (page: Page, name: string) =>
  page.locator('.main-nav').getByRole('button', { name, exact: true })

async function install(page: Page, bundle: PluginBundle) {
  await openPluginManager(page)
  await page.locator('.plugin-actions input[type=file]').setInputFiles({
    name: `${id}.repeaty-plugin`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  })
  await confirmPluginAction(page)
}

async function prepare(page: Page, info: TestInfo) {
  const library = fixture()
  library.notes = []
  library.cards = []
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'material-plugin-empty.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The host has already been built. The example compiles separately using only the public SDK.
  const bundle = await buildPlugin(resolve('docs/examples/material-plugin'), {
    outdir: info.outputPath('independent-material-plugin'),
  })
  await install(page, bundle)
  return bundle
}

async function preview(page: Page, content = studyDocument) {
  await nav(page, '学习材料').click()
  const dialog = await openCollection(page)
  await dialog.getByTestId('collection-files').setInputFiles({
    name: 'chapters.study.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  })
  await previewCollection(dialog)
  return dialog
}

async function openChapter(page: Page) {
  await nav(page, '学习材料').click()
  await page.locator('.source-list-title').filter({ hasText: title }).click()
}

async function selectLastQuote(page: Page) {
  await page.getByTestId('structured-study-text').evaluate(
    (element, { start, length }) => {
      const text = element.firstChild!
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, start + length)
      const selection = getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    },
    { start: text.lastIndexOf(quote), length: quote.length },
  )
  await expect(page.getByRole('button', { name: '用摘录制卡', exact: true })).toBeEnabled()
}

function persistentLearning(library: Awaited<ReturnType<typeof localLibrary>>) {
  return {
    notes: library.notes,
    cards: library.cards,
    reviews: library.reviews,
    sources: library.sources.map(({ id, title, mediaId, document, origin }) => ({
      id,
      title,
      mediaId,
      document,
      origin,
    })),
    media: library.media,
  }
}

export async function materialPluginFlow(page: Page, info: TestInfo) {
  const bundle = await prepare(page, info)
  const dialog = await preview(page)
  await expect(dialog).toContainText(title)
  expect((await localLibrary(page)).sources).toHaveLength(0)
  await commitCollection(dialog)
  await expect(dialog).toHaveCount(0)
  const imported = await localLibrary(page)
  expect(imported.sources).toHaveLength(2)
  const source = imported.sources.find((item) => item.title === title)!
  expect(source.document?.providerId).toBe(id)
  expect(source.document?.readerId).toBe('chapter')

  await selectUiValue(
    page.getByRole('combobox', { name: '材料搜索提供方', exact: true }),
    `${id}:chapters`,
  )
  await page.getByRole('textbox', { name: '材料全文搜索', exact: true }).fill('中间的上下文')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const results = page.getByRole('list', { name: '材料搜索结果', exact: true })
  await expect(results).toContainText('中间的上下文')
  await results
    .getByRole('button')
    .filter({ has: page.locator('span').filter({ hasText: title }) })
    .click()
  const projection = page.getByRole('textbox', { name: '材料正文', exact: true })
  await expect
    .poll(() =>
      projection.evaluate((element: HTMLTextAreaElement) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      ),
    )
    .toBe('中间的上下文')
  await page.getByRole('button', { name: '使用插件阅读器', exact: true }).click()
  await expect(page.getByTestId('structured-study-reader')).toBeVisible()
  await selectLastQuote(page)
  await page.getByRole('button', { name: '用摘录制卡', exact: true }).click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('如何保留第二处引用的出处？')
  await expect(page.getByLabel('背面 · 答案', { exact: true })).toHaveValue(quote)
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  const withCard = await localLibrary(page)
  expect(withCard.notes).toHaveLength(1)
  expect(withCard.notes[0]!.excerpt).toMatchObject({
    sourceId: source.id,
    mediaId: source.mediaId,
    start: text.lastIndexOf(quote),
    end: text.lastIndexOf(quote) + quote.length,
    quote,
    locator: {
      schemaVersion: 1,
      sourceId: source.id,
      versionId: source.mediaId,
      kind: 'text',
    },
  })
  await nav(page, '学习概览').click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText(quote)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  expect((await localLibrary(page)).reviews).toHaveLength(1)

  // A repeated file is detected by the host, not a plugin-local cache.
  const repeated = await preview(page)
  await expect(repeated).toContainText('已收集')
  await commitCollection(repeated)
  await expect(repeated).toHaveCount(0)
  expect((await localLibrary(page)).sources.map((item) => item.id)).toEqual(
    imported.sources.map((item) => item.id),
  )

  await page.reload()
  await openChapter(page)
  await expect(page.getByTestId('structured-study-reader')).toBeVisible()
  await expect(page.getByTestId('structured-study-text')).toHaveText(text)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出原件', exact: true }).click()
  const exported = await download
  const path = await exported.path()
  expect(path).not.toBeNull()
  expect(await readFile(path!, 'utf8')).toBe(studyDocument)

  await selectLastQuote(page)
  await page.getByRole('button', { name: '把选区保存为摘录', exact: true }).click()
  await expect.poll(async () => (await localLibrary(page)).sources.length).toBe(3)
  const commandExcerpt = (await localLibrary(page)).sources.find((item) => item.kind === 'excerpt')!
  expect(commandExcerpt.origin).toMatchObject({
    sourceId: source.id,
    mediaId: source.mediaId,
    start: text.lastIndexOf(quote),
    end: text.lastIndexOf(quote) + quote.length,
    locator: { kind: 'text', sourceId: source.id, versionId: source.mediaId },
  })

  const broken = {
    ...bundle,
    manifest: { ...bundle.manifest, version: '2.0.0' },
    main: 'throw new Error("material-update-rejected")',
  }
  await install(page, broken)
  await expect(
    page.getByRole('alert').filter({ hasText: 'material-update-rejected' }),
  ).toBeVisible()
  await openChapter(page)
  await expect(page.getByTestId('structured-study-reader')).toBeVisible()
  const learned = persistentLearning(await localLibrary(page))

  await openPluginManager(page)
  await selectPlugin(page, id)
  const details = page.locator(`.plugin-settings[data-plugin-id="${id}"]`)
  await details.getByRole('switch', { name: '启用 Structured Study', exact: true }).click()
  await openChapter(page)
  await expect(page.getByTestId('structured-study-reader')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(text)
  expect(persistentLearning(await localLibrary(page))).toEqual(learned)
  await expect(page.getByRole('button', { name: '导出原件', exact: true })).toBeVisible()

  await openPluginManager(page)
  await selectPlugin(page, id)
  await details.getByRole('switch', { name: '启用 Structured Study', exact: true }).click()
  await openChapter(page)
  await expect(page.getByTestId('structured-study-reader')).toBeVisible()
  await openPluginManager(page)
  await selectPlugin(page, id)
  await details.getByRole('button', { name: '卸载插件', exact: true }).click()
  await confirmPluginAction(page)
  await page.reload()
  await openChapter(page)
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(text)
  expect(persistentLearning(await localLibrary(page))).toEqual(learned)
}

export async function materialPluginInvalidImportFlow(page: Page, info: TestInfo) {
  await prepare(page, info)
  const broken = JSON.stringify({
    version: 1,
    chapters: [
      { id: 'valid', title: 'Must not be imported', body: 'Good first chapter' },
      { id: 'bad' },
    ],
  })
  const dialog = await preview(page, broken)
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect((await localLibrary(page)).sources).toHaveLength(0)
  await cancelCollection(dialog)
  const next = await preview(page)
  await expect(next).toContainText(title)
  await cancelCollection(next)
  expect((await localLibrary(page)).sources).toHaveLength(0)
}

interface MaterialWorkerProbe {
  holdInputs: boolean
  revoked: string[]
  violations: string[]
  workers: {
    url: string
    ready: boolean
    held: boolean
    results: number
    errors: number
    terminations: number
  }[]
}

async function observeMaterialWorkers(page: Page) {
  await page.addInitScript(() => {
    const state: MaterialWorkerProbe = {
      holdInputs: false,
      revoked: [],
      violations: [],
      workers: [],
    }
    Object.defineProperty(window, '__repeatyMaterialWorkers', { value: state })
    window.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective === 'worker-src') state.violations.push(event.blockedURI)
    })
    const NativeWorker = window.Worker,
      revoke = URL.revokeObjectURL.bind(URL)
    // Keep actual browser workers and actual blob URLs. Observe only the example's named worker.
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (options?.name !== 'repeaty-study-json-parser') return
        const record = {
          url: String(url),
          ready: false,
          held: false,
          results: 0,
          errors: 0,
          terminations: 0,
        }
        state.workers.push(record)
        this.addEventListener('message', (event) => {
          if (event.data?.type === 'ready') record.ready = true
          if (event.data?.type === 'result') record.results = event.data.candidates.length
          if (event.data?.type === 'error') record.errors++
        })
        const terminate = this.terminate.bind(this),
          send = this.postMessage.bind(this)
        this.terminate = () => {
          record.terminations++
          terminate()
        }
        this.postMessage = ((
          message: unknown,
          options?: StructuredSerializeOptions | Transferable[],
        ) => {
          // Deterministic cancellation barrier: the real worker has started and waits for input.
          // Ordinary success/error cases pass bytes straight through to the actual worker.
          if (state.holdInputs) {
            record.held = true
            return
          }
          send(message, options as StructuredSerializeOptions)
        }) as Worker['postMessage']
      }
    }
    URL.revokeObjectURL = (url) => {
      state.revoked.push(url)
      revoke(url)
    }
  })
  await page.goto('./')
}

function materialWorkers(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __repeatyMaterialWorkers: MaterialWorkerProbe })
        .__repeatyMaterialWorkers,
  )
}

export async function materialPluginWorkerFlow(page: Page, info: TestInfo) {
  await observeMaterialWorkers(page)
  await prepare(page, info)
  const completed = await preview(page)
  await expect(completed).toContainText(title)
  await expect
    .poll(async () => {
      const state = await materialWorkers(page),
        worker = state.workers[0]
      return (
        !!worker &&
        worker.ready &&
        worker.results === 2 &&
        worker.terminations === 1 &&
        state.revoked.includes(worker.url)
      )
    })
    .toBe(true)
  await cancelCollection(completed)
  await page.evaluate(() => {
    ;(
      window as unknown as { __repeatyMaterialWorkers: MaterialWorkerProbe }
    ).__repeatyMaterialWorkers.holdInputs = true
  })
  const pending = await preview(page)
  await expect
    .poll(async () => {
      const worker = (await materialWorkers(page)).workers[1]
      return !!worker && worker.ready && worker.held && worker.terminations === 0
    })
    .toBe(true)
  await cancelCollection(pending)
  await expect(pending).toHaveCount(0)
  await expect
    .poll(async () => {
      const state = await materialWorkers(page),
        worker = state.workers[1]!
      return worker.terminations === 1 && worker.results === 0 && state.revoked.includes(worker.url)
    })
    .toBe(true)
  await page.evaluate(() => {
    ;(
      window as unknown as { __repeatyMaterialWorkers: MaterialWorkerProbe }
    ).__repeatyMaterialWorkers.holdInputs = false
  })
  const failed = await preview(page, '{ invalid json')
  await expect(failed.getByRole('alert')).toBeVisible()
  await expect
    .poll(async () => {
      const state = await materialWorkers(page),
        worker = state.workers[2]
      return (
        !!worker &&
        worker.ready &&
        worker.errors === 1 &&
        worker.terminations === 1 &&
        state.revoked.includes(worker.url)
      )
    })
    .toBe(true)
  expect((await localLibrary(page)).sources).toHaveLength(0)
  expect((await materialWorkers(page)).violations).toEqual([])
}
