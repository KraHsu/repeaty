import { test } from './fixture'
import { localLibrary } from '../fixtures/source-excerpt-flow'
import { readingFilterFlow } from '../fixtures/reading-filter-flow'

test('desktop source filters and scoped rounds preserve local excerpts, positions and learning records', async ({
  page,
}, info) => {
  await readingFilterFlow(page, () => localLibrary(page), info)
})
