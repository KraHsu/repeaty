import { test, expect, headers } from './fixture'
import {
  sourceExcerptFlow,
  excerptDuringRound,
  selectForExcerpt,
} from '../fixtures/source-excerpt-flow'
import { previewSource, saveSource, sourceQuote } from '../fixtures/source-flow'
import { saveReading } from '../fixtures/reading-flow'
test('account excerpts preserve provenance and learning progress through deletion, restart and backup', async ({
  page,
  request,
}, info) => {
  await page.goto('./')
  await sourceExcerptFlow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
    info,
  )
})
test('account excerpts enter the next round and keep their independent reading schedule', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await excerptDuringRound(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
  )
})
test('a service failure keeps the selected text and title for retry without partial library changes', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await previewSource(page)
  await saveSource(page)
  await selectForExcerpt(page)
  await saveReading(page)
  const before = (await (await request.get('api/library', { headers })).json()).library
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject &&
    route
      .request()
      .postDataJSON()
      .patches.some((patch: { value?: { kind?: string } }) => patch.value?.kind === 'excerpt')
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.continue(),
  )
  await page.getByRole('button', { name: '保存为摘录', exact: true }).click()
  await page.getByLabel('摘录标题').fill('Remote retry')
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('摘录标题')).toHaveValue('Remote retry')
  await expect(page.getByLabel('选中的原文')).toHaveValue(sourceQuote)
  expect((await (await request.get('api/library', { headers })).json()).library).toEqual(before)
  reject = false
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.source-text')).toHaveValue(sourceQuote)
})
