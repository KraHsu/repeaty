import { test } from './fixture'
import { pageHeaderFlow } from '../fixtures/page-header-flow'

test('desktop study pages share title and action geometry at wide, narrow and large font sizes', async ({
  page,
}, info) => {
  await pageHeaderFlow(page, info, 500)
})
