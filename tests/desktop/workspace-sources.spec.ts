import { test, expect, storedLibrary } from './fixture'
import {
  createSourceDeck,
  previewSource,
  saveSource,
  createExcerptCard,
  sourceText,
  sourceQuote,
} from '../fixtures/source-flow'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { Source } from '../../src/core/source-data'
import type { Card, Note } from '../../src/core/model'
import { saveReading } from '../fixtures/reading-flow'

const picture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hfoAAAAASUVORK5CYII=',
  'base64',
)
function wave(size = 16000) {
  const buffer = Buffer.alloc(44 + size)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24)
  buffer.writeUInt32LE(16000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(size, 40)
  return buffer
}
const values = <T>(rows: unknown) => (rows as { value: T }[]).map((row) => row.value)
async function documents(page: Page) {
  return page.evaluate(async () => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke(command: string, args?: unknown): Promise<unknown> }
      }
    ).__TAURI_INTERNALS__
    const { active } = (await native.invoke('workspace_status')) as {
      active: { token: string; path: string }
    }
    const docs = (await native.invoke('workspace_read', {
      token: active.token,
      request: { type: 'documents' },
    })) as { kind: string; id: string; path: string; raw: string }[]
    return { root: active.path, docs }
  })
}
async function files(page: Page, path?: string) {
  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  if (path) {
    await page.getByRole('button', { name: '重新扫描', exact: true }).click()
    await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
    await page.locator('.workspace-file').filter({ hasText: path }).click()
  }
}
async function accept(page: Page, source = true) {
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  const modal = page.getByRole('dialog', {
    name: source ? '接受材料修改' : '接受文件修改',
    exact: true,
  })
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: '确认接受', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
}

test('source file acceptance keeps old quotes, positions and card progress; media-only changes create another version', async ({
  page,
}) => {
  await createSourceDeck(page)
  await previewSource(page)
  await saveSource(page)
  await createExcerptCard(page)
  await saveReading(page)
  await files(page)
  const before = await storedLibrary(page),
    source = values<Source>(before.sources)[0]!
  const storage = await documents(page),
    doc = storage.docs.find((doc) => doc.kind === 'source')!
  await writeFile(join(storage.root, 'assets/picture.png'), picture)
  await writeFile(join(storage.root, 'assets/sound.wav'), wave())
  const body =
    '# 第二版\n\n新的材料内容。\n\n![图片](../assets/picture.png)\n\n<audio src="../assets/sound.wav" controls></audio>\n'
  await writeFile(join(storage.root, doc.path), doc.raw.replace(sourceText, body))
  await files(page, doc.path)
  expect(values<Source>((await storedLibrary(page)).sources)[0]!.mediaId).toBe(source.mediaId)
  await accept(page)
  let saved = await storedLibrary(page),
    changed = values<Source>(saved.sources)[0]!
  expect(changed.versions![0]!.mediaId).toBe(source.mediaId)
  expect(changed.versions![0]!.reading).toEqual(source.reading)
  expect(changed.reading).toBeUndefined()
  expect(values<Card>(saved.cards)).toEqual(values<Card>(before.cards))
  expect(values<Note>(saved.notes)[0]!.excerpt!.mediaId).toBe(source.mediaId)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(body)
  await page.getByRole('button', { name: '阅读 Markdown 预览', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('.source-markdown-preview img')
        .evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true)
  await expect(page.locator('.source-markdown-preview img')).toHaveCount(1)
  await expect
    .poll(() =>
      page
        .locator('.source-markdown-preview audio')
        .evaluate((node) => Number.isFinite((node as HTMLAudioElement).duration)),
    )
    .toBe(true)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await page.getByRole('button', { name: /^版本 1 ·/ }).click()
  await expect(page.locator('.source-original')).toHaveText(sourceText)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await writeFile(
    join(storage.root, 'assets/picture.png'),
    Buffer.concat([picture, Buffer.from('new version')]),
  )
  await files(page, doc.path)
  await accept(page)
  saved = await storedLibrary(page)
  changed = values<Source>(saved.sources)[0]!
  expect(changed.versions).toHaveLength(2)
  expect(changed.inlineMedia![0]!.mediaId).not.toBe(changed.versions![1]!.inlineMedia![0]!.mediaId)
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^查看原文/ }).click()
  await expect(page.locator('.source-original mark')).toHaveText(sourceQuote)
  await expect(page.getByRole('dialog')).toContainText('正在查看摘录保存时的版本。')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
})

test('external notes render a relative picture and 8 MiB audio; attachment replacement can be undone', async ({
  page,
}) => {
  await createSourceDeck(page)
  const storage = await documents(page),
    path = 'notes/图片音频.md'
  await writeFile(join(storage.root, 'assets/picture.png'), picture)
  await writeFile(join(storage.root, 'assets/sound.wav'), wave(8 * 1024 * 1024))
  const raw =
    '![图](../assets/picture.png)\n\n<!-- repeaty:answer -->\n\n<audio src="../assets/sound.wav" controls></audio>'
  await writeFile(join(storage.root, path), raw)
  await files(page, path)
  await accept(page, false)
  const before = values<Note>((await storedLibrary(page)).notes)[0]!
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('.card-question img')
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(1)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('.card-answer audio')
        .evaluate((node) => Number.isFinite((node as HTMLAudioElement).duration)),
    )
    .toBe(true)
  await page.setViewportSize({ width: 720, height: 900 })
  expect(await page.locator('body').evaluate((node) => node.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'test-results/workspace-inline-media.png', fullPage: true })
  await writeFile(
    join(storage.root, 'assets/picture.png'),
    Buffer.concat([picture, Buffer.from('replacement')]),
  )
  await files(page, path)
  await accept(page, false)
  const updated = values<Note>((await storedLibrary(page)).notes)[0]!
  expect(updated.inlineMedia![0]!.mediaId).not.toBe(before.inlineMedia![0]!.mediaId)
  expect(await readFile(join(storage.root, path), 'utf8')).toContain('../assets/picture.png')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect
    .poll(async () => values<Note>((await storedLibrary(page)).notes)[0]!.inlineMedia![0]!.mediaId)
    .toBe(before.inlineMedia![0]!.mediaId)
  await page.reload()
  expect(values<Note>((await storedLibrary(page)).notes)[0]!.inlineMedia).toEqual(
    before.inlineMedia,
  )
})
