import { test } from './fixture'
import { localLibrary } from '../fixtures/source-excerpt-flow'
import { readingIntervalFlow } from '../fixtures/reading-interval-flow'

test('desktop reading intervals retain independent steps, dates and backups through restart', async ({
  page,
}, info) => {
  await readingIntervalFlow(page, () => localLibrary(page), info)
})
