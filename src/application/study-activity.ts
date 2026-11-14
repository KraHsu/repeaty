import type { StudyActivity } from '../core/study-data'
import { studyDay } from '../core/study-day'

export interface ActivitySample {
  scope: string
  wall: Date
  monotonic: number
  foreground: boolean
  kind: StudyActivity['kind']
  dayStartHour: number
}

/** Counts only short, observable foreground intervals. Suspension never becomes study time. */
export function createStudyActivityRecorder(session: string = crypto.randomUUID()) {
  let previous: ActivitySample | undefined
  let interaction = 0
  let sequence = 0
  let segment = 0
  const rows = new Map<string, StudyActivity>()
  const dirty = new Set<string>()
  function sample(next: ActivitySample, interacted = false) {
    if (!previous || next.scope !== previous.scope) {
      rows.clear()
      dirty.clear()
      interaction = next.monotonic
    } else {
      const elapsed = next.monotonic - previous.monotonic
      const wallElapsed = next.wall.getTime() - previous.wall.getTime()
      // Date is integer milliseconds, whereas performance.now() has fractions.
      // Allow sampling/rounding jitter but split buckets after a real clock jump.
      const clockChanged = elapsed < 0 || wallElapsed < 0 || Math.abs(elapsed - wallElapsed) > 5
      if (clockChanged) segment++
      const active = Math.max(
        0,
        Math.min(elapsed, wallElapsed, interaction + 60_000 - previous.monotonic),
      )
      if (
        previous.scope &&
        previous.foreground &&
        !clockChanged &&
        elapsed > 0 &&
        elapsed <= 5_000 &&
        wallElapsed >= 0 &&
        wallElapsed <= 5_000 &&
        active > 0
      ) {
        const day = studyDay(previous.wall, { dayStartHour: previous.dayStartHour })
        // A day/configuration boundary closes this sample; the next interval starts on its own day.
        if (day === studyDay(next.wall, { dayStartHour: previous.dayStartHour })) {
          const key = `${segment}:${day}:${previous.dayStartHour}:${previous.kind}`
          const prior = rows.get(key)
          const row: StudyActivity = {
            id: prior?.id ?? `activity:${session}:${++sequence}`,
            kind: previous.kind,
            studyDay: day,
            startedAt: prior?.startedAt ?? previous.wall.toISOString(),
            endedAt: next.wall.toISOString(),
            activeMs: (prior?.activeMs ?? 0) + Math.floor(active),
          }
          rows.set(key, row)
          dirty.add(key)
        }
      }
    }
    if (interacted) interaction = next.monotonic
    previous = next
  }
  return {
    sample,
    status(now: number) {
      return {
        foreground: previous?.foreground ?? false,
        studying: !!previous && previous.kind !== 'other',
        idleMs: Math.max(0, now - interaction),
      }
    },
    pending() {
      return [...dirty].map((key) => rows.get(key)!)
    },
    acknowledge(saved: StudyActivity[]) {
      const values = new Set(saved)
      for (const key of dirty) if (values.has(rows.get(key)!)) dirty.delete(key)
    },
  }
}
