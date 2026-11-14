import {
  openCollection,
  fillCollectionText,
  previewCollection,
  commitCollection,
} from '../fixtures/collection-controls'
import { showSourceText } from '../fixtures/source-controls'
import type { Locator } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixture'
import {
  openPluginManager,
  openPluginSettings,
  openSettings,
  selectPlugin,
} from '../fixtures/settings-flow'
import { createSourceDeck } from '../fixtures/source-flow'
import { openSourceDetails } from '../fixtures/source-details-flow'
import { selectUiValue } from '../fixtures/ui-flow'

// These tests use isolated Rust-backed libraries and the desktop IPC fixture.
// They verify rendered webview surfaces, not native OS window behavior.
async function appearance(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    type Rgba = [number, number, number, number]
    function rgba(color: string): Rgba {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const values = context.getImageData(0, 0, 1, 1).data
      return [values[0]!, values[1]!, values[2]!, values[3]! / 255]
    }
    function over(foreground: Rgba, background: Rgba): Rgba {
      return [
        foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
        foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
        foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
        1,
      ]
    }
    function luminance(color: Rgba) {
      const linear = color.slice(0, 3).map((value) => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
    }
    const ancestors: Element[] = []
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement)
      ancestors.unshift(ancestor)
    const background = ancestors.reduce<Rgba>(
      (color, ancestor) => over(rgba(getComputedStyle(ancestor).backgroundColor), color),
      [255, 255, 255, 1],
    )
    const style = getComputedStyle(element)
    const foreground = rgba(style.color)
    foreground[3] *= Number(style.opacity)
    const dark = luminance(background)
    const light = luminance(over(foreground, background))
    return {
      backgroundLuminance: dark,
      contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
    }
  })
}

async function darkSurface(locator: Locator) {
  await expect(locator).toBeVisible()
  await expect
    .poll(async () => (await appearance(locator)).backgroundLuminance, {
      message: 'Application surface must remain dark, including nested and portalled panels',
    })
    .toBeLessThan(0.15)
}

async function readable(locator: Locator) {
  await expect(locator).toBeVisible()
  await expect
    .poll(async () => (await appearance(locator)).contrast, {
      message: 'Visible control or content text must meet 4.5:1 contrast',
    })
    .toBeGreaterThanOrEqual(4.5)
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
})

test('system dark covers workspace, settings and independent official plugin surfaces', async ({
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
    join(directory, 'notes/深色检查.md'),
    '# 工作目录里的学习笔记\n\n这份文件只存在于本测试的临时学习库。\n',
  )
  await page.getByRole('button', { name: '工作目录', exact: true }).click()
  await expect(page.locator('.workspace-manager')).toHaveAttribute('aria-busy', 'false')
  await page.locator('.workspace-file').filter({ hasText: 'notes/深色检查.md' }).click()
  await darkSurface(page.locator('.workspace-active'))
  await darkSurface(page.locator('.workspace-document'))
  await readable(page.locator('.workspace-path'))
  await readable(page.getByRole('button', { name: '接受修改', exact: true }))
  await page.screenshot({ path: info.outputPath('dark-workspace.png'), animations: 'disabled' })

  await openSettings(page, 'general.appearance')
  const theme = page.getByRole('combobox', { name: '颜色模式', exact: true })
  await expect(theme).toContainText('跟随系统')
  await darkSurface(page.locator('.settings-panel'))
  await readable(page.locator('.settings-panel-heading h2'))
  await readable(theme.locator('[data-slot="value"]'))
  await theme.click()
  await darkSurface(page.getByRole('listbox'))
  await readable(page.getByRole('option', { name: '深色', exact: true }))
  await page.keyboard.press('Escape')
  await page.screenshot({ path: info.outputPath('dark-settings.png'), animations: 'disabled' })

  await openPluginManager(page)
  await selectPlugin(page, 'leetcode')
  const details = page.locator('.plugin-settings[data-plugin-id="leetcode"]')
  await darkSurface(details)
  await darkSurface(details.locator('.plugin-readme'))
  await readable(details.locator('.plugin-readme p').first())
  await readable(details.getByRole('button', { name: '配置插件', exact: true }))
  await page.screenshot({ path: info.outputPath('dark-plugin-readme.png'), animations: 'disabled' })

  await openPluginSettings(page, 'review-history')
  const history = page.locator('.settings-configuration[data-plugin-id="review-history"]')
  await darkSurface(history)
  const length = history.getByRole('spinbutton', { name: '显示条数', exact: true })
  await darkSurface(length)
  await readable(length)
  await readable(history.getByRole('heading', { level: 2 }))
  await page.screenshot({
    path: info.outputPath('dark-plugin-history.png'),
    animations: 'disabled',
  })

  await openPluginSettings(page, 'leetcode')
  const leetcode = page.locator('.settings-configuration[data-plugin-id="leetcode"]')
  const china = leetcode.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  await darkSurface(china)
  await darkSurface(china.getByLabel('LEETCODE_SESSION', { exact: true }))
  await readable(china.getByLabel('LEETCODE_SESSION', { exact: true }))
  await readable(china.getByRole('heading', { level: 3 }))
  await page.screenshot({
    path: info.outputPath('dark-plugin-leetcode.png'),
    animations: 'disabled',
  })
})

test('system dark covers source importing, reading and editing dialogs', async ({ page }, info) => {
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  const importing = await openCollection(page)
  await fillCollectionText(importing, {
    title: '深色模式学习材料',
    format: 'markdown',
    text: '# 阅读材料\n\n保留清晰的文字与层级。\n\n```js\nconst answer = "可读代码"\n```',
  })
  await darkSurface(importing.locator('.modal-content'))
  await darkSurface(importing.locator('.collection-footer'))
  await darkSurface(importing.getByRole('textbox', { name: '正文', exact: true }))
  await readable(importing.getByLabel('标题（可选）', { exact: true }))
  await readable(importing.getByRole('textbox', { name: '正文', exact: true }))
  await readable(importing.getByRole('button', { name: '预览材料', exact: true }))
  await page.screenshot({ path: info.outputPath('dark-source-import.png'), animations: 'disabled' })
  await previewCollection(importing)
  await commitCollection(importing)
  await showSourceText(page)
  const reader = page.getByRole('textbox', { name: '材料正文', exact: true })
  await darkSurface(reader)
  await readable(reader)

  const editing = await openSourceDetails(page)
  await darkSurface(editing.locator('.modal-content'))
  await darkSurface(editing.getByLabel('材料标题', { exact: true }))
  await readable(editing.getByLabel('材料标题', { exact: true }))
  await readable(editing.getByRole('button', { name: '保存材料信息', exact: true }))
  await page.screenshot({ path: info.outputPath('dark-source-editor.png'), animations: 'disabled' })
  await editing.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Markdown 预览', exact: true }).click()
  await darkSurface(page.locator('.source-markdown-preview'))
  await readable(page.locator('.source-markdown-preview .hljs-string'))
  await page.screenshot({
    path: info.outputPath('dark-source-reading.png'),
    animations: 'disabled',
  })
})

test('system dark covers card editing and review without recoloring authored HTML or images', async ({
  page,
}, info) => {
  await createSourceDeck(page)
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  const adding = page.getByRole('dialog', { name: '添加卡片', exact: true })
  await selectUiValue(adding.getByLabel('内容格式', { exact: true }), 'markdown')
  await adding
    .getByLabel('正面 · 问题', { exact: true })
    .fill(
      '怎样保持深色界面清晰？\n\n' +
        '<div class="authored-white" style="background:#fff;color:#111;padding:12px">作者指定的白底内容</div>\n\n' +
        '<img alt="Original image" style="width:80px;height:40px" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=">',
    )
  await adding
    .getByLabel('背面 · 答案', { exact: true })
    .fill('使用语义颜色。\n\n```js\nconst theme = "dark"\n```')
  await darkSurface(adding.locator('.modal-content'))
  await darkSurface(adding.locator('.editor-actions'))
  await darkSurface(adding.getByLabel('正面 · 问题', { exact: true }))
  await readable(adding.getByLabel('正面 · 问题', { exact: true }))
  await readable(adding.getByRole('button', { name: '保存卡片', exact: true }))
  await page.screenshot({ path: info.outputPath('dark-card-create.png'), animations: 'disabled' })
  await adding.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(adding).toHaveCount(0)
  await page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
  await darkSurface(page.locator('.flashcard'))
  await readable(page.locator('.card-question p').first())
  const authored = page.locator('.flashcard .authored-white')
  await expect(authored).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(authored).toHaveCSS('color', 'rgb(17, 17, 17)')
  const image = page.getByRole('img', { name: 'Original image', exact: true })
  await expect(image).toBeVisible()
  await expect
    .poll(() =>
      image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true)
  expect(
    await image.evaluate((element) => {
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement)
        if (getComputedStyle(ancestor).filter !== 'none') return false
      return true
    }),
  ).toBe(true)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await darkSurface(page.locator('.card-answer pre'))
  await readable(page.locator('.card-answer .hljs-string'))
  for (const tone of ['again', 'hard', 'good', 'easy']) {
    const rating = page.locator(`.grade-button.${tone}`)
    await darkSurface(rating)
    await readable(rating.locator('strong').first())
  }
  await page.screenshot({ path: info.outputPath('dark-review.png'), animations: 'disabled' })
  await page.locator('.review-menu').click()
  await page.getByRole('menuitem', { name: /^编辑/ }).click()
  const editing = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await darkSurface(editing.locator('.modal-content'))
  await darkSurface(editing.locator('.editor-actions'))
  await readable(editing.getByLabel('背面 · 答案', { exact: true }))
  await page.screenshot({ path: info.outputPath('dark-card-edit.png'), animations: 'disabled' })
  await editing.getByRole('button', { name: '取消', exact: true }).click()
  await expect(editing).toHaveCount(0)
})
