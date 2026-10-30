import { test, expect } from './fixture'
import { fixture } from '../../src/core/test-fixtures'
import { localLibrary } from '../fixtures/source-excerpt-flow'
import { openSettings, selectUiValue } from '../fixtures/settings-flow'
import {
  openCollection,
  fillCollectionText,
  previewCollection,
  commitCollection,
} from '../fixtures/collection-controls'

test.use({ timezoneId: 'Asia/Shanghai' })
test('study settings, inherited priorities and explicit new-card balancing use persisted undoable commands', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const nav = (name: string) => page.locator('.main-nav').getByRole('button', { name, exact: true })
  async function capture(name: string) {
    while (await page.getByRole('button', { name: '关闭提示', exact: true }).count()) {
      await page.getByRole('button', { name: '关闭提示', exact: true }).first().click()
    }
    for (const [width, scale, theme] of [
      [1440, 1, 'light'],
      [500, 1, 'dark'],
      [1440, 2, 'dark'],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: theme })
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`
      }, scale)
      await page.locator('.main-content').evaluate((element) => {
        element.scrollTop = 0
      })
      expect(
        await page
          .locator('.main-content')
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true)
      await page.screenshot({
        path: info.outputPath(`${name}-${theme}-${width}-${scale}.png`),
        fullPage: true,
      })
      const primary = page.getByRole('button', {
        name: name === 'study-settings' ? '保存学习设置' : '确认应用安排',
        exact: true,
      })
      await primary.scrollIntoViewIfNeeded()
      await expect(primary).toBeInViewport()
      await page.screenshot({
        path: info.outputPath(`${name}-actions-${theme}-${width}-${scale}.png`),
        fullPage: true,
      })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '100%'
    })
  }
  const library = fixture({ front: '待安排的新卡', back: '只有明确确认后才改变首次学习日期。' })
  await nav('数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'study-controls.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await openSettings(page, 'study.review')
  await page.getByRole('spinbutton', { name: '学习日开始时间', exact: true }).fill('4')
  await page.getByRole('spinbutton', { name: '最大复习间隔', exact: true }).fill('500')
  await page.getByRole('button', { name: '保存学习设置', exact: true }).click()
  await expect
    .poll(async () => (await localLibrary(page)).studySettings[0])
    .toMatchObject({ dayStartHour: 4, maxIntervalDays: 500 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '学习日开始时间', exact: true })).toHaveValue(
    '0',
  )
  await openSettings(page, 'study.queue')
  await selectUiValue(
    page,
    page.getByRole('combobox', { name: '优先级安排方式', exact: true }),
    'weighted',
  )
  await page.getByRole('spinbutton', { name: '每轮卡片数', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: '每轮阅读数', exact: true }).fill('2')
  await page.getByRole('button', { name: '保存学习设置', exact: true }).click()
  await expect
    .poll(async () => (await localLibrary(page)).studySettings[0])
    .toMatchObject({ priorityMode: 'weighted', cardsPerReading: 2, readingsPerCycle: 2 })
  await capture('study-settings')
  await openSettings(page, 'study.reading')
  await selectUiValue(
    page,
    page.getByRole('combobox', { name: '阅读间隔模式', exact: true }),
    'configured',
  )
  await page.getByRole('spinbutton', { name: '初始阅读间隔', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: '最小增长倍数', exact: true }).fill('1.5')
  await page.getByRole('spinbutton', { name: '最大增长倍数', exact: true }).fill('2.5')
  await page.getByRole('spinbutton', { name: '最大阅读间隔', exact: true }).fill('30')
  await page.getByRole('button', { name: '保存学习设置', exact: true }).click()
  await expect
    .poll(async () => (await localLibrary(page)).studySettings[0])
    .toMatchObject({
      readingMode: 'configured',
      readingInitialDays: 2,
      readingGrowthMin: 1.5,
      readingGrowthMax: 2.5,
      readingMaxDays: 30,
    })

  await nav('全部卡片').click()
  await page.getByRole('checkbox', { name: '选择本页卡片', exact: true }).check()
  await page.getByRole('button', { name: '均衡安排新卡', exact: true }).click()
  const balance = page.getByRole('dialog', { name: '均衡安排新卡', exact: true })
  await balance.getByRole('spinbutton', { name: '安排窗口', exact: true }).fill('3')
  await balance.getByRole('button', { name: '预览安排', exact: true }).click()
  await expect(balance.locator('tbody tr')).toHaveCount(3)
  expect((await localLibrary(page)).cards[0]!.schedule.due).toBe(library.cards[0]!.schedule.due)
  await capture('new-card-balance-preview')
  await balance.getByRole('button', { name: '确认应用安排', exact: true }).click()
  await expect(balance).toHaveCount(0)
  await expect
    .poll(async () => (await localLibrary(page)).cards[0]!.schedule.due)
    .not.toBe(library.cards[0]!.schedule.due)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect
    .poll(async () => (await localLibrary(page)).cards[0]!.schedule.due)
    .toBe(library.cards[0]!.schedule.due)

  await page.getByRole('button', { name: '编辑卡片 待安排的新卡', exact: true }).click()
  const note = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await selectUiValue(page, note.locator('#note-study-priority'), '0')
  await note.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(note).toHaveCount(0)
  await expect.poll(async () => (await localLibrary(page)).notes[0]!.studyPriority).toBe(0)
  await page.getByRole('button', { name: '编辑卡片 待安排的新卡', exact: true }).click()
  await selectUiValue(page, note.locator('#note-study-priority'), 'inherit')
  await note.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(note).toHaveCount(0)
  await expect.poll(async () => (await localLibrary(page)).notes[0]!.studyPriority).toBeUndefined()

  await selectUiValue(
    page,
    page.getByRole('combobox', { name: '筛选卡组', exact: true }),
    library.decks[0]!.id,
  )
  await page.getByRole('button', { name: '编辑当前卡组', exact: true }).click()
  const deck = page.getByRole('dialog', { name: '编辑卡组', exact: true })
  await selectUiValue(page, deck.locator('#deck-study-priority'), '2')
  await deck.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(deck).toHaveCount(0)
  await expect.poll(async () => (await localLibrary(page)).decks[0]!.studyPriority).toBe(2)
  await page.getByRole('button', { name: '编辑卡片 待安排的新卡', exact: true }).click()
  await expect(note.locator('#note-study-priority')).toContainText('继承上级 · 2')
  await expect(note).toContainText(`继承来源：${library.decks[0]!.name}。`)
  await note.getByRole('button', { name: '取消', exact: true }).click()
  await expect(note).toHaveCount(0)

  await nav('学习材料').click()
  const collection = await openCollection(page, 'library')
  await fillCollectionText(collection, {
    title: '优先级材料',
    text: '在实际材料上验证统一优先级控件。',
  })
  await previewCollection(collection)
  await commitCollection(collection)
  await selectUiValue(page, page.locator('#source-study-priority'), '0')
  await expect.poll(async () => (await localLibrary(page)).sources[0]!.studyPriority).toBe(0)
  await selectUiValue(page, page.locator('#source-study-priority'), 'inherit')
  await expect
    .poll(async () => (await localLibrary(page)).sources[0]!.studyPriority)
    .toBeUndefined()
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page.getByRole('button', { name: '新建文件夹', exact: true }).first().click()
  const folder = page.getByRole('dialog', { name: '新建文件夹', exact: true })
  await folder.getByRole('textbox', { name: '文件夹名称', exact: true }).fill('优先级文件夹')
  await folder.getByRole('button', { name: '确认', exact: true }).click()
  await expect(folder).toHaveCount(0)
  const row = page
    .locator('.material-tree li')
    .filter({ has: page.getByRole('button', { name: '优先级文件夹', exact: true }) })
  await row.locator('summary').click()
  await row.getByRole('button', { name: '学习优先级', exact: true }).click()
  const priority = page.getByRole('dialog', { name: '学习优先级', exact: true })
  await selectUiValue(page, priority.locator('#folder-study-priority'), '3')
  await priority.getByRole('button', { name: '确认', exact: true }).click()
  await expect(priority).toHaveCount(0)
  await expect
    .poll(async () => (await localLibrary(page)).materialFolders[0]!.studyPriority)
    .toBe(3)
  await page.reload()
  await nav('学习材料').click()
  expect((await localLibrary(page)).materialFolders[0]!.studyPriority).toBe(3)
})
