import type { Page } from '@playwright/test'
import { test, expect } from './fixture'
import { fixture, input, now } from '../../src/core/test-fixtures'
import { cardViews, librarySchema, saveNote } from '../../src/core/model'
import { practiceHistoryFixture } from '../fixtures/practice-history'

function reviewLayoutFixture() {
  let library = fixture({ front: '短题面', back: '简短答案' })
  const longName = '这是一个很长的卡组名称，用来验证不同卡片之间的复习顶栏保持稳定'
    .repeat(3)
    .slice(0, 80)
  library.decks.push({ ...library.decks[0]!, id: 'long-deck', name: longName })
  const pluginNote = practiceHistoryFixture(0).notes[0]!
  const cards = [
    {
      ...input,
      deckId: 'long-deck',
      front: '长题面\n\n' + '长内容段落。\n\n'.repeat(65),
      back: '长题答案',
    },
    { ...pluginNote, front: '插件宽卡' },
    { ...input, deckId: 'long-deck', front: '带历史的短题面', back: '历史卡答案' },
  ]
  for (const [index, note] of cards.entries())
    library = saveNote(
      library,
      note,
      undefined,
      false,
      new Date(now.getTime() + (index + 1) * 1000),
    )
  const historyCard = cardViews(library).find((card) => card.front === '带历史的短题面')!
  library.reviews = Array.from({ length: 12 }, (_, index) => ({
    id: `layout-review-${index}`,
    cardId: historyCard.id,
    rating: 3 as const,
    reviewedAt: new Date(now.getTime() - (13 - index) * 86_400_000).toISOString(),
    nextDue: now.toISOString(),
    studyDay: '2026-10-01',
    kind: 'review' as const,
    source: 'normal' as const,
  }))
  return librarySchema.parse(library)
}

const anchors = [
  '.review-header',
  '.review-header > button',
  '.b-review-progress',
  '.review-tools',
  '.review-menu',
  '.review-context',
] as const

async function geometry(page: Page) {
  // Compare the same logical scroll position. Long cards still scroll normally;
  // fixing the whole review content to the viewport is deliberately not required.
  await page.locator('.main-content').evaluate((element) => {
    element.scrollTop = 0
  })
  return page.evaluate(
    (selectors) =>
      Object.fromEntries(
        selectors.map((selector) => {
          const bounds = document.querySelector(selector)!.getBoundingClientRect()
          return [selector, { x: bounds.x, y: bounds.y, width: bounds.width }]
        }),
      ),
    anchors,
  )
}

for (const width of [1440, 500]) {
  test(`review controls stay anchored across short, long, plugin and history cards at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1400 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '数据与备份', exact: true }).click()
    await page.getByLabel('导入备份文件').setInputFiles({
      name: 'review-layout.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(reviewLayoutFixture())),
    })
    await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const notice = page.getByRole('button', { name: '关闭提示', exact: true })
    if (await notice.isVisible()) await notice.click()
    await page.getByRole('button', { name: '全部卡片', exact: true }).click()
    await page.getByRole('button', { name: '复习', exact: true }).click()
    await expect(page.locator('.flashcard')).toContainText('短题面')
    const initial = await geometry(page)
    const stable = async () => {
      const current = await geometry(page)
      for (const selector of anchors) {
        expect(
          Math.abs(current[selector]!.x - initial[selector]!.x),
          `${selector} x`,
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(current[selector]!.y - initial[selector]!.y),
          `${selector} y`,
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(current[selector]!.width - initial[selector]!.width),
          `${selector} width`,
        ).toBeLessThanOrEqual(1)
      }
    }
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(page.locator('.review-history-dots .history-dot')).toHaveCount(1)
    await stable()
    await page.screenshot({ path: info.outputPath(`review-short-${width}.png`) })
    await page.getByRole('button', { name: '今天暂缓', exact: true }).click()
    await expect(page.locator('.flashcard')).toContainText('长题面')
    await stable()
    await expect(page.locator('.b-review-deck')).toHaveAttribute('title', /这是一个很长的卡组名称/)
    const context = await page.locator('.review-context').boundingBox()
    const status = await page.locator('.review-context > span:last-child').boundingBox()
    expect(status!.y + status!.height).toBeLessThanOrEqual(context!.y + 40)
    await page.screenshot({ path: info.outputPath(`review-long-${width}.png`) })
    await page.getByRole('button', { name: '今天暂缓', exact: true }).click()
    await expect(page.locator('.flashcard')).toHaveClass(/plugin-card/)
    await expect(page.getByLabel('代码', { exact: true })).toBeVisible()
    await stable()
    await page.screenshot({ path: info.outputPath(`review-plugin-${width}.png`) })
    await page.getByRole('button', { name: '今天暂缓', exact: true }).click()
    await expect(page.locator('.flashcard')).toContainText('带历史的短题面')
    await stable()
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(page.locator('.review-history-dots .history-dot')).toHaveCount(11)
    await stable()
    await page.screenshot({ path: info.outputPath(`review-history-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
