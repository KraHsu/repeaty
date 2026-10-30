import type { StudySettings } from './study-settings'

type DaySettings = Pick<StudySettings, 'dayStartHour'>
function hour(settings?: DaySettings) {
  const value = settings?.dayStartHour ?? 0
  if (!Number.isInteger(value) || value < 0 || value > 23)
    throw new RangeError('学习日开始时间需为 0–23 时。')
  return value
}
function valid(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new RangeError('学习日期无效。')
}
function key(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Local calendar construction retains DST's short/long days and repeated hours. */
export function studyDayStart(now = new Date(), settings?: DaySettings) {
  valid(now)
  const h = hour(settings)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h)
  return now < today ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, h) : today
}
export function studyDay(now = new Date(), settings?: DaySettings): string {
  return key(studyDayStart(now, settings))
}
export function scheduledStudyDayStart(now: Date, days: number, settings?: DaySettings) {
  if (!Number.isInteger(days) || days < 0 || days > 36500)
    throw new RangeError('学习间隔需为 0–36500 天。')
  const start = studyDayStart(now, settings)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, hour(settings))
}
export function nextStudyDayStart(now = new Date(), settings?: DaySettings) {
  return scheduledStudyDayStart(now, 1, settings)
}
export function studyDayAfter(now: Date, days: number, settings?: DaySettings) {
  return key(scheduledStudyDayStart(now, days, settings))
}
