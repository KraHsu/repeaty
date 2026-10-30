import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { fixture, now } from './test-fixtures'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { exportArchive, parseArchive } from './archive'
import { noteLifecycle, type RetiredNote } from '../desktop/retirement'
import { createRepository } from './storage'
import { validateRetiredBackup } from './retired-backup'
import { summarizeAttempt } from './practice-data'

function example() {
  const plugin = { id: 'visual-occlusion', version: 1, variants: ['one', 'two'], data: {} }
  const original = fixture({ type: 'plugin', plugin })
  const card = original.cards[0]!,
    note = original.notes[0]!
  const blob = new Blob(['original image bytes'], { type: 'image/png' })
  const media = {
    id: 'retired-image',
    name: 'diagram.png',
    type: 'image/png' as const,
    size: blob.size,
    createdAt: now.toISOString(),
  }
  const retired: RetiredNote = {
    revision: 1,
    note: { ...note, backMedia: [media.id] },
    document: null,
    cards: [{ ...card, suspended: true }],
    reviews: [
      {
        id: 'old-rating',
        cardId: card.id,
        rating: 3,
        reviewedAt: now.toISOString(),
        nextDue: now.toISOString(),
        studyDay: '2026-10-18',
        kind: 'new',
        source: 'normal',
      },
    ],
    practices: [
      {
        id: 'old-practice',
        cardId: card.id,
        contentRevision: 'old-content',
        startedAt: now.toISOString(),
        question: { front: note.front, back: note.back, format: 'plain', plugin },
      },
    ],
    attempts: [
      {
        id: 'old-attempt',
        practiceId: 'old-practice',
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        language: 'javascript',
        code: '/* full retained body */'.repeat(1000),
        elapsedMs: 50,
        status: 'failed',
      },
    ],
    media: [media],
  }
  const library = {
    ...original,
    notes: [{ ...note, plugin: { ...plugin, variants: ['two'] } }],
    cards: original.cards.slice(1),
  }
  return { library, retired, blob }
}

it('JSON and bounded archive parts keep retired variants, full attempts and exclusive media through rekey and restore', async () => {
  const { library, retired, blob } = example()
  const read = async (id: string) => (id === retired.media[0]!.id ? blob : undefined)
  const json = parseBackup(await exportBackup(library, read, [retired]))
  const archive = await parseArchive((await exportArchive(library, read, { retired: [retired] }))!)
  for (const data of [json, archive]) {
    expect(data.retired).toEqual([retired])
    expect(await data.assets[0]!.blob.text()).toBe(await blob.text())
    const copy = rekeyBackup(data)
    const retained = copy.retired![0]!
    expect(retained.cards[0]!.id).toBe(retired.cards[0]!.id)
    expect(retained.attempts[0]!.code).toBe(retired.attempts[0]!.code)
    expect(retained.note!.backMedia[0]).toBe(copy.assets[0]!.meta.id)
    expect(retained.note!.backMedia[0]).not.toBe(retired.media[0]!.id)
    const repo = createRepository(`retired-portable-${crypto.randomUUID()}`, undefined, {
      compactHistory: true,
    })
    try {
      await repo.load()
      await repo.save(copy.library, 0, { assets: copy.assets, retired: copy.retired })
      const stored = await repo.retiredNote(copy.library.notes[0]!.id)
      expect(stored.attempts[0]!.code).toBe(retired.attempts[0]!.code)
      const active = copy.library.notes[0]!
      const next = noteLifecycle(
        copy.library,
        {
          ...active,
          plugin: { ...active.plugin!, variants: ['one', 'two'] },
          backMedia: retained.note!.backMedia,
        },
        active.id,
        stored,
        true,
      ).library
      await repo.save(next, 1)
      const reopened = await repo.completeLibrary()
      expect(reopened.cards.find((card) => card.variant === 'plugin:one')).toEqual(retired.cards[0])
      expect(reopened.reviews).toEqual(retired.reviews)
      expect(reopened.attempts).toEqual(retired.attempts)
    } finally {
      await repo.close()
    }
  }
})

it('rejects conflicting active identities, missing attempt bodies and conflicting media metadata', () => {
  const { library, retired } = example()
  expect(() =>
    validateRetiredBackup(library, [{ ...retired, cards: [library.cards[0]!] }]),
  ).toThrow()
  expect(() =>
    validateRetiredBackup(library, [
      { ...retired, attempts: retired.attempts.map(summarizeAttempt) },
    ]),
  ).toThrow()
  expect(() =>
    validateRetiredBackup({ ...library, media: [{ ...retired.media[0]!, size: 1 }] }, [retired]),
  ).toThrow()
})
