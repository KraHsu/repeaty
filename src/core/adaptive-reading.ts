import { localDay } from './model'
import type { Source, ReadingFeedback } from './source-data'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function calendarDays(day: string) {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000
}

/** Reading feedback describes comprehension, independently of card recall and FSRS. */
export function nextAdaptiveReading(source: Source, feedback: ReadingFeedback, now: Date) {
  const previous = source.adaptiveReading
  const base = previous?.intervalDays ?? source.readingIntervalDays ?? 1
  const factor = previous?.factor ?? 2
  const today = localDay(now)
  const elapsed = previous ? calendarDays(today) - calendarDays(previous.lastReadOn) : base
  // Early rereads do not inflate intervals; overdue reads contribute at most twice the last span.
  const observed = clamp(elapsed, Math.max(1, base / 2), base * 2)
  const nextFactor =
    Math.round(
      clamp(factor + (feedback === 'again' ? -0.2 : feedback === 'easy' ? 0.15 : 0), 1.3, 3) * 100,
    ) / 100
  let intervalDays = clamp(
    Math.round(
      feedback === 'again' ? base / 2 : observed * nextFactor * (feedback === 'easy' ? 1.3 : 1),
    ),
    1,
    365,
  )
  if (previous && elapsed < base) intervalDays = Math.min(intervalDays, base)
  return {
    intervalDays,
    factor: nextFactor,
    lastReadOn: today,
    readCount: (previous?.readCount ?? 0) + 1,
    feedback,
  }
}

export function adaptiveReadingPlan(source: Source, feedback: ReadingFeedback, now: Date) {
  const { intervalDays } = nextAdaptiveReading(source, feedback, now)
  const date = new Date(now)
  date.setDate(date.getDate() + intervalDays)
  return {
    intervalDays,
    date: localDay(date),
    expectedReadCount: source.adaptiveReading?.readCount ?? 0,
  }
}
