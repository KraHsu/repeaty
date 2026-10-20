import { characterBoundary, type ReadingPosition } from '../core/source-data'

/** A hidden plain-text mirror measures wrapped lines without storing viewport pixels. */
export class TextareaPosition {
  private mirror: HTMLDivElement
  private text: Text
  private range: Range
  constructor(private area: HTMLTextAreaElement) {
    const doc = area.ownerDocument
    this.mirror = doc.createElement('div')
    this.text = doc.createTextNode('')
    this.range = doc.createRange()
    this.mirror.setAttribute('aria-hidden', 'true')
    this.mirror.style.cssText =
      'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;box-sizing:border-box;margin:0;border:0;height:auto;'
    this.mirror.append(this.text)
    doc.body.append(this.mirror)
  }
  private measure() {
    const style = getComputedStyle(this.area)
    for (const property of [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'font-variant',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'tab-size',
      'text-indent',
      'text-transform',
      'word-break',
      'overflow-wrap',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ])
      this.mirror.style.setProperty(property, style.getPropertyValue(property))
    this.mirror.style.width = `${this.area.clientWidth}px`
    const value = this.area.value + '\u200b'
    if (this.text.data !== value) this.text.data = value
    return parseFloat(style.paddingTop) || 0
  }
  private top(offset: number) {
    const start = characterBoundary(this.area.value, offset)
    const length = (this.area.value.codePointAt(start) ?? 0) > 0xffff ? 2 : 1
    this.range.setStart(this.text, start)
    this.range.setEnd(this.text, Math.min(this.text.length, start + length))
    return this.range.getBoundingClientRect().top - this.mirror.getBoundingClientRect().top
  }
  capture(): ReadingPosition {
    this.measure()
    if (this.area.scrollTop < 1) return { offset: 0, fraction: 0, view: 'source' }
    const lowerBound = (y: number) => {
      let low = 0,
        high = this.area.value.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (this.top(middle) < y) low = middle + 1
        else high = middle
      }
      return low
    }
    const preceding = Math.max(0, lowerBound(this.area.scrollTop + this.top(0) + 0.1) - 1)
    const offset = characterBoundary(this.area.value, lowerBound(this.top(preceding) - 0.1))
    return { offset, fraction: 0, view: 'source' }
  }
  restore(offset: number, moveCaret = false) {
    this.measure()
    if (moveCaret) this.area.setSelectionRange(offset, offset)
    this.area.scrollTop = Math.max(0, this.top(offset) - this.top(0))
  }
  dispose() {
    this.mirror.remove()
    this.range.detach()
  }
}

function blocks(element: HTMLElement) {
  const top = element.getBoundingClientRect().top + element.clientTop
  return Array.from(element.querySelectorAll<HTMLElement>('[data-reading-offset]')).map(
    (block) => ({
      element: block,
      offset: Number(block.dataset.readingOffset),
      end: Number(block.dataset.readingEnd),
      top: block.getBoundingClientRect().top - top + element.scrollTop,
    }),
  )
}
function lastIndex<T>(values: T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index--)
    if (predicate(values[index]!)) return index
  return -1
}
export function capturePreview(element: HTMLElement): ReadingPosition {
  const anchors = blocks(element)
  const index = Math.max(
    0,
    lastIndex(anchors, (block) => block.top <= element.scrollTop + 1),
  )
  const block = anchors[index]
  if (!block) return { offset: 0, fraction: 0, view: 'preview' }
  const height = (anchors[index + 1]?.top ?? element.scrollHeight) - block.top
  return {
    offset: block.offset,
    fraction:
      Math.round(
        Math.min(1, Math.max(0, (element.scrollTop - block.top) / Math.max(1, height))) * 10000,
      ) / 10000,
    view: 'preview',
  }
}
export function restorePreview(element: HTMLElement, position: ReadingPosition) {
  const anchors = blocks(element)
  const index = Math.max(
    0,
    lastIndex(anchors, (block) => block.offset <= position.offset),
  )
  const block = anchors[index]
  if (!block) return
  const fraction =
    position.view === 'preview'
      ? position.fraction
      : Math.min(
          1,
          Math.max(0, (position.offset - block.offset) / Math.max(1, block.end - block.offset)),
        )
  element.scrollTop =
    block.top + fraction * ((anchors[index + 1]?.top ?? element.scrollHeight) - block.top)
}
export function previewSourceOffset(element: HTMLElement, position: ReadingPosition, text: string) {
  const anchors = blocks(element)
  const anchor = anchors[lastIndex(anchors, (block) => block.offset <= position.offset)]
  return characterBoundary(
    text,
    anchor
      ? anchor.offset + Math.floor((anchor.end - anchor.offset) * position.fraction)
      : position.offset,
  )
}
