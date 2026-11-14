export const PDF_LIMITS = {
  bytes: 64 * 1024 * 1024,
  pages: 2000,
  pagesPerMaterial: 50,
  characters: 250_000,
  selection: 10_000,
  regions: 256,
  canvasPixels: 8_000_000,
  textItemsPerPage: 30_000,
  textItemsPerMaterial: 60_000,
  totalCharacters: 8_000_000,
  totalTextItems: 400_000,
} as const

export interface PdfTextItem {
  str: string
  dir: string
  transform: number[]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}
export interface PdfTextRun {
  index: number
  text: string
  start: number
  end: number
}
export interface PdfPageProjection {
  page: number
  text: string
  runs: PdfTextRun[]
}
export interface PdfProjection {
  startPage: number
  endPage: number
  text: string
  pages: (PdfPageProjection & { start: number; end: number })[]
}

/** Preserve PDF.js' logical text order, including its EOL markers. No text searching is used. */
export function pageProjection(page: number, items: readonly { str?: string; hasEOL?: boolean }[]) {
  if (items.length > PDF_LIMITS.textItemsPerPage)
    throw new Error('单页文字对象过多，无法安全导入。')
  let text = ''
  const runs: PdfTextRun[] = []
  let index = 0
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    const start = text.length
    text += item.str
    runs.push({ index: index++, text: item.str, start, end: text.length })
    if (item.hasEOL && !text.endsWith('\n')) text += '\n'
    if (text.length > PDF_LIMITS.characters) throw new Error('单页文字超过 250000 字符，未导入。')
  }
  if (!text.trim()) text = `[PDF 第 ${page + 1} 页：无可提取文字]`
  return { page, text, runs } satisfies PdfPageProjection
}

export function combinePages(pages: readonly PdfPageProjection[]): PdfProjection {
  if (!pages.length) throw new Error('PDF 没有可用页面。')
  let text = ''
  const positioned = pages.map((page) => {
    if (text) text += '\n\n'
    const start = text.length
    text += page.text
    return { ...page, start, end: text.length }
  })
  if (text.length > PDF_LIMITS.characters) throw new Error('材料文字超过 250000 字符，未导入。')
  return { startPage: pages[0]!.page, endPage: pages.at(-1)!.page, text, pages: positioned }
}

/** Split only between whole pages. The original bytes and global page identities stay unchanged. */
export function splitPages(pages: readonly PdfPageProjection[]): PdfProjection[] {
  const result: PdfProjection[] = []
  let group: PdfPageProjection[] = [],
    length = 0,
    objects = 0
  for (const page of pages) {
    const nextLength = length + (group.length ? 2 : 0) + page.text.length
    if (
      group.length &&
      (nextLength > PDF_LIMITS.characters ||
        group.length === PDF_LIMITS.pagesPerMaterial ||
        objects + page.runs.length > PDF_LIMITS.textItemsPerMaterial)
    ) {
      result.push(combinePages(group))
      group = []
      length = 0
      objects = 0
    }
    group.push(page)
    length += (group.length > 1 ? 2 : 0) + page.text.length
    objects += page.runs.length
  }
  if (group.length) result.push(combinePages(group))
  return result
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface PdfRegion extends Rect {
  page: number
}
export type Matrix = readonly [number, number, number, number, number, number]

export function transformPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}
export function inverse(matrix: Matrix): Matrix {
  const [a, b, c, d, e, f] = matrix,
    det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('PDF 页面变换无效。')
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}
export function transformRect(matrix: Matrix, rect: Rect): Rect {
  const corners = [
    transformPoint(matrix, rect.x, rect.y),
    transformPoint(matrix, rect.x + rect.width, rect.y),
    transformPoint(matrix, rect.x, rect.y + rect.height),
    transformPoint(matrix, rect.x + rect.width, rect.y + rect.height),
  ]
  const xs = corners.map(([x]) => x),
    ys = corners.map(([, y]) => y)
  const x = Math.min(...xs),
    y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Locator rectangles are relative to the unrotated crop-box, with a top-left origin. */
export function normalizeRegion(
  page: number,
  rect: Rect,
  display: Matrix,
  crop: readonly number[],
): PdfRegion {
  const pdf = transformRect(inverse(display), rect)
  const [left, bottom, right, top] = crop as [number, number, number, number]
  const width = right - left,
    height = top - bottom
  if (!(width > 0 && height > 0)) throw new Error('PDF 页面范围无效。')
  const x = Math.max(0, Math.min(1, (pdf.x - left) / width))
  const y = Math.max(0, Math.min(1, (top - pdf.y - pdf.height) / height))
  const x2 = Math.max(x, Math.min(1, (pdf.x + pdf.width - left) / width))
  const y2 = Math.max(y, Math.min(1, (top - pdf.y) / height))
  if (!(x2 > x && y2 > y)) throw new Error('选区不在 PDF 页面内。')
  return { page, x, y, width: x2 - x, height: y2 - y }
}

export function displayRegion(region: Rect, display: Matrix, crop: readonly number[]): Rect {
  const [left, bottom, right, top] = crop as [number, number, number, number]
  return transformRect(display, {
    x: left + region.x * (right - left),
    y: top - (region.y + region.height) * (top - bottom),
    width: region.width * (right - left),
    height: region.height * (top - bottom),
  })
}

export function searchProjection(projection: PdfProjection, query: string, limit = 500) {
  const needle = query.trim()
  if (!needle) return []
  const found: { page: number; start: number; end: number; snippet: string }[] = []
  for (const page of projection.pages) {
    // Case folding can change UTF-16 length (e.g. İ). Match against the original projection.
    const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
    for (const match of page.text.matchAll(expression)) {
      if (found.length >= limit) break
      const start = match.index,
        end = start + match[0].length
      found.push({
        page: page.page,
        start: page.start + start,
        end: page.start + end,
        snippet: page.text.slice(Math.max(0, start - 24), Math.min(page.text.length, end + 48)),
      })
    }
    if (found.length >= limit) break
  }
  return found
}
