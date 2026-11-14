import { test } from './fixture'
import { pdfReaderFlow, documentReaderFlow } from '../fixtures/offline-readers-flow'
import { formulaOcclusionFlow, imageOcclusionFlow } from '../fixtures/p4-readers-flow'

test('native workspace keeps offline PDF selections and review source locations', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await pdfReaderFlow(page)
})
test('native workspace keeps EPUB sequence and offline HTML resources', async ({ page }) => {
  test.setTimeout(120_000)
  await documentReaderFlow(page)
})
test('native workspace preserves formula region identities and history through portable restore', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await formulaOcclusionFlow(page, info)
})
test('native workspace keeps image annotations, crops and independent cards', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await imageOcclusionFlow(page, info)
})
