type Bounds = Pick<DOMRectReadOnly, 'top' | 'right' | 'bottom' | 'left'>

/** A short final page cannot always reach the viewport top; prefer the visible page area. */
export function visiblePage(
  viewport: Bounds,
  pages: readonly { page: number; bounds: Bounds }[],
  current: number,
): number | undefined {
  let best: number | undefined,
    area = 0
  for (const { page, bounds } of pages) {
    const width = Math.max(
      0,
      Math.min(viewport.right, bounds.right) - Math.max(viewport.left, bounds.left),
    )
    const height = Math.max(
      0,
      Math.min(viewport.bottom, bounds.bottom) - Math.max(viewport.top, bounds.top),
    )
    const visible = width * height
    if (visible > area || (visible > 0 && visible === area && page === current)) {
      best = page
      area = visible
    }
  }
  return best
}
