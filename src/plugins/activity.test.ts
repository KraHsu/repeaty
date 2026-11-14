import { expect, it } from 'vitest'
import type { Review } from '../core/model'
import { createPluginReviewReader } from './activity'

it('exposes immutable rating summaries without scheduling, assessment or undo data', () => {
  const review = {
    id: 'r',
    cardId: 'card',
    rating: 3,
    reviewedAt: '2026-10-29T10:00:00Z',
    nextDue: '2026-11-01T00:00:00Z',
    studyDay: '2026-10-29',
    kind: 'review',
    source: 'normal',
    assessment: { pluginId: 'private' },
    previous: { schedule: { private: true } },
  } as unknown as Review
  const read = createPluginReviewReader()
  const result = read([review])
  expect(result).toEqual([
    { id: 'r', cardId: 'card', rating: 3, reviewedAt: '2026-10-29T10:00:00Z' },
  ])
  expect(() => {
    ;(result[0] as { rating: number }).rating = 1
  }).toThrow()
  expect(() => {
    ;(result as unknown[]).push({})
  }).toThrow()
  expect(review.rating).toBe(3)
  const updated = read([review, { ...review, id: 'new' }])
  expect(updated[0]).toBe(result[0])
  expect(updated[1]!.id).toBe('new')
  expect(read([{ ...review, rating: 4 }])[0]!.rating).toBe(4)
  expect(read([])).toEqual([])
})
