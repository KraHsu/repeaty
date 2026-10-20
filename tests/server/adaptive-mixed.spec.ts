import { test, expect, headers } from './fixture'
import {
  adaptiveFlow,
  mixedFlow,
  seedMixedCards,
  startMixed,
  adaptiveDialog,
} from '../fixtures/adaptive-mixed-flow'
import { importReading, readingText } from '../fixtures/reading-flow'
test('account adaptive reading persists feedback, undo and backups in SQLite', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await adaptiveFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})
test('leaving mixed study during a durable save cannot revive its old session', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await seedMixedCards(page)
  await importReading(page, 'Late mixed save', 'plain', readingText)
  await startMixed(page)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: /^简单/ }).click()
  const dialog = await adaptiveDialog(page)
  let release!: () => void, persisted!: () => void
  const paused = new Promise<void>((resolve) => {
    release = resolve
  })
  const saved = new Promise<void>((resolve) => {
    persisted = resolve
  })
  await page.route(
    '**/api/library/commit',
    async (route) => {
      const response = await route.fetch()
      persisted()
      await paused
      await route.fulfill({ response })
    },
    { times: 1 },
  )
  await dialog.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await saved
  // A modal blocks pointer navigation. Trigger the same app transition directly to
  // exercise a stale response after its owning component has been disposed.
  await page
    .getByRole('button', { name: '学习概览', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
  release()
  await expect(page.locator('.mixed-session')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '学习概览', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始混合学习', exact: true })).toBeEnabled()
  const library = (await (await request.get('api/library', { headers })).json()).library
  expect(library.sources[0].adaptiveReading.readCount).toBe(1)
  await page.reload()
  await expect(page.locator('.mixed-session')).toHaveCount(0)
})
test('account mixed study retains card and material changes in SQLite', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await mixedFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})
