import { describe, expect, it } from 'vitest'
import { input, fixture, now } from './test-fixtures'
import { saveNote, localDay } from './model'
import {
  blockedByLimit,
  changeCards,
  dailyUsage,
  dueCards,
  intervalLabel,
  previewReview,
  reviewCard,
  undoReview,
  weekActivity,
} from './scheduler'

describe('review scheduling and undo', () => {
  it.each([1, 2, 3, 4] as const)(
    'records the previewed schedule for rating %s and undoes it exactly',
    (rating) => {
      const original = fixture()
      const card = original.cards[0]!
      const preview = previewReview(card, now)
      const updated = reviewCard(original, card.id, rating, now)
      expect(updated.cards[0]!.schedule.reps).toBe(1)
      expect(updated.cards[0]!.schedule.due).toBe(preview[rating].card.due.toISOString())
      expect(new Date(updated.cards[0]!.schedule.due).getTime()).toBeGreaterThan(now.getTime())
      expect(updated.reviews[0]).toMatchObject({
        kind: 'new',
        cardId: card.id,
        rating,
        previous: { schedule: card.schedule },
      })
      expect(undoReview(updated)).toEqual(original)
      expect(original.cards[0]!.schedule.reps).toBe(0)
    },
  )
  it('brings a forgotten card back after its learning step, not before', () => {
    const original = fixture()
    const next = reviewCard(original, original.cards[0]!.id, 1, now)
    const due = new Date(next.cards[0]!.schedule.due)
    expect(dueCards(next, new Date(due.getTime() - 1))).toHaveLength(0)
    expect(dueCards(next, due)).toHaveLength(1)
    const second = reviewCard(next, next.cards[0]!.id, 3, due)
    expect(second.reviews[1]!.kind).toBe('learning')
    expect(second.cards[0]!.schedule.reps).toBe(2)
    expect(weekActivity(second, due).at(-1)!.count).toBe(2)
    expect(() => reviewCard(second, second.cards[0]!.id, 3, due)).toThrow('尚未到期')
  })
  it('keeps reverse cards on independent schedules', () => {
    const library = fixture({ type: 'reversed' })
    library.decks[0]!.burySiblings = false
    const first = library.cards[0]!,
      reverse = library.cards[1]!
    const next = reviewCard(library, first.id, 4, now)
    expect(next.cards.find((card) => card.id === reverse.id)).toEqual(reverse)
    expect(dueCards(next, now).map((card) => card.id)).toEqual([reverse.id])
  })
  it('refuses to undo absent or legacy ratings', () => {
    expect(() => undoReview(fixture())).toThrow('没有可撤销')
    const library = fixture()
    const reviewed = reviewCard(library, library.cards[0]!.id, 1, now)
    delete reviewed.reviews[0]!.previous
    expect(() => undoReview(reviewed)).toThrow('旧版')
  })
})

describe('daily limits and availability', () => {
  it('limits new introductions, allows learning steps, refunds undo and resets the next day', () => {
    let library = saveNote(fixture(), { ...input, front: 'Second' }, undefined, false, now)
    library.decks[0]!.newLimit = 1
    expect(dueCards(library, now)).toHaveLength(1)
    expect(blockedByLimit(library, now)).toBe(1)
    const chosen = dueCards(library, now)[0]!
    library = reviewCard(library, chosen.id, 1, now)
    expect(dailyUsage(library, now).get('deck')!.new.size).toBe(1)
    expect(dueCards(library, now)).toHaveLength(0)
    const due = new Date(library.cards.find((card) => card.id === chosen.id)!.schedule.due)
    expect(dueCards(library, due).map((card) => card.id)).toEqual([chosen.id])
    expect(dailyUsage(undoReview(library), now).get('deck')!.new.size).toBe(0)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(dueCards(library, tomorrow)).toHaveLength(2)
  })
  it('limits review cards while relearning bypasses that limit', () => {
    let library = fixture({ type: 'reversed' })
    const yesterday = new Date(now.getTime() - 86400000)
    library.cards = library.cards.map((card) => ({
      ...card,
      schedule: {
        ...previewReview(card, yesterday)[4].card,
        due: now.toISOString(),
        last_review: yesterday.toISOString(),
      },
    }))
    library.decks[0]!.reviewLimit = 1
    const chosen = dueCards(library, now)[0]!
    expect(dueCards(library, now)).toHaveLength(1)
    library = reviewCard(library, chosen.id, 1, now)
    expect(library.reviews[0]!.kind).toBe('review')
    expect(dueCards(library, now)).toHaveLength(0)
    const due = new Date(library.cards.find((card) => card.id === chosen.id)!.schedule.due)
    expect(dueCards(library, due).map((card) => card.id)).toEqual([chosen.id])
  })
  it('applies limits per deck, including a zero limit', () => {
    let library = fixture()
    library.decks[0]!.newLimit = 0
    library.decks.push({ ...library.decks[0]!, id: 'second', name: 'Second', newLimit: 1 })
    library = saveNote(library, { ...input, deckId: 'second' }, undefined, false, now)
    expect(dueCards(library, now, 'deck')).toHaveLength(0)
    expect(dueCards(library, now).map((card) => card.deckId)).toEqual(['second'])
  })
  it('burying expires at local midnight and suspension persists until resumed', () => {
    const library = fixture()
    const id = library.cards[0]!.id
    const tonight = new Date(2026, 10, 1, 23, 59)
    const tomorrow = new Date(2026, 10, 2, 0, 1)
    const buried = changeCards(library, new Set([id]), 'bury', tonight)
    expect(buried.cards[0]!.buriedOn).toBe(localDay(tonight))
    expect(dueCards(buried, tonight)).toHaveLength(0)
    expect(dueCards(buried, tomorrow)).toHaveLength(1)
    const suspended = changeCards(buried, new Set([id]), 'suspend', tonight)
    expect(dueCards(suspended, tomorrow)).toHaveLength(0)
    expect(dueCards(changeCards(suspended, new Set([id]), 'resume'), tomorrow)).toHaveLength(1)
    expect(suspended.cards[0]!.schedule).toEqual(library.cards[0]!.schedule)
  })
  it('shows non-zero readable intervals', () => {
    expect(intervalLabel(now, now)).toBe('1分钟')
    expect(intervalLabel(new Date(now.getTime() + 86400000), now)).toBe('1天')
  })
})
