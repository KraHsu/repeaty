import type { Review } from '@repeaty/plugin-api'

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Counts ratings, not distinct cards. Calendar arithmetic retains every date across DST. */
export function reviewDays(reviews: readonly Readonly<Review>[], today: Date) {
  const days = Array.from({ length: 28 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
    date.setDate(date.getDate() - 27 + index)
    return { key: localDateKey(date), date, count: 0 }
  })
  const byDate = new Map(days.map((day) => [day.key, day]))
  for (const review of reviews) {
    const date = new Date(review.reviewedAt)
    if (!Number.isFinite(date.getTime())) continue
    const day = byDate.get(localDateKey(date))
    if (day) day.count++
  }
  return days
}
