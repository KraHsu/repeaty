import { test } from './fixture'
import { collectionInboxFlow } from '../fixtures/p5-collection-flow'

// Real Rust workspace persistence through the desktop IPC fixture. File inputs use
// Chromium's public File API; this does not certify an OS picker or global shortcut.
test('desktop P5 batch collection and Inbox persist through the Rust workspace bridge', async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  await collectionInboxFlow(page, info)
})
