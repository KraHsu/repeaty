import { test } from './fixture'
import { fsrsOptimizerFlow } from '../fixtures/fsrs-optimizer-flow'

test.use({ timezoneId: 'Asia/Shanghai' })
test('official optimizer trains real WASM, validates, applies and restores parameters across library lifecycle', async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  await fsrsOptimizerFlow(page, info)
})
