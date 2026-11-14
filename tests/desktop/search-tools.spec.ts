import { test } from './fixture'
import { searchToolsLayoutFlow } from '../fixtures/search-tools-flow'

test('desktop search tools separate saving, syntax and practice without overflowing narrow windows', async ({
  page,
}, info) => {
  await searchToolsLayoutFlow(page, info, true)
})
