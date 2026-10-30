import { expect, it } from 'vitest'
import { defaults, lookupUrl, normalizeTargets } from './lookup'
it('encodes selected text once without changing the target origin', () => {
  const input = '中文 & a=1 #? / 😀'
  const url = new URL(lookupUrl('https://example.org/search?q={text}', input))
  expect(url.origin).toBe('https://example.org')
  expect(url.searchParams.get('q')).toBe(input)
})
it.each([
  'javascript:{text}',
  'http://example.org/?q={text}',
  'https://{text}.org/',
  'https://user:pass@example.org/?q={text}',
  'file:///{text}',
  'https://example.org/search',
])('rejects unsafe or incomplete target %s', (template) => {
  expect(() => lookupUrl(template, 'text')).toThrow()
})
it('bounds content and validates stored targets without accepting duplicate identities', () => {
  expect(() => lookupUrl(defaults()[0]!.template, 'x'.repeat(10001))).toThrow()
  expect(() => normalizeTargets([defaults()[0], defaults()[0]])).toThrow()
  expect(normalizeTargets([])).toEqual([])
  expect(normalizeTargets(defaults())).toEqual(defaults())
})
