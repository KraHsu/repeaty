import { expect, it } from 'vitest'
import { fixture, input, now } from './test-fixtures'
import { saveNote } from './model'
import { applyNewCardBalance, previewNewCardBalance } from './new-card-balance'
import { studySettingsSchema } from './study-settings'
import { scheduledStudyDayStart } from './study-day'
import { changeCards, reviewCard } from './scheduler'

function sample(count: number) {
  let library = fixture()
  for (let index = 1; index < count; index++)
    library = saveNote(library, { ...input, front: `Card ${index}` }, undefined, false, now)
  library.studySettings = [studySettingsSchema.parse({ dayStartHour: 4 })]
  library.decks[0]!.burySiblings = false
  return library
}
it('previews a balanced future window and only changes the requested unreviewed due dates on commit', () => {
  const library = sample(7)
  library.decks[0]!.newLimit = 3
  const before = structuredClone(library)
  const plan = previewNewCardBalance(
    library,
    { ids: library.cards.map((card) => card.id), windowDays: 3 },
    now,
  )
  expect(library).toEqual(before)
  expect(plan.days.map((day) => day.added)).toEqual([3, 2, 2])
  expect(plan.unallocated).toEqual([])
  for (const [index, day] of plan.days.entries())
    expect(day.due).toBe(
      scheduledStudyDayStart(now, index + 1, library.studySettings[0]).toISOString(),
    )
  const result = applyNewCardBalance(library, plan, now)
  for (const card of result.cards) {
    const original = library.cards.find((entry) => entry.id === card.id)!
    expect(card.schedule).toEqual({
      ...original.schedule,
      due: plan.assignments.find((entry) => entry.cardId === card.id)!.due,
    })
  }
  expect(result.notes).toBe(library.notes)
  expect(result.reviews).toBe(library.reviews)
  expect(result.practices).toBe(library.practices)
  expect(result.sources).toBe(library.sources)
  expect(() => applyNewCardBalance(result, plan, now)).toThrow('重新预览')
})
it('accounts for existing scheduled work while respecting each deck new-card limit', () => {
  const library = sample(5)
  library.decks[0]!.newLimit = 1
  const existing = library.cards[0]!
  existing.schedule.due = scheduledStudyDayStart(now, 1, library.studySettings[0]).toISOString()
  existing.schedule.state = 2
  existing.schedule.reps = 2
  const ids = library.cards.slice(1).map((card) => card.id)
  const plan = previewNewCardBalance(library, { ids, windowDays: 3 }, now)
  expect(plan.days.map((day) => day.existing)).toEqual([1, 0, 0])
  expect(plan.assignments.map((entry) => entry.due)).toEqual([
    plan.days[1]!.due,
    plan.days[2]!.due,
    plan.days[0]!.due,
  ])
  expect(plan.unallocated).toHaveLength(1)
  expect(() => applyNewCardBalance(library, plan, now)).toThrow('额度不足')
  const complete = previewNewCardBalance(library, { ids, windowDays: 4 }, now)
  expect(applyNewCardBalance(library, complete, now).cards[0]).toBe(existing)
})
it('rejects changed inputs, stale days and forged assignments without partial changes', () => {
  const library = sample(3)
  const ids = library.cards.map((card) => card.id)
  const plan = previewNewCardBalance(library, { ids }, now)
  const alteredDue = structuredClone(plan)
  alteredDue.assignments[0]!.due = '2099-01-01T00:00:00.000Z'
  expect(() => applyNewCardBalance(library, alteredDue, now)).toThrow('重新预览')
  const changed = structuredClone(library)
  changed.decks[0]!.newLimit++
  expect(() => applyNewCardBalance(changed, plan, now)).toThrow('重新预览')
  expect(() =>
    applyNewCardBalance(library, plan, scheduledStudyDayStart(now, 1, library.studySettings[0])),
  ).toThrow('重新预览')
  const settingsChanged = structuredClone(library)
  settingsChanged.studySettings[0]!.dayStartHour = 3
  expect(() => applyNewCardBalance(settingsChanged, plan, now)).toThrow('重新预览')
  expect(library.cards.every((card) => card.schedule.due === now.toISOString())).toBe(true)
})
it('refuses suspended, buried, reviewed, duplicate or missing cards and counts introductions today', () => {
  const library = sample(3)
  const id = library.cards[0]!.id
  for (const action of ['suspend', 'bury'] as const)
    expect(() =>
      previewNewCardBalance(changeCards(library, new Set([id]), action, now), { ids: [id] }, now),
    ).toThrow()
  for (const ids of [[], [id, id], ['missing']])
    expect(() => previewNewCardBalance(library, { ids }, now)).toThrow()
  const reviewed = reviewCard(library, id, 3, now)
  expect(() => previewNewCardBalance(reviewed, { ids: [id] }, now)).toThrow()
  reviewed.decks[0]!.newLimit = 1
  const plan = previewNewCardBalance(
    reviewed,
    { ids: reviewed.cards.slice(1).map((card) => card.id), startOffsetDays: 0, windowDays: 1 },
    now,
  )
  expect(plan.assignments).toEqual([])
  expect(plan.unallocated).toHaveLength(2)
  expect(() => applyNewCardBalance(reviewed, plan, now)).toThrow('额度不足')
})
