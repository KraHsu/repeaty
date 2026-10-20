import { test } from './fixture'
import { localLibrary } from '../fixtures/source-excerpt-flow'
import { batchReadingFlow, nestedDailyFlow } from '../fixtures/incremental-core-flow'

test('desktop arranges cross-page selections and preserves card work when undoing', async ({
  page,
}, info) => {
  await batchReadingFlow(page, () => localLibrary(page), info)
})
test('desktop connects nested excerpts and ancestry to daily reading and card review', async ({
  page,
}, info) => {
  await nestedDailyFlow(page, () => localLibrary(page), info)
})
