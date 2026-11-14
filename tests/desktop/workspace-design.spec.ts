import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixture'

test('workspace file review remains readable at desktop and narrow widths', async ({
  page,
}, info) => {
  const directory = await page.evaluate(async () => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string): Promise<{ active: { path: string } }>
        }
      }
    ).__TAURI_INTERNALS__
    return (await native.invoke('workspace_status')).active.path
  })
  await writeFile(
    join(directory, 'notes/间隔复习.md'),
    '# 为什么需要间隔复习？\n\n主动回忆与适当的间隔，让记忆更牢固。\n',
  )
  await writeFile(
    join(directory, 'sources/学习方法.md'),
    '# 学习方法\n\n每次复习前，先尝试回忆，再核对答案。\n',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const dismiss = page.getByRole('button', { name: '关闭提示', exact: true })
  if (await dismiss.isVisible()) await dismiss.click()
  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  await page.locator('.workspace-file').filter({ hasText: 'notes/间隔复习.md' }).click()
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible()
  await expect(page.locator('.workspace-summary')).toHaveText('2 项待处理')
  await page.getByRole('button', { name: '接受修改', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '接受文件修改' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('workspace-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 500, height: 1000 })
  await page.screenshot({ path: info.outputPath('workspace-500.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const actions = page.locator('.workspace-document-toolbar')
  await actions.scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('workspace-500-file.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.locator('.workspace-manager h1').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('workspace-dark-1440.png'), fullPage: true })
})
