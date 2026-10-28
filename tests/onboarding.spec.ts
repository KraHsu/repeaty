import { setInterfaceLanguage } from './fixtures/settings-flow'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('a fresh workspace teaches FSRS with ordered cards, math, images and playable audio offline', async ({
  page,
  context,
}) => {
  await page.goto('./')
  await expect(page.locator('.deck-title')).toHaveText('从这里开始：FSRS 与 Repeaty')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(page.getByRole('heading', { name: '离线已就绪', exact: true })).toBeVisible()
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  let sawMath = false,
    sawImage = false,
    sawAudio = false,
    sawCloze = false,
    sawCode = false
  for (let index = 0; index < 24; index++) {
    const question = page.locator('.card-question')
    await expect(question).toBeVisible()
    const before = await question.innerText()
    if (index === 0) await expect(question).toContainText('看到问题后，翻面之前先做什么？')
    if (index === 1) await expect(question).toContainText('FSRS 在 Repeaty 中负责决定什么？')
    if (index === 8) {
      await page.getByRole('button', { name: '显示答案' }).click()
      await expect(page.locator('.card-answer .katex')).toBeVisible()
      sawMath = true
    } else {
      const image = page.locator('.flashcard img')
      if (await image.count()) {
        await image.scrollIntoViewIfNeeded()
        await expect(image).toHaveJSProperty('naturalWidth', 1120)
        sawImage = true
      }
      const audio = page.locator('.flashcard audio')
      if (await audio.count()) {
        await audio.evaluate(async (element: HTMLAudioElement) => {
          await element.play()
        })
        await expect
          .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
          .toBeGreaterThan(0)
        await expect
          .poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration))
          .toBeCloseTo(1.4)
        sawAudio = true
      }
      if ((await question.innerText()).includes('[…]')) sawCloze = true
      if (await question.locator('pre code').count()) sawCode = true
      await page.getByRole('button', { name: '显示答案' }).click()
    }
    await page.getByRole('button', { name: /良好/ }).click()
    if (index < 23) await expect(question).not.toHaveText(before)
  }
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  expect({ sawMath, sawImage, sawAudio, sawCloze, sawCode }).toEqual({
    sawMath: true,
    sawImage: true,
    sawAudio: true,
    sawCloze: true,
    sawCode: true,
  })
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧版 JSON', exact: true }).click()
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(backup.library.cards).toHaveLength(27)
  expect(backup.library.reviews).toHaveLength(24)
  expect(backup.assets).toHaveLength(2)
})

test('deleting the welcome deck persists; adding another language preserves existing progress', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: '浏览卡片', exact: true }).click()
  await page.getByRole('button', { name: '删除当前卡组' }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: '还没有卡组' })).toBeVisible()
  await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
  await expect(page.locator('.deck-title')).toHaveCount(1)
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Data & backups', exact: true }).click()
  await page.getByRole('button', { name: 'Add starter deck', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Starter deck added')
  await page.reload()
  await expect(page.locator('.deck-title')).toHaveText([
    '从这里开始：FSRS 与 Repeaty',
    'Start here: FSRS & Repeaty',
  ])
  await page.getByRole('button', { name: 'Data & backups', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export legacy JSON', exact: true }).click()
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(backup.library.reviews).toHaveLength(1)
  expect(backup.library.cards).toHaveLength(54)
  expect(backup.assets).toHaveLength(4)
})

test('the focused deck controls browsing, review and daily limits without changing other decks', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: '创建卡组', exact: true }).click()
  await page.getByLabel('卡组名称', { exact: true }).fill('专注卡组')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('正面 · 问题').fill('只复习当前选中的卡组')
  await page.getByLabel('背面 · 答案').fill('保留其他卡组的学习进度')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const home = page.locator('.main-nav').getByRole('button', { name: '学习概览', exact: true })
  await home.click()
  await expect(page.locator('.b-focus-card h2')).toHaveText('从这里开始：FSRS 与 Repeaty')
  // The review shortcut follows the same initial focus as the primary button.
  await page.keyboard.press('r')
  await expect(page.locator('.card-question')).toContainText('看到问题后，翻面之前先做什么？')
  await expect(page.locator('.review-header')).toContainText('当前待学 27 张')
  await page.getByRole('button', { name: '结束复习', exact: true }).click()
  await page.getByRole('button', { name: '选择卡组 专注卡组', exact: true }).click()
  await expect(page.locator('.b-focus-card h2')).toHaveText('专注卡组')
  await expect(page.locator('.b-focus-counts dd')).toHaveText(['0', '1'])
  await page.locator('.main-nav').getByRole('button', { name: '全部卡片', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(28)
  await home.click()
  await page.getByRole('button', { name: '选择卡组 专注卡组', exact: true }).click()
  await page.getByRole('button', { name: '浏览卡片', exact: true }).click()
  await expect(page.locator('.cards-page h1')).toHaveText('专注卡组')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('只复习当前选中的卡组')

  await home.click()
  await page.getByRole('button', { name: '选择卡组 专注卡组', exact: true }).click()
  await page.locator('.b-start-review').click()
  await expect(page.locator('.card-question')).toHaveText('只复习当前选中的卡组')
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.getByRole('button', { name: '撤销上次评分', exact: true }).click()
  await expect(page.locator('.card-question')).toHaveText('只复习当前选中的卡组')
  await page.getByRole('button', { name: '结束复习', exact: true }).click()
  await expect(page.locator('.b-focus-card h2')).toHaveText('专注卡组')

  await page.getByRole('button', { name: '编辑卡组 专注卡组', exact: true }).click()
  await page.getByLabel('每日新卡上限', { exact: true }).fill('0')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.locator('.b-focus-counts dd')).toHaveText(['0', '0'])
  await expect(page.locator('.b-focus-state')).toContainText('另有 1 张已达今日额度')
  await expect(page.locator('.b-start-review')).toHaveText('查看复习安排')
  await page.locator('.b-start-review').click()
  await expect(page.getByRole('heading', { name: '已达到今日上限' })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()

  await page.getByRole('button', { name: '浏览卡片', exact: true }).click()
  await page.getByRole('button', { name: '删除当前卡组', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await home.click()
  await expect(page.locator('.b-focus-card h2')).toHaveText('从这里开始：FSRS 与 Repeaty')
  await expect(page.locator('.b-focus-counts dd')).toHaveText(['0', '27'])
  await page.reload()
  await expect(page.locator('.b-deck-tile')).toHaveCount(1)
  await expect(page.locator('.b-focus-counts dd')).toHaveText(['0', '27'])
})
