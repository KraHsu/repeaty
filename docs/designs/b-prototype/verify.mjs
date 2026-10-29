import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.PROTOTYPE_URL || 'http://127.0.0.1:4194/'
const output = fileURLToPath(
  new URL('../../../test-results/oil-ui-b-green/verification', import.meta.url),
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (let run = 1; run <= 3; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}?view=cards`)
    const firstQuestion = '为什么主动回忆比反复阅读更有效？'
    const edited = `主动回忆的作用是什么？ · ${run}`
    await page.getByRole('button', { name: `编辑：${firstQuestion}`, exact: true }).click()
    await page.locator('#card-edit-question').fill(edited)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: edited, exact: true })).toBeVisible()

    await page.getByRole('button', { name: `编辑：${edited}`, exact: true }).click()
    await page.locator('#card-edit-question').fill(`${edited} 保留草稿`)
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'repeaty-design-b-v1')
          throw new DOMException('QuotaExceeded', 'QuotaExceededError')
        return window.originalSetItem.call(this, key, value)
      }
    })
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('#card-edit-question')).toHaveValue(`${edited} 保留草稿`)
    await expect(page.getByRole('dialog').getByText(/保存失败/)).toBeVisible()
    await page.evaluate(() => {
      Storage.prototype.setItem = window.originalSetItem
    })
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: `暂停：${edited} 保留草稿`, exact: true }).click()
    await expect(
      page.getByRole('button', { name: `恢复：${edited} 保留草稿`, exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: `恢复：${edited} 保留草稿`, exact: true }).click()
    await page.getByRole('button', { name: `删除：${edited} 保留草稿`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: `${edited} 保留草稿`, exact: true }),
    ).toBeVisible()
    await page.goto(`${base}?view=home`)
    await page.getByRole('button', { name: '复习此卡组', exact: true }).click()
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(page.locator('.answer-copy')).toBeVisible()
    if (run === 1) await page.screenshot({ path: path.join(output, 'review-answer.png') })
    await page.getByRole('button', { name: '编辑当前卡片', exact: true }).click()
    await page.locator('#review-edit-question').fill('编辑中按1不评分')
    await page.keyboard.press('1')
    await expect(page.locator('.review-counter')).toHaveText('0 / 3 已完成')
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.answer-copy')).toBeVisible()
    await page.keyboard.press('3')
    await expect(page.locator('.review-counter')).toHaveText('1 / 3 已完成')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '结束本轮复习？' })).toBeVisible()
    await page.getByRole('button', { name: '继续复习', exact: true }).click()
    await expect(page.locator('.review-counter')).toHaveText('1 / 3 已完成')
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await page.keyboard.press('3')
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await page.keyboard.press('4')
    await expect(page.getByRole('heading', { name: '本轮复习完成', exact: true })).toBeVisible()
    await page.locator('.completion-button').click()
    await expect(page.getByText('今日已复习 3 次', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '今日已完成', exact: true })).toBeDisabled()
    await page.reload()
    await expect(page.getByText('今日已复习 3 次', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '今日已完成', exact: true })).toBeDisabled()

    await page.goto(`${base}?view=settings&category=study.review`)
    const number = page.getByRole('spinbutton')
    await number.fill('20')
    await number.press('Tab')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('spinbutton')).toHaveValue('20')
    await page.getByRole('spinbutton').fill('21')
    await page.getByRole('spinbutton').press('Tab')
    await page.getByRole('button', { name: '卡组', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(page.getByRole('spinbutton')).toHaveValue('21')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '插件', exact: true }).click()
    await page.getByRole('switch', { name: '已启用', exact: true }).click()
    await page.getByRole('button', { name: '停用插件', exact: true }).click()
    await expect(page.getByRole('button', { name: '配置插件', exact: true })).toBeDisabled()
    await page.reload()
    await expect(page.getByRole('switch', { name: '已停用', exact: true })).not.toBeChecked()
    await page.getByRole('switch', { name: '已停用', exact: true }).click()
    await page.getByRole('button', { name: '配置插件', exact: true }).click()
    await expect(page.getByRole('spinbutton')).toHaveValue('21')

    await page.getByRole('button', { name: '数据与备份', exact: true }).click()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
    const download = await downloaded
    const downloadedPath = path.join(output, `roundtrip-${run}.json`)
    await download.saveAs(downloadedPath)
    const exported = JSON.parse(await readFile(downloadedPath, 'utf8'))
    expect(exported.data.reviewCount).toBe(3)
    expect(exported.data.cards.filter((card) => card.status === 'learned')).toHaveLength(3)
    await page.locator('input[type=file]').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    })
    await expect(page.getByText('请选择由此页面导出的 JSON 文件。', { exact: true })).toBeVisible()
    await page.locator('input[type=file]').setInputFiles(downloadedPath)
    await expect(page.getByRole('dialog', { name: '恢复文件中的数据？' })).toBeVisible()
    await page.getByRole('button', { name: '确认替换', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('repeaty-design-b-v1')).data.reviewCount,
      ),
    ).toBe(3)
    expect(errors).toEqual([])
    results.push({ run, passed: true })
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 500, height: 900 } })
  const page = await context.newPage()
  for (const view of ['home', 'cards', 'settings', 'plugins', 'backup', 'controls']) {
    await page.goto(`${base}?view=${view}`)
    await expect(page.locator('main')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      ),
    )
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth > innerWidth + 1,
      main:
        document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1,
    }))
    expect(overflow, view).toEqual({ document: false, main: false })
    await page.screenshot({ path: path.join(output, `${view}-500.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${base}?view=settings`)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await page.screenshot({ path: path.join(output, 'settings-200-percent.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
  expect(
    await page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth + 1),
  ).toBe(true)
  expect(
    await page
      .locator('.field-copy label')
      .first()
      .evaluate((label) => Number.parseFloat(getComputedStyle(label).fontSize)),
  ).toBe(32)
  await context.close()
  const report = { passed: results, narrowPages: 6, largeFont: true }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
