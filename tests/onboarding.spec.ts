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
  await page.locator('.deck-title').click()
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
