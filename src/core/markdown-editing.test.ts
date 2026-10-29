import { expect, it } from 'vitest'
import { applyMarkdownEdit } from './markdown-editing'
it('continues nested ordered lists and resets completed tasks', () => {
  expect(applyMarkdownEdit('  9. item', 9, 9, 'continue-list')).toEqual({
    text: '  9. item\n  10. ',
    start: 16,
    end: 16,
  })
  const text = '> - [x] 中文😀'
  const next = applyMarkdownEdit(text, text.length, text.length, 'continue-list')!
  expect(next.text).toBe(text + '\n> - [ ] ')
  expect(next.start).toBe(next.text.length)
  expect(applyMarkdownEdit('- [ ] ', 6, 6, 'continue-list')).toEqual({ text: '', start: 0, end: 0 })
  expect(applyMarkdownEdit('```\n- literal', 13, 13, 'continue-list')).toBeUndefined()
  for (const code of [
    '> ```\n> - literal',
    '- ~~~\n  - literal',
    '```\n```not-a-close\n- literal',
  ]) {
    expect(applyMarkdownEdit(code, code.length, code.length, 'continue-list')).toBeUndefined()
  }
})
it('indents and outdents selected lines without changing the unselected line or splitting emoji', () => {
  const value = 'one\n😀two\nlast'
  const indented = applyMarkdownEdit(value, 0, 10, 'indent')!
  expect(indented.text).toBe('  one\n  😀two\nlast')
  const restored = applyMarkdownEdit(indented.text, indented.start, indented.end, 'outdent')!
  expect(restored.text).toBe(value)
  expect(applyMarkdownEdit('😀', 1, 1, 'indent')!.start).toBe(2)
})
it('creates tasks and wraps code/math while preserving selected text', () => {
  expect(applyMarkdownEdit('- item', 6, 6, 'task')!.text).toBe('- [ ] item')
  expect(applyMarkdownEdit('- [ ] item', 10, 10, 'task')!.text).toBe('- [x] item')
  const code = applyMarkdownEdit('a ``` b', 0, 7, 'code')!
  expect(code.text).toBe('````\na ``` b\n````')
  expect(code.text.slice(code.start, code.end)).toBe('a ``` b')
  expect(applyMarkdownEdit('x^2', 0, 3, 'math')!.text).toBe('$$\nx^2\n$$')
  const longCode = '`a'.repeat(125_000)
  const wrapped = applyMarkdownEdit(longCode, 0, longCode.length, 'code')!
  expect(wrapped.text.slice(wrapped.start, wrapped.end)).toBe(longCode)
})
