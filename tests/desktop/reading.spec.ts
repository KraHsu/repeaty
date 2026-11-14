import { test, storedLibrary } from './fixture'
import { readingFlow } from '../fixtures/reading-flow'
import type { Library } from '../../src/core/model'
import { readingQueueFlow } from '../fixtures/reading-queue-flow'
import { readingRoundFlow } from '../fixtures/reading-round-flow'
// These scenarios import several materials through the public two-step preview.
test.setTimeout(60_000)
test('desktop reading rounds keep their order and save all positions through defer, archive and restart', async ({
  page,
}, info) => {
  await readingRoundFlow(
    page,
    async () => {
      const rows = await storedLibrary(page)
      return Object.fromEntries(
        Object.entries(rows).map(([store, values]) => [
          store,
          (values as { value: unknown }[]).map((row) => row.value),
        ]),
      ) as unknown as Library
    },
    info,
  )
})
test('desktop reading positions and previews survive restart and native backup recovery', async ({
  page,
}, info) => {
  await readingFlow(
    page,
    async () => {
      const rows = await storedLibrary(page)
      return Object.fromEntries(
        Object.entries(rows).map(([store, values]) => [
          store,
          (values as { value: unknown }[]).map((row) => row.value),
        ]),
      ) as unknown as Library
    },
    info,
  )
})

test('desktop reading priorities order ready sources and persist through archive, defer and backups', async ({
  page,
}, info) => {
  await readingQueueFlow(
    page,
    async () => {
      const rows = await storedLibrary(page)
      return Object.fromEntries(
        Object.entries(rows).map(([store, values]) => [
          store,
          (values as { value: unknown }[]).map((row) => row.value),
        ]),
      ) as unknown as Library
    },
    info,
  )
})
