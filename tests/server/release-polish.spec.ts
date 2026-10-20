import { test, expect, headers } from './fixture'
import { reviewPolishFlow, skillSettingsFlow, seedPolish } from '../fixtures/polish-flow'
test('account review editing and history persist without changing prior ratings', async ({
  page,
  request,
}, info) => {
  await reviewPolishFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})

test('a failed account grade retries once and a slow snapshot list cannot delay the next question', async ({
  page,
  request,
}) => {
  await seedPolish(page)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.locator('.deck-review').click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.route(
    '**/api/library/commit',
    (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }),
    { times: 1 },
  )
  await page.locator('.grade-button.good').click()
  await expect(page.locator('.notification.error')).toBeVisible()
  await expect(page.locator('.card-answer')).toBeVisible()
  expect(
    (await (await request.get('api/library', { headers })).json()).library.reviews,
  ).toHaveLength(0)
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/backups', async (route) => {
    const response = await route.fetch()
    await wait
    await route.fulfill({ response })
  })
  try {
    await page.locator('.grade-button.good').click()
    await expect(page.locator('.flashcard')).toHaveCount(0)
    expect(
      (await (await request.get('api/library', { headers })).json()).library.reviews,
    ).toHaveLength(1)
  } finally {
    release()
  }
})
test('account settings and the portable skill keep authoring on the normal import path', async ({
  page,
  request,
}, info) => {
  await skillSettingsFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})
