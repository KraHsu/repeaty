import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { WorkspaceStatus } from '../../src/desktop/workspaces'
import { test, expect, storedLibrary } from './fixture'

async function status(page: Page) {
  return page.evaluate(async () => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke(command: string): Promise<WorkspaceStatus> }
      }
    ).__TAURI_INTERNALS__
    return native.invoke('workspace_status')
  })
}

test('Open folder initializes an empty choice, seeds the starter deck and preserves it when reopened', async ({
  page,
}) => {
  const original = (await status(page)).active!
  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  // The native-picker fixture supplies a real, new, empty temporary folder.
  await page.getByRole('button', { name: '打开目录', exact: true }).click()
  await expect(page.locator('.b-focus-card h2')).toContainText('FSRS')
  const created = (await status(page)).active!
  expect(created.id).not.toBe(original.id)
  const marker = JSON.parse(await readFile(join(created.path, 'workspace.json'), 'utf8'))
  expect(marker.id).toBe(created.id)
  await expect.poll(async () => (await storedLibrary(page)).notes).toHaveLength(24)
  const saved = await storedLibrary(page)
  expect(saved.cards).toHaveLength(27)

  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '关闭目录', exact: true }).click()
  await expect(page.locator('.workspace-welcome')).toBeVisible()
  await page.locator('.workspace-recent-entry').filter({ hasText: created.path }).click()
  await expect(page.locator('.b-focus-card h2')).toContainText('FSRS')
  const reopened = (await status(page)).active!
  expect(reopened.id).toBe(created.id)
  expect(reopened.token).not.toBe(created.token)
  expect((await storedLibrary(page)).cards).toEqual(saved.cards)
  await page.reload()
  await expect(page.locator('.b-focus-card h2')).toContainText('FSRS')
  expect((await storedLibrary(page)).notes).toEqual(saved.notes)
})
