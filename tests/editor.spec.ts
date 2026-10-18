import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'

for (const locale of ['zh-CN', 'en-US']) {
  const english = locale === 'en-US'
  test(`plugin download and card shortcut are discoverable in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: english ? 390 : 1440, height: 900 })
    await page.addInitScript(
      (value) => localStorage.setItem('repeaty.locale', value),
      english ? 'en' : 'zh-CN',
    )
    await page.goto('./')
    await page.getByRole('button', { name: english ? 'Plugins' : '插件', exact: true }).click()
    const download = page.getByRole('link', {
      name: english ? 'Download browser extension' : '下载浏览器扩展',
    })
    await expect(download).toBeVisible()
    const received = page.waitForEvent('download')
    await download.click()
    const file = await received
    expect(file.suggestedFilename()).toBe('leetcode-connector.zip')
    const zip = new ZipReader(new Uint8ArrayReader(await readFile((await file.path())!)))
    try {
      const manifest = (await zip.getEntries()).find((entry) => entry.filename === 'manifest.json')!
      expect(manifest.directory).toBe(false)
      if (manifest.directory) throw new Error('Expected a manifest file')
      expect(JSON.parse(await manifest.getData!(new TextWriter())).manifest_version).toBe(3)
    } finally {
      await zip.close()
    }
    await page
      .getByText(english ? 'Installation instructions' : '安装说明', { exact: true })
      .click()
    await expect(page.getByText(/chrome:\/\/extensions/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: english ? 'Overview' : '学习概览', exact: true }).click()
    await page
      .getByRole('button', { name: english ? 'Create deck' : '创建卡组', exact: true })
      .last()
      .click()
    await page.getByLabel(english ? 'Deck name' : '卡组名称', { exact: true }).fill('Algorithms')
    await page
      .getByRole('button', { name: english ? 'Save deck' : '保存卡组', exact: true })
      .click()
    await page
      .getByRole('button', { name: english ? 'Add card' : '添加卡片', exact: true })
      .first()
      .click()
    await page
      .getByRole('button', { name: english ? 'Add LeetCode problem' : '添加 LeetCode 题目' })
      .click()
    await expect(page.getByLabel(english ? 'LeetCode site' : 'LeetCode 站点')).toHaveValue(
      'leetcode.cn',
    )
    await expect(
      page
        .getByRole('dialog')
        .getByRole('link', { name: english ? 'Download browser extension' : '下载浏览器扩展' }),
    ).toBeVisible()
  })
}
