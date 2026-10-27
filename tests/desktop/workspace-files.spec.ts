import { test, expect, storedLibrary } from './fixture'
import { readFile, writeFile, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { fixture } from '../../src/core/test-fixtures'
import { createNativeRepository } from '../../src/desktop/repository'
import { removeNotes } from '../../src/core/model'
import type { Card, Review } from '../../src/core/model'
async function root(page: Page) {
  return page.evaluate(async () => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(
            command: string,
            args?: Record<string, unknown>,
          ): Promise<{ active: { path: string } }>
        }
      }
    ).__TAURI_INTERNALS__
    return (await native.invoke('workspace_status')).active.path
  })
}
async function files(page: Page) {
  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
}
async function scan(page: Page, path: string) {
  await page.getByRole('button', { name: '重新扫描', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  await page.locator('.workspace-file').filter({ hasText: path }).click()
}
const values = <T>(rows: unknown) => (rows as { value: T }[]).map((row) => row.value)
test('external create, cloze retirement, restore, deletion and undo preserve study records and original files', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('文件学习库')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const directory = await root(page),
    path = 'notes/外部笔记.md'
  const raw =
    '\uFEFF---\r\n# keep this comment\r\ncustom: [a, b]\r\n---\r\n{{c1::第一}}与{{c2::第二}}\r\n'
  await writeFile(join(directory, path), raw)
  await files(page)
  await page.locator('.workspace-file').filter({ hasText: path }).click()
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '接受文件修改', exact: true })
  await confirmation.getByLabel('笔记类型').selectOption('cloze')
  await expect(confirmation).toContainText('新增 2 张')
  expect((await storedLibrary(page)).notes).toHaveLength(0)
  await confirmation.getByRole('button', { name: '确认接受', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  let snapshot = await storedLibrary(page)
  const original = values<Card>(snapshot.cards)
  expect(original).toHaveLength(2)
  const registered = await readFile(join(directory, path), 'utf8')
  expect(registered.startsWith('\uFEFF---\r\n# keep this comment')).toBe(true)
  expect(registered).toContain('id:')
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^良好/ }).click()
  await expect.poll(async () => values<Review>((await storedLibrary(page)).reviews).length).toBe(1)
  snapshot = await storedLibrary(page)
  const rated = values<Card>(snapshot.cards),
    reviews = values<Review>(snapshot.reviews)
  const ratedId = reviews[0]!.cardId
  const number = rated.find((card) => card.id === ratedId)!.variant.split(':')[1]!
  await files(page)
  await writeFile(
    join(directory, path),
    registered.replace(
      number === '1' ? '{{c1::第一}}' : '{{c2::第二}}',
      number === '1' ? '第一' : '第二',
    ),
  )
  await scan(page, path)
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  await expect(confirmation).toContainText('退役 1 张')
  expect((await storedLibrary(page)).cards).toHaveLength(2)
  await confirmation.getByRole('button', { name: '确认接受', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  expect((await storedLibrary(page)).cards).toHaveLength(1)
  expect((await storedLibrary(page)).reviews).toHaveLength(0)
  await page.reload()
  await files(page)
  await writeFile(join(directory, path), registered)
  await scan(page, path)
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  await expect(confirmation).toContainText('恢复 1 张')
  await confirmation.getByRole('button', { name: '确认接受', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  let restored = await storedLibrary(page)
  expect(values<Card>(restored.cards).find((card) => card.id === ratedId)).toEqual(
    rated.find((card) => card.id === ratedId),
  )
  expect(values<Review>(restored.reviews)).toEqual(reviews)
  await rm(join(directory, path))
  await scan(page, path)
  await page.getByRole('button', { name: '移除这条笔记', exact: true }).click()
  const remove = page.getByRole('dialog', { name: '确认移除笔记', exact: true })
  await expect(remove).toContainText('2 张卡片')
  await remove.getByRole('button', { name: '确认移除', exact: true }).click()
  await expect(remove).toHaveCount(0)
  expect((await storedLibrary(page)).notes).toHaveLength(0)
  await expect(page.locator('.workspace-retired')).toContainText('恢复笔记')
  // Undo must recreate the original path, including its comments and line endings.
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect
    .poll(async () => values<{ id: string }>((await storedLibrary(page)).notes).length)
    .toBe(1)
  expect(await readFile(join(directory, path), 'utf8')).toBe(registered)
  await scan(page, path)
  await rm(join(directory, path))
  await scan(page, path)
  await page.getByRole('button', { name: '移除这条笔记', exact: true }).click()
  await remove.getByRole('button', { name: '确认移除', exact: true }).click()
  await expect(remove).toHaveCount(0)
  await page.reload()
  await files(page)
  // A newly occupied path is preserved; restoration can choose a different file name.
  await writeFile(join(directory, path), 'This is another file')
  await page
    .locator('.workspace-retired-entry')
    .filter({ hasText: path })
    .getByRole('button', { name: '恢复笔记', exact: true })
    .click()
  const recover = page.getByRole('dialog', { name: '恢复笔记', exact: true })
  await recover.getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect(recover.getByRole('alert')).toContainText('文件已在外部修改')
  expect(await readFile(join(directory, path), 'utf8')).toBe('This is another file')
  await recover.getByLabel('文件路径').fill('notes/恢复笔记.md')
  await recover.getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect(recover).toHaveCount(0)
  restored = await storedLibrary(page)
  expect(values<Card>(restored.cards).find((card) => card.id === ratedId)).toEqual(
    rated.find((card) => card.id === ratedId),
  )
  expect(values<Review>(restored.reviews)).toEqual(reviews)
  expect(await readFile(join(directory, 'notes/恢复笔记.md'), 'utf8')).toBe(registered)
})
test('duplicate identities cannot be accepted and changed files invalidate a deletion confirmation', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Safety')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.locator('#card-front').fill('Question')
  await page.locator('#card-back').fill('Answer')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const directory = await root(page)
  const docs = await page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__.invoke
    const { active } = (await invoke('workspace_status')) as { active: { token: string } }
    return invoke('workspace_read', {
      token: active.token,
      request: { type: 'documents' },
    }) as Promise<{ id: string; path: string; raw: string }[]>
  })
  const doc = docs[0]!,
    before = await storedLibrary(page)
  await copyFile(join(directory, doc.path), join(directory, 'notes/duplicate.md'))
  await files(page)
  await expect(page.locator('.workspace-file-status').filter({ hasText: '存在冲突' })).toHaveCount(
    2,
  )
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toHaveCount(0)
  await rm(join(directory, 'notes/duplicate.md'))
  await rm(join(directory, doc.path))
  await scan(page, doc.path)
  await page.getByRole('button', { name: '移除这条笔记', exact: true }).click()
  const remove = page.getByRole('dialog', { name: '确认移除笔记', exact: true })
  await expect(remove).toBeVisible()
  await writeFile(join(directory, 'notes/renamed.md'), doc.raw)
  await remove.getByRole('button', { name: '确认移除', exact: true }).click()
  await expect(remove.getByRole('alert')).toContainText('文件已在外部修改')
  expect(await storedLibrary(page)).toEqual(before)
  await remove.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '重新扫描', exact: true }).click()
  await expect(page.locator('.workspace-file-status')).toHaveText('文件已改名')
})

test('removed-note search stays paginated when the last page is restored', async ({ page }) => {
  await page.getByRole('button', { name: '新建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Paging')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const active = await page.evaluate(
    async () =>
      (
        await (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke(
                command: string,
              ): Promise<{ active: { id: string; token: string; path: string } }>
            }
          }
        ).__TAURI_INTERNALS__.invoke('workspace_status')
      ).active,
  )
  const repo = createNativeRepository(active, (command, args) =>
    page.evaluate(
      ({ command, args }) =>
        (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke(command: string, args?: Record<string, unknown>): Promise<never>
            }
          }
        ).__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    ),
  )
  let saved = await repo.load()
  const template = fixture(),
    note = template.notes[0]!,
    card = template.cards[0]!
  const notes = Array.from({ length: 55 }, (_, index) => ({
    ...note,
    id: 'paging-' + index,
    deckId: saved.library.decks[0]!.id,
    front: 'Paging note ' + index,
  }))
  saved = await repo.save(
    {
      ...saved.library,
      notes,
      cards: notes.map((note, index) => ({ ...card, id: 'paging-card-' + index, noteId: note.id })),
    },
    saved.revision,
  )
  await repo.save(removeNotes(saved.library, new Set(notes.map((note) => note.id))), saved.revision)
  await page.reload()
  await files(page)
  const archive = page.locator('.workspace-retired')
  await archive.getByLabel('查找已移除的笔记').fill('Paging note ')
  await archive.getByRole('button', { name: '查找', exact: true }).click()
  await expect(archive).toContainText('共 55 条')
  await expect(archive.locator('.workspace-retired-entry')).toHaveCount(50)
  await archive.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(archive.locator('.workspace-retired-entry')).toHaveCount(5)
  for (let remaining = 5; remaining > 0; remaining--) {
    await archive.getByRole('button', { name: '恢复笔记', exact: true }).first().click()
    const recover = page.getByRole('dialog', { name: '恢复笔记', exact: true })
    await recover.getByRole('button', { name: '确认恢复', exact: true }).click()
    await expect(recover).toHaveCount(0)
    await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  }
  await expect(archive).toContainText('共 50 条')
  await expect(archive.locator('.workspace-retired-entry')).toHaveCount(50)
  await expect(archive.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0)
  expect((await storedLibrary(page)).notes).toHaveLength(5)
})
