// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { renderReadingMarkdown } from '../core/content'
import { readingSelection } from './reading-selection'

function rendered(text: string) {
  const root = document.createElement('div')
  root.innerHTML = renderReadingMarkdown(text)
  return root
}
function select(root: HTMLElement, start: Node, from: number, end: Node, to: number, text: string) {
  const range = document.createRange()
  range.setStart(start, from)
  range.setEnd(end, to)
  return readingSelection(root, range, text)
}
const textNode = (element: Element) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  return walker.nextNode()!
}
it('maps repeated rendered paragraphs to their own immutable ranges, including Chinese and emoji', () => {
  const source = '# 标题\n\n重复 **中文😀** 结束\n\n重复 **中文😀** 结束'
  const root = rendered(source),
    strong = root.querySelectorAll('strong')
  const node = textNode(strong[1]!)
  const result = select(root, node, 0, node, 4, source)
  const start = source.lastIndexOf('中文😀')
  expect(result).toEqual({ start, end: start + 4 })
  expect(select(root, node, 0, node, 3, source)).toBeUndefined()
})
it('maps a maximum-size single paragraph without argument-spread limits', () => {
  const source = 'a'.repeat(249_996) + '中文🙂'
  const root = rendered(source),
    node = textNode(root.querySelector('p')!)
  expect(select(root, node, 249_996, node, 250_000, source)).toEqual({
    start: 249_996,
    end: 250_000,
  })
})
it('maps ranges across paragraphs, nested lists, emphasis and links without global text matching', () => {
  const source = 'Start **bold** text\n\n> - Same [link](https://example.com)\n>   - Same end'
  const root = rendered(source)
  const first = textNode(root.querySelector('strong')!)
  const last = [...root.querySelectorAll('[data-reading-start]')].find(
    (el) => el.textContent === 'Same end',
  )!
  const result = select(root, first, 1, textNode(last), 8, source)
  expect(result).toEqual({ start: source.indexOf('bold') + 1, end: source.indexOf('Same end') + 8 })
  const link = textNode(root.querySelector('a')!)
  expect(select(root, link, 0, link, 4, source)).toEqual({
    start: source.indexOf('link'),
    end: source.indexOf('link') + 4,
  })
})
it('maps duplicate table cells and escaped pipes to the correct columns', () => {
  const source = '| same | same |\n| --- | --- |\n| same | a\\|b |'
  const root = rendered(source),
    headings = root.querySelectorAll('th')
  const node = textNode(headings[1]!)
  expect(select(root, node, 0, node, 4, source)).toEqual({ start: 9, end: 13 })
  const cell = root.querySelectorAll('td')[1]!
  const parts = cell.querySelectorAll('[data-reading-start]')
  expect(
    select(
      root,
      textNode(parts[0]!),
      0,
      textNode(parts[parts.length - 1]!),
      parts[parts.length - 1]!.textContent!.length,
      source,
    ),
  ).toEqual({ start: source.indexOf('a\\|b'), end: source.indexOf('a\\|b') + 4 })
})
it('keeps CRLF, entities and inline code ranges precise', () => {
  const source = 'first\r\n\r\nA &amp; B `code`'
  const root = rendered(source)
  const entity = [...root.querySelectorAll('[data-reading-start]')].find(
    (el) => el.textContent === '&',
  )!
  expect(select(root, textNode(entity), 0, textNode(entity), 1, source)).toEqual({
    start: source.indexOf('&amp;'),
    end: source.indexOf('&amp;') + 5,
  })
  const code = textNode(root.querySelector('code')!)
  expect(select(root, code, 1, code, 3, source)).toEqual({
    start: source.indexOf('code') + 1,
    end: source.indexOf('code') + 3,
  })
})
it('maps tables inside quote containers without counting container markers as cells', () => {
  const source = '> | same | same |\n> | --- | --- |\n> | same | 中文🙂 |'
  const root = rendered(source),
    heading = textNode(root.querySelectorAll('th')[1]!),
    cell = textNode(root.querySelectorAll('td')[1]!)
  expect(select(root, heading, 0, heading, 4, source)).toEqual({ start: 11, end: 15 })
  const start = source.indexOf('中文🙂')
  expect(select(root, cell, 0, cell, 4, source)).toEqual({ start, end: start + 4 })
})
it('preserves fenced code highlighting and exact source offsets', () => {
  const source = '```js\nconst answer = "😀"\nconsole.log(answer)\n```'
  const root = rendered(source)
  expect(root.querySelector('.hljs-keyword')?.textContent).toBe('const')
  const start = textNode(root.querySelector('.hljs-keyword')!)
  const end = [...root.querySelectorAll('[data-reading-start]')].find((node) =>
    node.textContent?.includes('(answer)'),
  )!
  const result = select(root, start, 0, textNode(end), end.textContent!.indexOf(')') + 1, source)
  expect(result).toEqual({
    start: source.indexOf('const'),
    end: source.indexOf('console.log(answer)') + 19,
  })
})
it('rejects raw HTML and mathematical text instead of inventing offsets', () => {
  const source = '<div><b>unsafe selection</b></div>\n\n$x^2$'
  const root = rendered(source),
    html = textNode(root.querySelector('b')!)
  expect(select(root, html, 0, html, 6, source)).toBeUndefined()
  const math = textNode(root.querySelector('.katex')!)
  expect(select(root, math, 0, math, 1, source)).toBeUndefined()
  expect(
    rendered('<div data-reading-start="1" data-reading-stop="3">forged</div>').querySelector(
      '[data-reading-start]',
    ),
  ).toBeNull()
})
it('creates trusted version-addressed task and Wiki controls without accepting forged HTML', () => {
  const source =
    '- [ ] One\n- [x] Two\n\n[[source:stable|Same]]\n\n<span data-reading-task="3">fake</span>'
  const root = rendered(source),
    tasks = root.querySelectorAll('[data-reading-task]')
  expect(tasks).toHaveLength(2)
  expect(tasks[0]!.getAttribute('data-reading-task')).toBe('3')
  expect(tasks[1]!.getAttribute('aria-checked')).toBe('true')
  const link = root.querySelector('[data-wiki-target]')!
  expect(link.getAttribute('data-wiki-target')).toBe('source:stable')
  const node = textNode(link)
  expect(select(root, node, 0, node, 4, source)).toEqual({
    start: source.indexOf('Same'),
    end: source.indexOf('Same') + 4,
  })
})
