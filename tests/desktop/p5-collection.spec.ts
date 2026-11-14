import { test, expect } from './fixture'
import { collectionInboxFlow } from '../fixtures/p5-collection-flow'
import { createSourceDeck } from '../fixtures/source-flow'

// Real Rust workspace persistence through the desktop IPC fixture. File inputs use
// Chromium's public File API; this does not certify an OS picker or global shortcut.
test('desktop P5 batch collection and Inbox persist through the Rust workspace bridge', async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  await collectionInboxFlow(page, info)
})

test('desktop notifications leave material actions clickable before and after page scrolling', async ({
  page,
}, info) => {
  await createSourceDeck(page)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  const notice = page.locator('.notification-center .notification.info').filter({
    hasText: '卡组已保存',
  })
  const header = page.locator('.app-page-header')
  await expect(notice).toBeVisible()
  const belowHeader = async () => {
    const [notificationBounds, headerBounds] = await Promise.all([
      notice.boundingBox(),
      header.boundingBox(),
    ])
    return (
      !!notificationBounds &&
      !!headerBounds &&
      notificationBounds.y >= headerBounds.y + headerBounds.height
    )
  }
  await expect.poll(belowHeader).toBe(true)

  // A short window allows the empty material page to scroll until its heading
  // is partly clipped, reproducing the transition that moved a toast over a press.
  await page.setViewportSize({ width: 1280, height: 520 })
  const main = page.locator('.main-content')
  await main.evaluate((element) => {
    const header = element.querySelector('.app-page-header')!.getBoundingClientRect()
    element.scrollTop += header.top - element.getBoundingClientRect().top + 12
  })
  await expect
    .poll(async () => {
      const [mainBounds, headerBounds] = await Promise.all([
        main.boundingBox(),
        header.boundingBox(),
      ])
      return (
        !!mainBounds &&
        !!headerBounds &&
        headerBounds.y < mainBounds.y &&
        headerBounds.y + headerBounds.height > mainBounds.y
      )
    })
    .toBe(true)
  await expect.poll(belowHeader).toBe(true)
  await page.screenshot({ path: info.outputPath('p5-notification-header-clearance.png') })
  await header.getByRole('button', { name: '收集材料', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '收集材料', exact: true })).toBeVisible()
})
