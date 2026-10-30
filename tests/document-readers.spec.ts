import { test } from '@playwright/test'
import { formulaOcclusionFlow, imageOcclusionFlow } from './fixtures/p4-readers-flow'

test('official formula occlusion uses rendered leaves, independent cards, exact source return and lossless region restoration', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await formulaOcclusionFlow(page, info)
})

test('official image reader preserves original bytes, region annotations, crops and independently reviewable masks', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await imageOcclusionFlow(page, info)
})
