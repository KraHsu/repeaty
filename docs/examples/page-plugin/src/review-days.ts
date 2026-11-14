import type { Review } from '@repeaty/plugin-api'

const key = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`

/** Local calendar arithmetic preserves dates across both timezone offsets and DST changes. */
export function reviewDays(reviews: readonly Review[], today: Date) {
  const counts = new Map<string, number>()
  for (const review of reviews) {
    const date = new Date(review.reviewedAt)
    if (!Number.isFinite(date.getTime())) continue
    counts.set(key(date), (counts.get(key(date)) ?? 0) + 1)
  }
  return Array.from({ length: 28 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
    date.setDate(date.getDate() - 27 + index)
    const dayKey = key(date)
    return { key: dayKey, date, count: counts.get(dayKey) ?? 0 }
  })
}
