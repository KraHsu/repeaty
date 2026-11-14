import { expect, it } from 'vitest'
import { visiblePage } from './navigation'

it('selects a short final page at the scroll limit even while the previous page remains visible', () => {
  expect(
    visiblePage(
      { left: 0, right: 520, top: 0, bottom: 488 },
      [
        { page: 0, bounds: { left: 16, right: 470, top: -467, bottom: 138 } },
        { page: 1, bounds: { left: 16, right: 470, top: 154, bottom: 488 } },
      ],
      0,
    ),
  ).toBe(1)
})

it('tracks the greatest visible area with horizontal clipping and ignores offscreen pages', () => {
  expect(
    visiblePage(
      { left: 100, right: 500, top: 0, bottom: 400 },
      [
        { page: 0, bounds: { left: 0, right: 90, top: 0, bottom: 800 } },
        { page: 1, bounds: { left: 100, right: 500, top: -600, bottom: 120 } },
        { page: 2, bounds: { left: 100, right: 500, top: 136, bottom: 936 } },
      ],
      1,
    ),
  ).toBe(2)
})

it('keeps the current page on an exact visibility tie and reports no page when none is visible', () => {
  const viewport = { left: 0, right: 100, top: 0, bottom: 100 }
  const pages = [
    { page: 0, bounds: { left: 0, right: 100, top: 0, bottom: 50 } },
    { page: 1, bounds: { left: 0, right: 100, top: 50, bottom: 100 } },
  ]
  expect(visiblePage(viewport, pages, 1)).toBe(1)
  expect(visiblePage({ ...viewport, top: 200, bottom: 300 }, pages, 1)).toBeUndefined()
})
