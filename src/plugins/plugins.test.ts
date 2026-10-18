import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { fixture, now } from '../core/test-fixtures'
import { cardViews, migrateLibrary, saveNote } from '../core/model'
import { reviewCard, undoReview } from '../core/scheduler'
import { exportArchive, parseArchive } from '../core/archive'
import { createRepository } from '../core/storage'
import { questionPlugin } from '.'
import type { Assessment } from './data'

it('preserves unknown plugin data in storage and backups without enabling grading', async () => {
  const plugin = { id: 'future-question', version: 2, data: { title: '题目', items: [1, 2] } }
  const library = fixture({ type: 'plugin', plugin, back: '' })
  expect(cardViews(library)[0]!.plugin).toEqual(plugin)
  expect(questionPlugin(cardViews(library)[0]!).id).toBe('unavailable')
  const repository = createRepository(crypto.randomUUID())
  await repository.save(library, 0)
  repository.close()
  const archive = (await exportArchive(library, async () => undefined))!
  expect((await parseArchive(archive)).library).toEqual(library)
  expect(() => saveNote(library, { ...library.notes[0]!, plugin: undefined })).toThrow()
})

it('migrates v3 content without changing identity, schedule, or media', () => {
  const library = fixture({ type: 'reversed' })
  expect(migrateLibrary({ ...library, version: 3 })).toEqual(library)
  expect(questionPlugin(cardViews(library)[1]!).id).toBe('flashcard')
})

it('keeps assessment evidence with the rating and removes it when undoing', () => {
  const library = fixture()
  const assessment: Assessment = {
    pluginId: 'leetcode',
    mode: 'automatic',
    attempts: 2,
    elapsedMs: 120000,
    outcome: 'accepted',
    submissionId: '123',
    suggestedGrade: 3,
  }
  const reviewed = reviewCard(library, library.cards[0]!.id, 3, now, 'normal', assessment)
  expect(reviewed.reviews.at(-1)?.assessment).toEqual(assessment)
  expect(undoReview(reviewed).reviews).toEqual(library.reviews)
})
