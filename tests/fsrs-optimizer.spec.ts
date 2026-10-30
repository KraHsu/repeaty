import { test } from './fixtures/empty-workspace'
import { fsrsOptimizerFlow } from './fixtures/fsrs-optimizer-flow'

test.use({ timezoneId: 'Asia/Shanghai' })
test('official optimizer trains and applies real WASM parameters in the browser library', async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  await fsrsOptimizerFlow(page, info, false)
})
