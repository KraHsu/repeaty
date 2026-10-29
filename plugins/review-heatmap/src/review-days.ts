import type { Review } from '@repeaty/plugin-api'

export interface ReviewDay {
  key: string
  date: Date
  count: number
}

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Counts ratings, not distinct cards. Calendar arithmetic retains every date across DST. */
export function reviewDays(reviews: readonly Readonly<Review>[], today: Date): ReviewDay[] {
  const days = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
    date.setDate(date.getDate() - 364 + index)
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

/** Columns are weeks, with Sunday at the top; padding never represents review data. */
export function reviewCalendar(reviews: readonly Readonly<Review>[], today: Date) {
  const days = reviewDays(reviews, today)
  const offset = days[0]!.date.getDay()
  const columns = Math.ceil((offset + days.length) / 7)
  const cells: (ReviewDay | null)[] = Array.from(
    { length: columns * 7 },
    (_, index) => days[index - offset] ?? null,
  )
  const months = days.flatMap((day, index) =>
    index === 0 || day.date.getDate() === 1
      ? [{ key: day.key.slice(0, 7), date: day.date, column: Math.floor((offset + index) / 7) }]
      : [],
  )
  // A short partial month must not collide with the following month's label.
  if (days[0]!.date.getDate() !== 1 && months[1] && months[1].column < 3) months.shift()
  // Leave enough space for the final localized label without widening the calendar.
  if (months.length && columns - months.at(-1)!.column < 3) months.pop()
  return { days, cells, months }
}

export function reviewLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  return count <= 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4
}
