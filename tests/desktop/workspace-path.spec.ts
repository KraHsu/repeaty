import { test, expect } from './fixture'
import { openSettings } from '../fixtures/settings-flow'

test('Windows extended workspace paths have friendly labels while reopening retains the original path', async ({
  page,
}) => {
  const original = String.raw`\\?\D:\tmp\repeaty-test`
  const display = String.raw`D:\tmp\repeaty-test`
  await page.evaluate((original) => {
    const controls = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
      }
      __repeatyRecentPath?: string
    }
    const invoke = controls.__TAURI_INTERNALS__.invoke
    controls.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'workspace_recent') {
        controls.__repeatyRecentPath = args?.path as string
        return null
      }
      const result = await invoke(command, args)
      if (command !== 'workspace_status') return result
      const status = result as {
        active: { id: string; token: string; path: string }
        recent: { id: string; path: string }[]
      }
      return {
        ...status,
        active: { ...status.active, path: original },
        recent: [{ id: status.active.id, path: original }],
      }
    }
  }, original)

  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.workspace-active .workspace-path')).toHaveText(display)
  const recent = page.locator('.workspace-recent-entry')
  await expect(recent).toHaveText(display)
  await recent.click()
  expect(
    await page.evaluate(
      () => (window as unknown as { __repeatyRecentPath?: string }).__repeatyRecentPath,
    ),
  ).toBe(original)

  await openSettings(page, 'workspace')
  await expect(page.locator('.workspace-setting-path')).toHaveText(display)
})
