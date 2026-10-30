import { describe, expect, it } from 'vitest'
import {
  combinePages,
  displayRegion,
  normalizeRegion,
  pageProjection,
  searchProjection,
  splitPages,
  type Matrix,
} from './projection'

describe('immutable PDF projection', () => {
  it('preserves repeated words, UTF-16 offsets, EOL and cross-page boundaries', () => {
    const first = pageProjection(0, [
      { str: '重复🙂', hasEOL: true },
      { str: '重复', hasEOL: true },
    ])
    const second = pageProjection(1, [{ str: '下一页', hasEOL: false }])
    const projection = combinePages([first, second])
    expect(projection.text).toBe('重复🙂\n重复\n\n\n下一页')
    expect(first.runs[1]).toMatchObject({ index: 1, start: 5, end: 7 })
    expect(projection.pages[1]!.start).toBe(10)
    expect(projection.text.slice(first.runs[1]!.start, projection.pages[1]!.end)).toBe(
      '重复\n\n\n下一页',
    )
  })
  it('splits at whole pages without trimming or truncating any text', () => {
    const pages = Array.from({ length: 105 }, (_, page) =>
      pageProjection(page, [{ str: '页' + page }]),
    )
    const parts = splitPages(pages)
    expect(parts.map((part) => [part.startPage, part.endPage])).toEqual([
      [0, 49],
      [50, 99],
      [100, 104],
    ])
    expect(parts.flatMap((part) => part.pages.map((page) => page.text))).toEqual(
      pages.map((page) => page.text),
    )
    expect(() => pageProjection(0, [{ str: 'a'.repeat(250001) }])).toThrow('250000')
  })
  it('splits unusually dense pages before exceeding text-layer memory limits', () => {
    const page = (n: number) =>
      pageProjection(
        n,
        Array.from({ length: 30000 }, () => ({ str: '' })),
      )
    expect(splitPages([page(0), page(1), page(2)]).map((part) => part.pages.length)).toEqual([2, 1])
  })
  it('keeps a truthful index for image-only pages, without claiming OCR', () => {
    expect(pageProjection(7, []).text).toBe('[PDF 第 8 页：无可提取文字]')
  })
  it('searches exact original offsets even after case-folding characters', () => {
    const projection = combinePages([pageProjection(0, [{ str: 'İ Foo foo [x] 🙂' }])])
    expect(searchProjection(projection, 'foo').map((hit) => [hit.start, hit.end])).toEqual([
      [2, 5],
      [6, 9],
    ])
    expect(searchProjection(projection, '[x]')[0]).toMatchObject({ start: 10, end: 13 })
    expect(searchProjection(projection, 'foo', 1)).toHaveLength(1)
  })
})

describe('crop-box PDF locators', () => {
  const crop = [20, 30, 580, 780]
  const rotations: Matrix[] = [
    [2, 0, 0, -2, -40, 1560],
    [0, 2, 2, 0, -60, -40],
    [-2, 0, 0, 2, 1160, -60],
    [0, -2, -2, 0, 1560, 1160],
  ]
  it.each(rotations)('survives crop, zoom and rotation with canonical geometry', (...matrix) => {
    const region = { page: 4, x: 0.13, y: 0.27, width: 0.31, height: 0.08 }
    const screen = displayRegion(region, matrix as unknown as Matrix, crop)
    const restored = normalizeRegion(4, screen, matrix as unknown as Matrix, crop)
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(restored[key]).toBeCloseTo(region[key], 12)
  })
  it('clips partial glyph rectangles to the crop box and rejects invisible regions', () => {
    expect(
      normalizeRegion(0, { x: -10, y: 10, width: 50, height: 20 }, rotations[0]!, crop).x,
    ).toBe(0)
    expect(() =>
      normalizeRegion(0, { x: -50, y: 10, width: 10, height: 20 }, rotations[0]!, crop),
    ).toThrow()
  })
})
