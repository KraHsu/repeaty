import { expect, it } from 'vitest'
import { dataSchema, matches } from './model'

it('accepts matching answers across outer whitespace, case and equivalent Unicode forms', () => {
  expect(matches('  VUE  ', 'Vue')).toBe(true)
  expect(matches('cafe\u0301', 'café')).toBe(true)
  expect(matches('a different answer', 'Vue')).toBe(false)
})

it('rejects missing, blank and oversized expected answers before review', () => {
  for (const data of [{}, { answer: '  ' }, { answer: 'a'.repeat(1001) }])
    expect(dataSchema.safeParse(data).success).toBe(false)
  expect(dataSchema.parse({ answer: '  Vue  ' })).toEqual({ answer: 'Vue' })
})
