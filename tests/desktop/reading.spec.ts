import { test, storedLibrary } from './fixture'
import { readingFlow } from '../fixtures/reading-flow'
import type { Library } from '../../src/core/model'
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
