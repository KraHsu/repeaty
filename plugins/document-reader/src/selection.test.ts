// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { cleanHtml } from './html'
import { selectionOffsets } from './selection'
describe('exact source positions', () => {
  it('maps nested Chinese, emoji and repeated text without searching the quote', () => {
    const { chapter } = cleanHtml(
      '<p>重复<strong>😀中文</strong>重复</p><p>重复</p>',
      'a.html',
      new Set(),
      'A',
    )
    const root = document.createElement('article')
    root.innerHTML = chapter.html
    document.body.append(root)
    const spans = [...root.querySelectorAll('[data-doc-start]')]
    const start = spans.find((item) => item.textContent === '😀中文')!,
      end = spans.filter((item) => item.textContent === '重复').at(-1)!
    const range = document.createRange()
    range.setStart(start.firstChild!, 2)
    range.setEnd(end.firstChild!, 2)
    const offsets = selectionOffsets(root, range)!
    expect(offsets.start).toBe(4)
    expect(chapter.text.slice(offsets.start, offsets.end)).toBe('中文重复\n重复')
    root.remove()
  })
})
