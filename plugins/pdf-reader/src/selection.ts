import type { MaterialSelection } from '@repeaty/plugin-api'
import { PDF_LIMITS, normalizeRegion, type Matrix, type PdfRegion } from './projection'

export interface PageGeometry {
  page: number
  element: HTMLElement
  transform: Matrix
  crop: number[]
}

/** Map DOM boundaries to immutable projection offsets, rather than searching for selected words. */
export function collectSelection(
  range: Range,
  text: string,
  sourceId: string,
  versionId: string,
  pages: readonly PageGeometry[],
): MaterialSelection | undefined {
  if (range.collapsed) return
  let first = Infinity,
    last = -1
  const selected: { page: PageGeometry; range: Range }[] = []
  const selectionStart = range.cloneRange(),
    selectionEnd = range.cloneRange()
  selectionStart.collapse(true)
  selectionEnd.collapse(false)
  for (const page of pages) {
    for (const span of page.element.querySelectorAll<HTMLElement>('[data-pdf-start]')) {
      if (!range.intersectsNode(span) || !span.firstChild) continue
      const from = Number(span.dataset.pdfStart),
        to = Number(span.dataset.pdfEnd)
      const part = document.createRange()
      part.selectNodeContents(span)
      const spanEnd = part.cloneRange()
      spanEnd.collapse(false)
      if (
        selectionEnd.compareBoundaryPoints(Range.START_TO_START, part) <= 0 ||
        selectionStart.compareBoundaryPoints(Range.START_TO_START, spanEnd) >= 0
      )
        continue
      if (selectionStart.compareBoundaryPoints(Range.START_TO_START, part) > 0)
        part.setStart(range.startContainer, range.startOffset)
      if (selectionEnd.compareBoundaryPoints(Range.START_TO_START, spanEnd) < 0)
        part.setEnd(range.endContainer, range.endOffset)
      if (part.collapsed) continue
      const prefix = document.createRange()
      prefix.selectNodeContents(span)
      prefix.setEnd(part.startContainer, part.startOffset)
      const start = from + prefix.toString().length
      const end = Math.min(to, start + part.toString().length)
      if (end <= start) continue
      first = Math.min(first, start)
      last = Math.max(last, end)
      if (last - first > PDF_LIMITS.selection)
        throw new Error('一次最多选择 10000 个字符，请缩小选区。')
      selected.push({ page, range: part })
    }
  }
  if (!Number.isFinite(first) || last <= first || first < 0 || last > text.length) return
  const regions: PdfRegion[] = []
  for (const { page, range: part } of selected) {
    const bounds = page.element.getBoundingClientRect()
    for (const rect of part.getClientRects()) {
      if (rect.width < 0.1 || rect.height < 0.1) continue
      const clipped = {
        x: Math.max(bounds.left, rect.left),
        y: Math.max(bounds.top, rect.top),
        right: Math.min(bounds.right, rect.right),
        bottom: Math.min(bounds.bottom, rect.bottom),
      }
      if (clipped.right <= clipped.x || clipped.bottom <= clipped.y) continue
      regions.push(
        normalizeRegion(
          page.page,
          {
            x: clipped.x - bounds.left,
            y: clipped.y - bounds.top,
            width: clipped.right - clipped.x,
            height: clipped.bottom - clipped.y,
          },
          page.transform,
          page.crop,
        ),
      )
      if (regions.length > PDF_LIMITS.regions) throw new Error('选区包含过多文字区域，请分段摘录。')
    }
  }
  if (!regions.length) return
  return {
    text: text.slice(first, last),
    projection: { start: first, end: last },
    locator: { schemaVersion: 1, kind: 'pdf', sourceId, versionId, regions },
  }
}
