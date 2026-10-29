import { test, expect } from './fixture'
async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
}

test('complete backups round-trip into a new workspace and restore selected files without replacing the active library', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
  const section = page.getByRole('region', { name: '完整工作目录备份' })
  await section.getByRole('button', { name: '选择备份目录', exact: true }).click()
  await section.getByRole('button', { name: '立即备份', exact: true }).click()
  await expect(section.getByText('完整备份已写入并通过校验。', { exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: '预览与恢复', exact: true })).toHaveCount(1)
  await expect(section.getByRole('button', { name: '立即备份', exact: true })).toBeEnabled()
  await settle(page)
  await page.screenshot({ path: info.outputPath('complete-backups-light.png'), fullPage: true })
  await section.getByRole('button', { name: '预览与恢复', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('搜索备份中的标题或正文').fill('FSRS')
  await dialog.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(dialog.locator('.recovery-hits li').first()).toBeVisible()
  await settle(page)
  await dialog.screenshot({ path: info.outputPath('complete-backup-preview.png') })
  await dialog.getByRole('checkbox').first().check()
  await dialog.getByRole('button', { name: '恢复所选文件副本', exact: true }).click()
  await expect(
    dialog.getByText('所选内容已恢复为文件副本，可重新导入；当前学习库保持不变。', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '恢复为新工作目录', exact: true }).click()
  await expect(
    dialog.getByText('已恢复到新工作目录，当前学习库保持不变。', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '打开恢复的工作目录', exact: true }).click()
  await expect(page.locator('.b-focus-card h2')).toContainText('FSRS')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择备份目录', exact: true })).toBeVisible()
  await page.locator('.recovery-maintenance summary').click()
  await page.getByRole('button', { name: '检查数据库', exact: true }).click()
  await expect(page.getByText(/ok · 数据库/)).toBeVisible()
})

test('backup policy persists and recovery controls remain usable in dark and narrow layouts', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '选择备份目录', exact: true }).click()
  const policy = page.locator('.recovery-policy')
  await policy.locator('summary').click()
  await policy.getByRole('switch').check()
  await policy.getByRole('button', { name: '保存规则', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(page.getByText('自动备份已开启', { exact: true })).toBeVisible()
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect(page.getByRole('button', { name: '打开完整备份', exact: true })).toBeEnabled()
  await page.mouse.move(700, 80)
  await settle(page)
  await page.screenshot({ path: info.outputPath('complete-backups-dark.png'), fullPage: true })
  await page.setViewportSize({ width: 620, height: 900 })
  await page.locator('html').evaluate((element) => (element.style.fontSize = '200%'))
  await page.locator('.recovery-section').scrollIntoViewIfNeeded()
  await settle(page)
  await page.screenshot({
    path: info.outputPath('complete-backups-narrow-200.png'),
    fullPage: true,
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('restores a complete backup when there is no open workspace', async ({ page }) => {
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '选择备份目录', exact: true }).click()
  await page.getByRole('button', { name: '立即备份', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览与恢复', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await page.getByRole('button', { name: '关闭目录', exact: true }).click()
  await page.getByRole('button', { name: '打开完整备份', exact: true }).click()
  const preview = page.getByRole('dialog')
  await expect(preview.getByText(/校验通过/)).toBeVisible()
  await preview.getByRole('button', { name: '恢复为新工作目录', exact: true }).click()
  await preview.getByRole('button', { name: '打开恢复的工作目录', exact: true }).click()
  await expect(page.getByRole('button', { name: '学习概览', exact: true })).toBeVisible()
})
