import { test } from './fixture'
import { localLibrary } from '../fixtures/source-excerpt-flow'
import { sourceDetailsFlow } from '../fixtures/source-details-flow'

test('desktop edits source details without changing snapshots, learning or backup references', async ({
  page,
}, info) => {
  await sourceDetailsFlow(page, () => localLibrary(page), info)
})
