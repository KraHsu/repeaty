import { test } from './fixtures/empty-workspace'
import {
  browserDirectoryChooser,
  collectionInboxFlow,
  sourceConnectionFlow,
} from './fixtures/p5-collection-flow'

test('P5 batch collection preserves bytes, Inbox state and distinct recursive paths', async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  await collectionInboxFlow(page, info)
})

test('P5 official Obsidian connection discovers changes, resolves links and adopts updates explicitly', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  await sourceConnectionFlow(page, info, browserDirectoryChooser)
})
