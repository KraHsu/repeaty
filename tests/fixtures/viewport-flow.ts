import type { Page } from '@playwright/test'

/** Web keeps its phone-sized coverage; native windows have a 500 × 400 minimum. */
export async function setResponsiveViewport(page: Page, width: number, height: number) {
  const desktop = await page
    .locator('.app-layout')
    .evaluate((element) => element.classList.contains('desktop-window'))
  await page.setViewportSize({
    width: desktop ? Math.max(500, width) : width,
    height: desktop ? Math.max(400, height) : height,
  })
}

/** A desktop titlebar remains interactive above modal overlays. */
export async function modalOutsidePoint(page: Page) {
  const titlebarElement = page.locator('.desktop-titlebar').first()
  const titlebar = (await titlebarElement.count()) ? await titlebarElement.boundingBox() : null
  return { x: 5, y: (titlebar ? titlebar.y + titlebar.height : 0) + 5 }
}
