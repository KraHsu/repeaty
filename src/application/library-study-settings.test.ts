import { beforeEach, describe, expect, it, vi } from 'vitest'
import { default_w } from 'ts-fsrs'
import type { StudyTrainingSnapshot } from '@repeaty/plugin-api'
import type { LibraryContext, CommitOptions } from './library-context'
import type { Library } from '../core/model'
import { fixture } from '../core/test-fixtures'
import { fsrsModelSchema } from '../core/study-data'
import { studySettings, studySettingsSchema } from '../core/study-settings'
import { evaluateCandidate } from '../core/fsrs-training'
import { createStudySettingsCommands } from './library-study-settings'
import { createStudyCommands } from './library-study'
import type { StudyPluginIdentity } from '../plugins/study'

const scores = { baseline: { logLoss: 0.7, rmse: 0.3 }, candidate: { logLoss: 0.6, rmse: 0.2 } }
// Real fingerprinting and validation, but the expensive data/optimizer boundary
// is mocked here; core/fsrs-training.test.ts verifies actual replay separately.
vi.mock('../core/fsrs-training', async (original) => {
  const actual = await original<typeof import('../core/fsrs-training')>()
  return {
    ...actual,
    trainingSnapshot: vi.fn(
      async (
        library: Library,
        context: { workspaceScope: string; deckId?: string; signal?: AbortSignal },
      ): Promise<StudyTrainingSnapshot> => ({
        token: crypto.randomUUID(),
        workspaceScope: context.workspaceScope,
        fingerprint: await actual.trainingFingerprint(library, context.deckId, context.signal),
        deckId: context.deckId,
        modelVersion: 'FSRS-6',
        weights: [...default_w],
        baselineModelId:
          library.decks.find((deck) => deck.id === context.deckId)?.activeFsrsModelId ??
          studySettings(library).activeFsrsModelId,
        baselineSelectionId: context.deckId
          ? library.decks.find((deck) => deck.id === context.deckId)?.activeFsrsModelId
          : studySettings(library).activeFsrsModelId,
        retention: 0.9,
        maximumInterval: 36500,
        enableShortTerm: true,
        dayStartHour: 0,
        createdAt: new Date().toISOString(),
        cutoff: '2025-01-01T00:00:00.000Z',
        counts: { reviews: 1440, cards: 160, training: 960, validation: 320, excluded: 0 },
        histories: [],
      }),
    ),
    evaluateCandidate: vi.fn(async () => scores),
  }
})
beforeEach(() => vi.clearAllMocks())

function setup() {
  const library = { value: fixture() },
    scope = { value: 'workspace-1' },
    ready = { value: true }
  const controller = new AbortController(),
    listeners = new Set<() => void>()
  let beforeCommit: (() => void | Promise<void>) | undefined
  const commit = vi.fn(
    async (update: (library: Library) => Library | Promise<Library>, _options?: CommitOptions) => {
      const hook = beforeCommit
      beforeCommit = undefined
      await hook?.()
      library.value = await update(library.value)
    },
  )
  const context = {
    library,
    scope,
    ready,
    commit,
    revision: 1,
    canReviewCard: () => true,
  } as unknown as LibraryContext
  const owner: StudyPluginIdentity = {
    pluginId: 'optimizer',
    scope: scope.value,
    signal: controller.signal,
    assertCurrent() {
      if (scope.value !== owner.scope) throw new Error('stale-workspace-session')
    },
  }
  const environment = {
    activity: () => ({ foreground: true, studying: false, idleMs: 30000 }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const commands = createStudySettingsCommands(context),
    api = commands.studyApi(owner, environment)
  return {
    library,
    scope,
    ready,
    commit,
    controller,
    owner,
    environment,
    commands,
    api,
    context,
    beforeCommit(fn: () => void | Promise<void>) {
      beforeCommit = fn
    },
  }
}
async function submit(api: ReturnType<typeof setup>['api'], deckId?: string) {
  const snapshot = await api.trainingSnapshot({ deckId })
  const model = await api.submitCandidate({
    token: snapshot.token,
    weights: [...default_w],
    engine: 'test-engine',
  })
  return { snapshot, model }
}
function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('model transaction boundary', () => {
  it('saves a candidate without activating or rewriting card schedules/reviews', async () => {
    const { api, library, commit } = setup(),
      before = JSON.stringify({ cards: library.value.cards, reviews: library.value.reviews })
    const { snapshot, model } = await submit(api)
    expect(library.value.fsrsModels.map((entry) => entry.id)).toEqual([model.id])
    expect(studySettings(library.value).activeFsrsModelId).toBeUndefined()
    expect(JSON.stringify({ cards: library.value.cards, reviews: library.value.reviews })).toBe(
      before,
    )
    expect(model.metrics).toEqual(scores)
    expect(commit).toHaveBeenCalledOnce()
    await expect(
      api.submitCandidate({ token: snapshot.token, weights: [...default_w], engine: 'test' }),
    ).rejects.toThrow('expired-training-snapshot')
  })
  it('does not let another plugin instance submit an owned snapshot', async () => {
    const { api, commands, owner, environment, commit } = setup(),
      snapshot = await api.trainingSnapshot()
    const other = commands.studyApi({ ...owner }, environment)
    await expect(
      other.submitCandidate({ token: snapshot.token, weights: [...default_w], engine: 'test' }),
    ).rejects.toThrow('expired-training-snapshot')
    expect(commit).not.toHaveBeenCalled()
  })
  it('allows at most one submission for a token even during evaluation', async () => {
    const { api, commit } = setup(),
      snapshot = await api.trainingSnapshot(),
      gate = pending<typeof scores>()
    vi.mocked(evaluateCandidate).mockReturnValueOnce(gate.promise)
    const first = api.submitCandidate({
      token: snapshot.token,
      weights: [...default_w],
      engine: 'test',
    })
    await vi.waitFor(() => expect(evaluateCandidate).toHaveBeenCalledOnce())
    await expect(
      api.submitCandidate({ token: snapshot.token, weights: [...default_w], engine: 'test' }),
    ).rejects.toThrow('training-submission-in-progress')
    gate.resolve(scores)
    await first
    expect(commit).toHaveBeenCalledOnce()
  })
  it('enforces the snapshot cap for concurrent preparations', async () => {
    const { api } = setup()
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => api.trainingSnapshot()),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(8)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(4)
  })
  it('discarding a snapshot prevents a pending submission from being committed', async () => {
    const { api, library } = setup(),
      snapshot = await api.trainingSnapshot(),
      gate = pending<typeof scores>()
    vi.mocked(evaluateCandidate).mockReturnValueOnce(gate.promise)
    const submitted = api.submitCandidate({
      token: snapshot.token,
      weights: [...default_w],
      engine: 'test',
    })
    const failed = expect(submitted).rejects.toThrow('expired-training-snapshot')
    await vi.waitFor(() => expect(evaluateCandidate).toHaveBeenCalledOnce())
    api.discardTraining(snapshot.token)
    gate.resolve(scores)
    await failed
    expect(library.value.fsrsModels).toHaveLength(0)
  })
  it.each(['caller', 'plugin', 'workspace'])(
    'rejects late evaluation after %s cancellation',
    async (kind) => {
      const { api, library, controller, scope } = setup(),
        signal = new AbortController(),
        snapshot = await api.trainingSnapshot(),
        gate = pending<typeof scores>()
      vi.mocked(evaluateCandidate).mockReturnValueOnce(gate.promise)
      const submitted = api.submitCandidate(
        { token: snapshot.token, weights: [...default_w], engine: 'test' },
        signal.signal,
      )
      const failed = expect(submitted).rejects.toThrow()
      await vi.waitFor(() => expect(evaluateCandidate).toHaveBeenCalledOnce())
      if (kind === 'caller') signal.abort()
      else if (kind === 'plugin') controller.abort()
      else scope.value = 'workspace-2'
      gate.resolve(scores)
      await failed
      expect(library.value.fsrsModels).toHaveLength(0)
    },
  )
  it('rechecks the fingerprint inside the serialized write and before activation', async () => {
    const { api, library, beforeCommit } = setup(),
      snapshot = await api.trainingSnapshot()
    beforeCommit(() => {
      library.value = {
        ...library.value,
        studySettings: [studySettingsSchema.parse({ dayStartHour: 4 })],
      }
    })
    await expect(
      api.submitCandidate({ token: snapshot.token, weights: [...default_w], engine: 'test' }),
    ).rejects.toThrow('stale-training-history')
    expect(library.value.fsrsModels).toHaveLength(0)
    const { model } = await submit(api)
    library.value.studySettings[0]!.maxIntervalDays = 400
    await expect(
      api.activateModel({ modelId: model.id, workspaceScope: 'workspace-1' }),
    ).rejects.toThrow('stale-training-history')
    expect(studySettings(library.value).activeFsrsModelId).toBeUndefined()
  })
  it('allows a background statistic flush without expiring the fixed snapshot', async () => {
    const { api, commands, library } = setup(),
      snapshot = await api.trainingSnapshot()
    await commands.beginStudyStatistics('workspace-1', new Date('2026-01-01T00:00:00Z'))
    await commands.recordStudyActivity(
      [
        {
          id: 'activity',
          kind: 'other',
          studyDay: '2026-01-01',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:01:00.000Z',
          activeMs: 60000,
        },
      ],
      'workspace-1',
    )
    const model = await api.submitCandidate({
      token: snapshot.token,
      weights: [...default_w],
      engine: 'test',
    })
    await api.activateModel({ modelId: model.id, workspaceScope: 'workspace-1' })
    expect(studySettings(library.value).activeFsrsModelId).toBe(model.id)
    expect(library.value.studyActivity).toHaveLength(1)
  })
  it('rolls a deck back to inheritance and a library back to its previous explicit model', async () => {
    const { api, library } = setup(),
      before = JSON.stringify(library.value.cards)
    const first = (await submit(api)).model
    await api.activateModel({ modelId: first.id, workspaceScope: 'workspace-1' })
    const second = (await submit(api)).model
    await api.activateModel({ modelId: second.id, workspaceScope: 'workspace-1' })
    const deck = (await submit(api, 'deck')).model
    expect(deck.baselineSelectionId).toBeUndefined()
    expect(deck.baselineModelId).toBe(second.id)
    await api.activateModel({ modelId: deck.id, workspaceScope: 'workspace-1' })
    await api.rollbackModel({
      deckId: 'deck',
      expectedActiveModelId: deck.id,
      workspaceScope: 'workspace-1',
    })
    expect(library.value.decks[0]!.activeFsrsModelId).toBeUndefined()
    expect(studySettings(library.value).activeFsrsModelId).toBe(second.id)
    await api.rollbackModel({ expectedActiveModelId: second.id, workspaceScope: 'workspace-1' })
    expect(studySettings(library.value).activeFsrsModelId).toBe(first.id)
    await expect(
      api.rollbackModel({ expectedActiveModelId: second.id, workspaceScope: 'workspace-1' }),
    ).rejects.toThrow('stale-fsrs-model')
    expect(JSON.stringify(library.value.cards)).toBe(before)
  })
  it('does not let ordinary settings overwrite the active model or statistics coverage', async () => {
    const { api, commands, library } = setup(),
      model = (await submit(api)).model
    await api.activateModel({ modelId: model.id, workspaceScope: 'workspace-1' })
    await commands.beginStudyStatistics('workspace-1', new Date('2026-01-01T00:00:00Z'))
    await commands.saveStudySettings(
      studySettingsSchema.parse({
        activeFsrsModelId: 'forged',
        statisticsSince: '2030-01-01T00:00:00.000Z',
        dayStartHour: 4,
      }),
      'workspace-1',
    )
    expect(studySettings(library.value)).toMatchObject({
      activeFsrsModelId: model.id,
      statisticsSince: '2026-01-01T00:00:00.000Z',
      dayStartHour: 4,
    })
  })
  it('returns detached model data and rejects a wrong library scope', async () => {
    const { api, library } = setup(),
      model = (await submit(api)).model
    const state = await api.trainingState()
    state.models[0]!.weights[0] = 100
    expect(library.value.fsrsModels[0]!.weights[0]).not.toBe(100)
    await expect(api.activateModel({ modelId: model.id, workspaceScope: 'other' })).rejects.toThrow(
      'stale-workspace-session',
    )
    expect(fsrsModelSchema.safeParse(library.value.fsrsModels[0]).success).toBe(true)
  })
})

describe('plain practice metadata', () => {
  it('records once, undoes idempotently, and leaves scheduling/history untouched', async () => {
    const { context, library, commit } = setup(),
      commands = createStudyCommands(context),
      cardId = library.value.cards[0]!.id
    const before = JSON.stringify({ cards: library.value.cards, reviews: library.value.reviews })
    await commands.recordPlainPractice('practice-1', cardId, 'workspace-1')
    await commands.recordPlainPractice('practice-1', cardId, 'workspace-1')
    expect(library.value.studyEvents).toHaveLength(1)
    expect(library.value.studyEvents[0]).toMatchObject({
      id: 'practice-1',
      cardId,
      kind: 'practice',
    })
    await commands.undoPlainPractice('practice-1', 'workspace-1')
    await commands.undoPlainPractice('practice-1', 'workspace-1')
    expect(library.value.studyEvents).toHaveLength(0)
    expect(JSON.stringify({ cards: library.value.cards, reviews: library.value.reviews })).toBe(
      before,
    )
    expect(
      commit.mock.calls.every(
        (call) => call[1]?.backgroundMetadata && call[1]?.undoLabel === false,
      ),
    ).toBe(true)
  })
  it('rejects a reused operation identity and stale scopes', async () => {
    const { context, library, scope } = setup(),
      commands = createStudyCommands(context),
      cardId = library.value.cards[0]!.id
    library.value.studyEvents.push({
      id: 'same',
      kind: 'reading',
      sourceId: 'source',
      occurredAt: '2026-01-01T00:00:00.000Z',
      studyDay: '2026-01-01',
    })
    await expect(commands.recordPlainPractice('same', cardId, 'workspace-1')).rejects.toThrow(
      'practice-identity-conflict',
    )
    await commands.undoPlainPractice('same', 'workspace-1')
    expect(library.value.studyEvents).toHaveLength(1)
    scope.value = 'workspace-2'
    await expect(commands.recordPlainPractice('new', cardId, 'workspace-1')).rejects.toThrow(
      'stale-workspace-session',
    )
    await expect(commands.undoPlainPractice('same', 'workspace-1')).rejects.toThrow(
      'stale-workspace-session',
    )
  })
})
