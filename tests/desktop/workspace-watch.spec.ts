import { selectUiValue } from '../fixtures/ui-flow'
import { test, expect, storedLibrary } from './fixture'
import { writeFile, readFile, rename, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { createSourceDeck } from '../fixtures/source-flow'
import type { Note } from '../../src/core/model'
const values = <T>(rows: unknown) => (rows as { value: T }[]).map((row) => row.value)
async function storage(page: Page) {
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
    })) as { id: string; path: string; raw: string }[]
    return { root: active.path, docs }
  })
}
const sidebar = (page: Page) => page.getByRole('button', { name: '工作目录', exact: true })
const pending = (page: Page) => sidebar(page).locator('.nav-count')
async function openFiles(page: Page) {
  await sidebar(page).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
}

test('automatically detects saves and renames, keeps a review stable, and refuses a stale open confirmation', async ({
  page,
}) => {
  await createSourceDeck(page)
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('正面 · 问题', { exact: true }).fill('保存时的原题目')
  await page.getByLabel('背面 · 答案', { exact: true }).fill('保存时的答案')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const { root, docs } = await storage(page),
    doc = docs[0]!
  const before = await storedLibrary(page)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.locator('.card-question')).toContainText('保存时的原题目')
  await writeFile(join(root, doc.path), doc.raw.replace('保存时的原题目', '外部第一次修改'))
  await expect(pending(page)).toHaveText('1')
  const separator = page.getByRole('separator', { name: '调整侧栏宽度', exact: true })
  await separator.press('Home')
  await expect(page.locator('.app-layout')).toHaveClass(/sidebar-collapsed/)
  await expect(pending(page)).toBeVisible()
  await expect(sidebar(page)).toHaveAttribute('title', '工作目录 · 1 项文件修改待检查')
  await separator.press('End')
  await expect(page.locator('.card-question')).toContainText('保存时的原题目')
  expect(await storedLibrary(page)).toEqual(before)
  await openFiles(page)
  await page.locator('.workspace-file').filter({ hasText: doc.path }).click()
  await expect(page.locator('.workspace-raw')).toContainText('外部第一次修改')
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '接受文件修改', exact: true })
  await expect(modal).toBeVisible()
  await selectUiValue(modal.getByLabel('内容格式'), 'markdown')
  await writeFile(join(root, doc.path), doc.raw.replace('保存时的原题目', '外部第二次修改'))
  await modal.getByRole('button', { name: '确认接受', exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('文件已在外部修改')
  await expect(modal.getByLabel('内容格式')).toHaveAttribute('value', 'markdown')
  expect(await storedLibrary(page)).toEqual(before)
  await modal.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.workspace-raw')).toContainText('外部第二次修改')
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  await modal.getByRole('button', { name: '确认接受', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(pending(page)).toHaveCount(0)
  expect(values<Note>((await storedLibrary(page)).notes)[0]!.front).toContain('外部第二次修改')
  await mkdir(join(root, 'notes/子目录'))
  await rename(join(root, doc.path), join(root, 'notes/子目录/新名字.md'))
  await expect(
    page.locator('.workspace-file').filter({ hasText: 'notes/子目录/新名字.md' }),
  ).toContainText('文件已改名')
  await expect(pending(page)).toHaveText('1')
  await rename(join(root, 'notes/子目录/新名字.md'), join(root, doc.path))
  await expect(pending(page)).toHaveCount(0)
  await rm(join(root, doc.path))
  await expect(page.locator('.workspace-file').filter({ hasText: doc.path })).toContainText(
    '文件缺失',
  )
  expect(values<Note>((await storedLibrary(page)).notes)).toHaveLength(1)
})

test('detects referenced attachment replacements without changing accepted bytes, and checks again on focus', async ({
  page,
}) => {
  await createSourceDeck(page)
  const { root } = await storage(page),
    path = 'notes/附件.md'
  const first = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hfoAAAAASUVORK5CYII=',
    'base64',
  )
  await writeFile(join(root, 'assets/picture.png'), first)
  await writeFile(
    join(root, path),
    '![图片](../assets/picture.png)\n\n<!-- repeaty:answer -->\n\n答案',
  )
  await expect(pending(page)).toHaveText('1')
  await openFiles(page)
  await page.locator('.workspace-file').filter({ hasText: path }).click()
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '接受文件修改', exact: true })
  await modal.getByRole('button', { name: '确认接受', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(pending(page)).toHaveCount(0)
  const accepted = await storedLibrary(page)
  const raw = await readFile(join(root, path), 'utf8')
  await writeFile(
    join(root, 'assets/picture.png'),
    Buffer.concat([first, Buffer.from('replacement')]),
  )
  await expect(pending(page)).toHaveText('1')
  await expect(page.locator('.workspace-document')).toContainText('正文引用的附件已变化')
  expect(await storedLibrary(page)).toEqual(accepted)
  await writeFile(join(root, 'assets/picture.png'), first)
  await expect(pending(page)).toHaveCount(0)
  // Focus is also a reconciliation path, independent of OS event delivery.
  await page.evaluate(() => {
    ;(window as unknown as { __repeatyTestDropWatchEvents: boolean }).__repeatyTestDropWatchEvents =
      true
  })
  await writeFile(join(root, path), raw.replace('答案', '重新聚焦后看到的修改'))
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __repeatyTestDroppedWatchEvents: number })
            .__repeatyTestDroppedWatchEvents,
      ),
    )
    .toBeGreaterThan(0)
  await expect(page.locator('.workspace-raw')).not.toContainText('重新聚焦后看到的修改')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.workspace-raw')).toContainText('重新聚焦后看到的修改')
  expect(await storedLibrary(page)).toEqual(accepted)
})
