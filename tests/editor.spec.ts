import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'

for (const locale of ['zh-CN', 'en-US']) {
  const english = locale === 'en-US'
  test(`plugin download and card shortcut are discoverable in ${locale}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: english ? 390 : 1440, height: 900 })
    await page.addInitScript(
      (value) => localStorage.setItem('repeaty.locale', value),
      english ? 'en' : 'zh-CN',
    )
    await page.goto('./')
    await page.getByRole('button', { name: english ? 'Plugins' : '插件', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('plugins.png') })
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
    await page.screenshot({ path: testInfo.outputPath('leetcode-editor.png') })
    await expect(
      page
        .getByRole('dialog')
        .getByRole('link', { name: english ? 'Download browser extension' : '下载浏览器扩展' }),
    ).toBeVisible()
  })
}

for (const english of [false, true]) {
  for (const width of [390, 768, 1440]) {
    test(`card editor keeps actions visible with long text and attachments at ${width}px (${english ? 'en' : 'zh'})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(
        (value) => localStorage.setItem('repeaty.locale', value),
        english ? 'en' : 'zh-CN',
      )
      await page.goto('./')
      await page
        .getByRole('button', { name: english ? 'Create deck' : '创建卡组', exact: true })
        .last()
        .click()
      await page.getByLabel(english ? 'Deck name' : '卡组名称', { exact: true }).fill('Learning')
      await page
        .getByRole('button', { name: english ? 'Save deck' : '保存卡组', exact: true })
        .click()
      await page
        .getByRole('button', { name: english ? 'Add card' : '添加卡片', exact: true })
        .first()
        .click()
      const dialog = page.getByRole('dialog')
      const front = page.getByLabel(english ? 'Front · Question' : '正面 · 问题')
      const back = page.getByLabel(english ? 'Back · Answer' : '背面 · 答案')
      const frontBox = (await front.boundingBox())!
      const backBox = (await back.boundingBox())!
      if (width >= 768) {
        expect(Math.abs(frontBox.y - backBox.y)).toBeLessThan(2)
        expect(backBox.x).toBeGreaterThan(frontBox.x + frontBox.width)
      } else {
        expect(backBox.y).toBeGreaterThan(frontBox.y + frontBox.height)
      }
      if (width === 1440) expect((await dialog.boundingBox())!.width).toBeGreaterThan(950)
      await page.screenshot({ path: testInfo.outputPath('editor.png') })
      const longText = 'Spaced repetition · 长文本\n'.repeat(300)
      await front.fill(longText)
      await back.fill(longText)
      const fileChooser = page.waitForEvent('filechooser')
      await dialog
        .getByRole('button', {
          name: english ? 'Add image / audio' : '添加图片 / 音频',
          exact: true,
        })
        .first()
        .click()
      await (
        await fileChooser
      ).setFiles({
        name: `${'长文件名'.repeat(24)}.png`,
        mimeType: 'image/png',
        buffer: await readFile('public/icon-192.png'),
      })
      await expect(dialog.locator('.media-attachments img')).toHaveCount(1)
      await page
        .getByText(english ? 'Cards to generate: 1 · Preview' : '将生成 1 张卡片 · 预览', {
          exact: true,
        })
        .click()
      await expect(dialog.locator('.note-preview article')).toContainText('Spaced repetition')
      const footer = page.getByRole('button', {
        name: english ? 'Save card' : '保存卡片',
        exact: true,
      })
      await expect(footer).toBeInViewport({ ratio: 1 })
      await expect(
        page.getByRole('button', { name: english ? 'Close dialog' : '关闭弹窗' }),
      ).toBeInViewport({ ratio: 1 })
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(
        await page.locator('.editor-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('editor-with-media.png') })
      await footer.click()
      await expect(dialog).toHaveCount(0)
      await page.reload()
      await page
        .getByRole('button', { name: english ? 'Start review' : '开始复习', exact: true })
        .click()
      await expect(page.locator('.card-question')).toContainText('Spaced repetition')
      await expect(page.locator('.flashcard img')).toHaveCount(1)
    })
  }
}
