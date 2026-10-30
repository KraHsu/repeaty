import { test } from '@playwright/test'
import { pdfReaderFlow, documentReaderFlow } from './fixtures/offline-readers-flow'

test('packaged PDF imports offline, creates an exact multi-page card and restores the reader from review', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await pdfReaderFlow(page)
})
test('packaged EPUB preserves resources and ordered release; HTML keeps exact offline bytes', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await documentReaderFlow(page)
})
