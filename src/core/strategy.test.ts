import { describe, expect, it } from 'vitest'
import { fixture, now } from './test-fixtures'
import { cardViews, deckSchema, localDay, migrateLibrary, serializeSchedule } from './model'
import {
  available,
  changeCards,
  dueCards,
  previewReview,
  reviewCard,
  undoReview,
  dailyUsage,
} from './scheduler'
import { parseBackup, exportBackup } from './backups'

function matureCard() {
  const library = fixture()
  const card = library.cards[0]!
  const yesterday = new Date(now.getTime() - 86400000)
  card.schedule = serializeSchedule(previewReview(card, yesterday)[4].card)
  card.schedule.due = now.toISOString()
  return library
}
describe('deck learning strategies', () => {
  it('buries all other clozes, leaves schedules intact, expires tomorrow and undoes atomically', () => {
    const original = fixture({ type: 'cloze', front: '{{c1::one}} {{c2::two}} {{c3::three}}' })
    const first = original.cards[0]!
    const updated = reviewCard(original, first.id, 4, now)
    expect(dueCards(updated, now)).toHaveLength(0)
    for (const sibling of updated.cards.slice(1)) {
      expect(sibling.autoBurial?.day).toBe(localDay(now))
      expect(sibling.schedule).toEqual(
        original.cards.find((card) => card.id === sibling.id)!.schedule,
      )
    }
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(available(updated.cards[1]!, tomorrow)).toBe(true)
    expect(undoReview(updated)).toEqual(original)
  })
  it('preserves manual controls across undo and can cancel automatic burying', () => {
    const original = fixture({ type: 'reversed' })
    const sibling = original.cards[1]!.id
    const graded = reviewCard(original, original.cards[0]!.id, 4, now)
    const manuallyBuried = changeCards(graded, new Set([sibling]), 'bury', now)
    const undone = undoReview(manuallyBuried)
    expect(undone.cards[1]!.buriedOn).toBe(localDay(now))
    expect(undone.cards[1]!.autoBurial).toBeUndefined()
    expect(available(undone.cards[1]!, now)).toBe(false)
    const unburied = changeCards(graded, new Set([sibling]), 'unbury', now)
    expect(available(unburied.cards[1]!, now)).toBe(true)
    expect(undoReview(unburied).cards[1]!.autoBurial).toBeUndefined()
  })
  it('marks mature lapses at threshold, supports clearing and undo, ignores new failures', () => {
    const original = matureCard()
    original.decks[0]!.leechThreshold = 2
    original.cards[0]!.schedule.lapses = 1
    const graded = reviewCard(original, original.cards[0]!.id, 1, now)
    expect(graded.cards[0]!.leech).toBe(true)
    expect(graded.cards[0]!.suspended).toBe(false)
    expect(undoReview(graded)).toEqual(original)
    expect(changeCards(graded, new Set([graded.cards[0]!.id]), 'clearLeech').cards[0]!.leech).toBe(
      false,
    )
    original.decks[0]!.leechThreshold = 0
    expect(reviewCard(original, original.cards[0]!.id, 1, now).cards[0]!.leech).toBe(false)
    const fresh = fixture()
    fresh.decks[0]!.leechThreshold = 1
    expect(reviewCard(fresh, fresh.cards[0]!.id, 1, now).cards[0]!.leech).toBe(false)
  })
  it('uses deck retention identically for preview and commit without eagerly rescheduling', () => {
    const original = matureCard(),
      card = original.cards[0]!,
      deck = original.decks[0]!
    const standard = previewReview(card, now, deck)[3].card.due
    deck.desiredRetention = 0.97
    const high = previewReview(card, now, deck)[3].card.due
    expect(high.getTime()).toBeLessThan(standard.getTime())
    const updated = reviewCard(original, card.id, 3, now)
    expect(updated.cards[0]!.schedule.due).toBe(high.toISOString())
    expect(card.schedule.due).toBe(now.toISOString())
    expect(deckSchema.safeParse({ ...deck, desiredRetention: 1 }).success).toBe(false)
  })
  it('filtered reviews allow early/over-quota study, log real progress and remain undoable', () => {
    const original = matureCard(),
      card = original.cards[0]!
    card.schedule.due = new Date(now.getTime() + 86400000 * 10).toISOString()
    original.decks[0]!.reviewLimit = 0
    expect(() => reviewCard(original, card.id, 3, now)).toThrow('尚未到期')
    const updated = reviewCard(original, card.id, 3, now, 'filtered')
    expect(updated.reviews[0]!.source).toBe('filtered')
    expect(dailyUsage(updated, now).get('deck')!.review.size).toBe(1)
    expect(undoReview(updated)).toEqual(original)
    card.suspended = true
    expect(() => reviewCard(original, card.id, 3, now, 'filtered')).toThrow()
  })
})
describe('v2 compatibility', () => {
  it('preserves old literal text, IDs, logs and schedules and fills safe defaults', async () => {
    const current = fixture({ front: '**literal** $5', type: 'reversed' })
    const old = JSON.parse(JSON.stringify(current))
    old.version = 2
    delete old.savedSearches
    for (const deck of old.decks) {
      delete deck.burySiblings
      delete deck.desiredRetention
      delete deck.leechThreshold
    }
    for (const note of old.notes) delete note.format
    for (const card of old.cards) delete card.leech
    const migrated = migrateLibrary(old)
    expect(migrated.version).toBe(10)
    expect(migrated.notes[0]!.format).toBe('plain')
    expect(cardViews(migrated)[0]!.front).toBe('**literal** $5')
    expect(migrated.cards.map((card) => card.schedule)).toEqual(
      current.cards.map((card) => card.schedule),
    )
    expect(migrated.decks[0]).toMatchObject({
      burySiblings: true,
      desiredRetention: 0.9,
      leechThreshold: 8,
    })
    expect(
      parseBackup(
        JSON.stringify({ format: 'repeaty-backup', version: 2, library: old, assets: [] }),
      ).library,
    ).toEqual(migrated)
    expect(parseBackup(await exportBackup(migrated, async () => undefined)).library).toEqual(
      migrated,
    )
    expect(() => migrateLibrary({ ...old, version: '2' })).toThrow()
  })
})
