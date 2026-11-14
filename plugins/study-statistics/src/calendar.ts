import type { StudyStatisticsDay } from '@repeaty/plugin-api'

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dueDateLabel(value: string) {
  // Reading plans are calendar days; card due values are instants in local time.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDateKey(new Date(value))
}
export function displayDate(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year!, month! - 1, date!, 12)
}
export function shiftDay(day: string, days: number) {
  const value = new Date(`${day}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function statisticsWindow(today: string) {
  const [year, month] = today.split('-').map(Number)
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year!, month! - 1 - 5 + index, 1, 12)
    return localDateKey(date).slice(0, 7)
  })
  const end = new Date(year!, month! - 1 + 7, 0, 12)
  return { months, from: `${months[0]}-01`, to: localDateKey(end) }
}
/** A constant six-week grid avoids moving controls when a month has fewer rows. */
export function calendarCells(month: string): (string | null)[] {
  const first = displayDate(`${month}-01`)
  const offset = (first.getDay() + 6) % 7
  const end = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate()
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1
    return day < 1 || day > end ? null : `${month}-${String(day).padStart(2, '0')}`
  })
}
export function monthTotals(days: readonly StudyStatisticsDay[], month: string) {
  const selected = days.filter((day) => day.day.startsWith(`${month}-`))
  const sum = (field: keyof Omit<StudyStatisticsDay, 'day'>) => {
    const values = selected.map((day) => day[field]).filter((value) => value !== null)
    return values.length ? values.reduce((total, value) => total + value, 0) : null
  }
  return {
    reviews: sum('reviews') ?? 0,
    readings: sum('readings'),
    practices: sum('practices'),
    foregroundMs: sum('foregroundMs'),
    scheduledCards: sum('scheduledCards') ?? 0,
    scheduledReadings: sum('scheduledReadings') ?? 0,
  }
}
export function nextBoundary(now: Date, hour: number) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next
}
