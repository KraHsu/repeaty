import { expect, type Page, type TestInfo } from '@playwright/test'
import { createEmptyCard, default_w, fsrs, State } from 'ts-fsrs'
import { fixture } from '../../src/core/test-fixtures'
import { emptyLibrary, serializeSchedule, type Library } from '../../src/core/model'
import { previewReview } from '../../src/core/scheduler'
import { storedLibrary } from './stored-library'
import { confirmPluginAction, openPluginManager, selectPlugin } from './settings-flow'

const pluginId = 'fsrs-optimizer'
const nav = (page: Page, title: string) =>
  page.locator('.main-nav').getByRole('button', { name: title, exact: true })
const panel = (page: Page) => page.locator('.optimizer-page')
const details = (page: Page) => page.locator(`.plugin-settings[data-plugin-id="${pluginId}"]`)

/** Complete recorded pre-rating states; no mocked optimizer or host evaluation. */
export function optimizerHistoryLibrary() {
  const library = fixture({ front: '个人参数验证卡片', back: '真实评分使用宿主验证后的参数。' })
  const note = library.notes[0]!,
    card = library.cards[0]!
  library.notes = []
  library.cards = []
  library.reviews = []
  const scheduler = fsrs({ enable_fuzz: false })
  for (let index = 0; index < 160; index++) {
    const id = `card-${index}`,
      noteId = `note-${index}`
    let schedule = createEmptyCard(new Date('2025-01-01T12:00:00Z'))
    library.notes.push({ ...note, id: noteId, front: `${note.front} ${index}` })
    for (let step = 0; step < 9; step++) {
      const time = new Date(Date.UTC(2025, 0, 1 + step * 7, 12))
      const rating = (index + step) % 7 === 0 ? 1 : (index + step) % 11 === 0 ? 2 : 3
      const result = scheduler.next(schedule, time, rating)
      library.reviews.push({
        id: `review-${index}-${step}`,
        cardId: id,
        rating,
        reviewedAt: time.toISOString(),
        nextDue: result.card.due.toISOString(),
        studyDay: time.toISOString().slice(0, 10),
        kind:
          schedule.state === State.New
            ? 'new'
            : schedule.state === State.Review
              ? 'review'
              : 'learning',
        source: 'normal',
        previous: { schedule: serializeSchedule(schedule), updatedAt: time.toISOString() },
      })
      schedule = result.card
    }
    library.cards.push({ ...card, id, noteId, schedule: serializeSchedule(schedule) })
  }
  return library
}

async function readLibrary(page: Page): Promise<Library> {
  const rows = (await storedLibrary(page)) as Record<string, { value: unknown }[]>
  return {
    ...emptyLibrary(),
    ...Object.fromEntries(
      Object.entries(rows).map(([key, entries]) => [key, entries.map((entry) => entry.value)]),
    ),
  } as Library
}
async function install(page: Page) {
  await openPluginManager(page)
  await page.getByRole('button', { name: '安装或更新官方插件', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '安装或更新官方插件', exact: true })
  await picker
    .locator(`[data-official-plugin="${pluginId}"]`)
    .getByRole('button', { name: '安装并启用', exact: true })
    .click()
  await expect(picker).toHaveCount(0)
  await expect(
    details(page).getByRole('switch', { name: '启用 个人 FSRS 参数', exact: true }),
  ).toBeChecked()
}
async function open(page: Page) {
  await nav(page, '个人 FSRS 参数').click()
  await expect(panel(page).locator('.optimizer-current')).toBeVisible()
}

export async function fsrsOptimizerFlow(page: Page, info: TestInfo, workspaceSwitch = true) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const library = optimizerHistoryLibrary()
  await nav(page, '数据与备份').click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'fsrs-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (const close of await page.getByRole('button', { name: '关闭提示', exact: true }).all())
    await close.click()
  await expect.poll(async () => (await readLibrary(page)).reviews.length).toBe(1440)
  await install(page)
  await open(page)
  await expect(panel(page).locator('.optimizer-count')).toContainText('1,440')
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  const beforeTraining = await readLibrary(page)
  await panel(page).getByRole('button', { name: '开始训练', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '采用参数', exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const trained = await readLibrary(page),
    model = trained.fsrsModels[0]!
  expect(trained.fsrsModels).toHaveLength(1)
  expect(model.modelVersion).toBe('FSRS-6')
  expect(model.weights).toHaveLength(21)
  expect(model.weights).not.toEqual(default_w)
  expect(model.metrics.candidate.logLoss).toBeLessThan(model.metrics.baseline.logLoss)
  expect(model.metrics.candidate.rmse).toBeLessThan(model.metrics.baseline.rmse)
  expect(model.counts).toMatchObject({ reviews: 1440, training: 960, validation: 320, excluded: 0 })
  expect(trained.cards).toEqual(beforeTraining.cards)
  expect(trained.reviews).toEqual(beforeTraining.reviews)
  expect(trained.studySettings[0]?.activeFsrsModelId).toBeUndefined()

  for (const [width, scale, theme] of [
    [1440, 1, 'light'],
    [500, 1, 'dark'],
    [1440, 2, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 1100 })
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = `${scale * 100}%`
    }, scale)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    await page.screenshot({
      path: info.outputPath(`optimizer-${theme}-${width}-${scale}.png`),
      fullPage: true,
    })
    await panel(page)
      .locator('.optimizer-results')
      .screenshot({
        path: info.outputPath(`optimizer-results-${theme}-${width}-${scale}.png`),
      })
    await page.locator('.main-content').evaluate((element) => {
      element.scrollTop = 0
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await panel(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%'
  })
  await panel(page).getByRole('button', { name: '采用参数', exact: true }).click()
  await expect(
    panel(page).getByRole('button', { name: '恢复上一套参数', exact: true }),
  ).toBeVisible()
  const adopted = await readLibrary(page)
  expect(adopted.studySettings[0]?.activeFsrsModelId).toBe(model.id)
  expect(adopted.cards).toEqual(beforeTraining.cards)
  expect(adopted.reviews).toEqual(beforeTraining.reviews)
  await page.reload()
  await open(page)
  await expect(
    panel(page).getByRole('button', { name: '恢复上一套参数', exact: true }),
  ).toBeVisible()
  expect((await readLibrary(page)).studySettings[0]?.activeFsrsModelId).toBe(model.id)

  await nav(page, '学习概览').click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.locator('.grade-button.good').click()
  await expect.poll(async () => (await readLibrary(page)).reviews.length).toBe(1441)
  const rated = await readLibrary(page),
    review = rated.reviews.find((entry) => !adopted.reviews.some((old) => old.id === entry.id))!
  const oldCard = adopted.cards.find((card) => card.id === review.cardId)!
  const expected = previewReview(oldCard, new Date(review.reviewedAt), adopted.decks[0], adopted)[3]
    .card
  expect(rated.cards.find((card) => card.id === review.cardId)!.schedule).toEqual(
    serializeSchedule(expected),
  )
  const defaultResult = previewReview(oldCard, new Date(review.reviewedAt), adopted.decks[0])[3]
    .card
  expect(expected.stability).not.toBe(defaultResult.stability)

  await open(page)
  await panel(page).getByRole('button', { name: '恢复上一套参数', exact: true }).click()
  await expect(
    panel(page).getByRole('button', { name: '恢复上一套参数', exact: true }),
  ).toHaveCount(0)
  const restored = await readLibrary(page)
  expect(restored.studySettings[0]?.activeFsrsModelId).toBeUndefined()
  expect(restored.cards).toEqual(rated.cards)
  expect(restored.reviews).toEqual(rated.reviews)
  // The intervening grade makes the older candidate stale; it cannot silently replace parameters.
  await panel(page).getByRole('button', { name: '采用参数', exact: true }).click()
  await expect(panel(page).getByRole('alert')).toContainText('复习记录或当前参数已变化')
  expect((await readLibrary(page)).studySettings[0]?.activeFsrsModelId).toBeUndefined()

  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  const enabled = details(page).getByRole('switch', { name: '启用 个人 FSRS 参数', exact: true })
  await enabled.click()
  await expect(nav(page, '个人 FSRS 参数')).toHaveCount(0)
  await enabled.click()
  await open(page)
  await expect(panel(page).locator('tbody tr')).toHaveCount(1)
  await openPluginManager(page)
  await selectPlugin(page, pluginId)
  await details(page).getByRole('button', { name: '卸载插件', exact: true }).click()
  await confirmPluginAction(page)
  await expect(nav(page, '个人 FSRS 参数')).toHaveCount(0)
  expect((await readLibrary(page)).fsrsModels).toHaveLength(1)
  await install(page)
  await open(page)
  await expect(panel(page).locator('tbody tr')).toHaveCount(1)

  if (!workspaceSwitch) {
    expect(errors).toEqual([])
    return
  }
  await nav(page, '工作目录').click()
  const originalPath = await page.locator('.workspace-active .workspace-path').textContent()
  await page.getByRole('button', { name: '创建学习库', exact: true }).click()
  await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
  await expect(nav(page, '个人 FSRS 参数')).toHaveCount(0)
  await install(page)
  await open(page)
  await expect(panel(page).getByRole('button', { name: '开始训练', exact: true })).toBeDisabled()
  await expect(panel(page).locator('tbody tr')).toHaveCount(0)
  await nav(page, '工作目录').click()
  await page.locator('.workspace-recent-entry').filter({ hasText: originalPath! }).click()
  await expect(page.locator('.app-page-header h1')).toHaveText('学习概览')
  await open(page)
  await expect(panel(page).locator('tbody tr')).toHaveCount(1)
  expect(errors).toEqual([])
}
