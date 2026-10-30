import { studyDay, studyDayAfter } from './study-day'
import { DEFAULT_STUDY_SETTINGS, type StudySettings } from './study-settings'
import type { Source, ReadingFeedback } from './source-data'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function calendarDays(day: string) {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000
}

/** Reading feedback describes comprehension, independently of card recall and FSRS. */
export function nextAdaptiveReading(
  source: Source,
  feedback: ReadingFeedback,
  now: Date,
  settings: Readonly<StudySettings> = DEFAULT_STUDY_SETTINGS,
) {
  const previous = source.adaptiveReading
  const configured = settings.readingMode === 'configured'
  const base =
    previous?.intervalDays ??
    source.readingIntervalDays ??
    (configured ? settings.readingInitialDays : 1)
  const minimum = configured ? settings.readingGrowthMin : 1.3
  const maximum = configured ? settings.readingGrowthMax : 3
  const factor = previous?.factor ?? (configured ? (minimum + maximum) / 2 : 2)
  const today = studyDay(now, settings)
  const elapsed = previous ? calendarDays(today) - calendarDays(previous.lastReadOn) : base
  // Early rereads do not inflate intervals; overdue reads contribute at most twice the last span.
  const observed = clamp(elapsed, Math.max(1, base / 2), base * 2)
  const nextFactor =
    Math.round(
      clamp(
        factor + (feedback === 'again' ? -0.2 : feedback === 'easy' ? 0.15 : 0),
        minimum,
        maximum,
      ) * 100,
    ) / 100
  let intervalDays = clamp(
    Math.round(
      feedback === 'again' ? base / 2 : observed * nextFactor * (feedback === 'easy' ? 1.3 : 1),
    ),
    1,
    configured ? settings.readingMaxDays : 365,
  )
  if (configured && !previous && source.readingIntervalDays === undefined)
    intervalDays =
      feedback === 'again'
        ? Math.max(1, Math.round(settings.readingInitialDays / 2))
        : settings.readingInitialDays
  if (previous && elapsed < base) intervalDays = Math.min(intervalDays, base)
  return {
    intervalDays,
    factor: nextFactor,
    lastReadOn: today,
    readCount: (previous?.readCount ?? 0) + 1,
    feedback,
  }
}

export function adaptiveReadingPlan(
  source: Source,
  feedback: ReadingFeedback,
  now: Date,
  settings: Readonly<StudySettings> = DEFAULT_STUDY_SETTINGS,
) {
  const { intervalDays } = nextAdaptiveReading(source, feedback, now, settings)
  return {
    intervalDays,
    date: studyDayAfter(now, intervalDays, settings),
    expectedReadCount: source.adaptiveReading?.readCount ?? 0,
  }
}
