import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { desktopEdition } from '../edition'
import { fixture, now } from '../core/test-fixtures'
import { cardViews, migrateLibrary, saveNote } from '../core/model'
import { dueCards, reviewCard, undoReview } from '../core/scheduler'
import { exportArchive, parseArchive } from '../core/archive'
import { createRepository } from '../core/storage'
import {
  questionPlugin,
  canReviewCard,
  setPluginEnabled,
  pluginEnabled,
  restorePluginPreferences,
  enabledEditorPlugins,
} from '.'
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

it('excludes unavailable plugins before applying daily quotas', () => {
  let library = fixture({ type: 'plugin', plugin: { id: 'unavailable', version: 1, data: {} } })
  library = saveNote(
    library,
    {
      ...library.notes[0]!,
      type: 'basic',
      plugin: undefined,
      front: 'Available card',
      back: 'Answer',
    },
    undefined,
    false,
    new Date(now.getTime() + 1),
  )
  library.decks[0]!.newLimit = 1
  const queue = dueCards(library, new Date(now.getTime() + 2), undefined, canReviewCard)
  expect(queue.map((card) => card.front)).toEqual(['Available card'])
  expect(
    reviewCard(
      library,
      queue[0]!.id,
      3,
      new Date(now.getTime() + 2),
      'normal',
      undefined,
      canReviewCard,
    ).reviews,
  ).toHaveLength(1)
  expect(library.cards[0]!.schedule.reps).toBe(0)
})

it.runIf(desktopEdition)(
  'persists plugin switches without changing stored notes or review progress',
  () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    try {
      restorePluginPreferences()
      const library = fixture({ type: 'plugin', plugin: { id: 'leetcode', version: 1, data: {} } })
      const before = JSON.stringify(library)
      expect(canReviewCard(cardViews(library)[0]!)).toBe(true)
      setPluginEnabled('leetcode', false)
      expect(enabledEditorPlugins.value).toHaveLength(0)
      expect(canReviewCard(cardViews(library)[0]!)).toBe(false)
      restorePluginPreferences()
      expect(pluginEnabled('leetcode')).toBe(false)
      setPluginEnabled('leetcode', true)
      expect(canReviewCard(cardViews(library)[0]!)).toBe(true)
      expect(JSON.stringify(library)).toBe(before)
      setPluginEnabled('flashcard', false)
      expect(pluginEnabled('flashcard')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      restorePluginPreferences()
    }
  },
)
