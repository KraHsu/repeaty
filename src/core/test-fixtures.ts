import { emptyLibrary, saveNote, serializeSchedule, type Library, type NoteInput } from './model'
import { createEmptyCard } from 'ts-fsrs'
export const now = new Date('2026-10-17T18:00:00.000Z')
export const input: NoteInput = {
  deckId: 'deck',
  type: 'basic',
  front: 'Question',
  back: 'Answer',
  tags: ['test'],
  frontMedia: [],
  backMedia: [],
}
export function fixture(overrides: Partial<NoteInput> = {}): Library {
  const library = emptyLibrary()
  library.decks.push({
    id: 'deck',
    name: 'Test',
    description: '',
    color: 'sage',
    createdAt: now.toISOString(),
    newLimit: 20,
    burySiblings: true,
    leechThreshold: 8,
    desiredRetention: 0.9,
    reviewLimit: 200,
  })
  return saveNote(library, { ...input, ...overrides }, undefined, false, now)
}
export function legacyFixture() {
  return {
    version: 1,
    decks: [
      { id: 'deck', name: 'Legacy', description: '', color: 'sage', createdAt: now.toISOString() },
    ],
    cards: [
      {
        id: 'old-card',
        deckId: 'deck',
        front: 'Legacy question',
        back: 'Legacy answer',
        tags: ['old'],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        schedule: serializeSchedule(createEmptyCard(now)),
      },
    ],
    reviews: [],
  }
}
