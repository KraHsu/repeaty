import type { StudyHostApi, StudyActivityStatus, StudyTrainingSnapshot } from '@repeaty/plugin-api'
import type { LibraryContext } from './library-context'
import type { StudyPluginIdentity } from '../plugins/study'
import {
  studySettings,
  studySettingsSchema,
  studyPrioritySchema,
  type StudySettings,
} from '../core/study-settings'
import { studyActivitySchema, fsrsModelSchema, type StudyActivity } from '../core/study-data'
import {
  previewNewCardBalance,
  applyNewCardBalance,
  type NewCardBalanceOptions,
  type NewCardBalancePlan,
} from '../core/new-card-balance'
import { studyStatistics, studyStatisticsDetails } from '../core/study-statistics'
import {
  trainingSnapshot,
  trainingFingerprint,
  evaluateCandidate,
  validateTrainingWeights,
} from '../core/fsrs-training'

export interface StudyEnvironment {
  activity(): StudyActivityStatus
  subscribe(listener: () => void): () => void
}

export function createStudySettingsCommands(context: LibraryContext) {
  const { library, scope, ready, commit } = context
  function current(expectedScope: string) {
    if (!ready.value || !expectedScope || scope.value !== expectedScope)
      throw new Error('stale-workspace-session')
  }
  const tokens = new Map<
    string,
    {
      snapshot: StudyTrainingSnapshot
      owner: StudyPluginIdentity
      expires: number
      submitting?: boolean
    }
  >()
  let preparing = 0
  return {
    async saveStudySettings(input: StudySettings, expectedScope: string) {
      current(expectedScope)
      const parsed = studySettingsSchema.parse(input)
      await commit(
        (base) => {
          current(expectedScope)
          const previous = studySettings(base)
          return {
            ...base,
            studySettings: [
              {
                ...parsed,
                activeFsrsModelId: previous.activeFsrsModelId,
                statisticsSince: previous.statisticsSince,
              },
            ],
          }
        },
        { undoLabel: '调整学习设置' },
      )
    },
    async setStudyPriority(
      kind: 'deck' | 'note' | 'source' | 'folder',
      id: string,
      value: number | undefined,
      expectedScope: string,
    ) {
      current(expectedScope)
      if (value !== undefined) studyPrioritySchema.parse(value)
      const key = (
        { deck: 'decks', note: 'notes', source: 'sources', folder: 'materialFolders' } as const
      )[kind]
      if (!key) throw new Error('invalid-priority-target')
      await commit(
        (base) => {
          current(expectedScope)
          if (!base[key].some((entry) => entry.id === id))
            throw new Error('missing-priority-target')
          return {
            ...base,
            [key]: base[key].map((entry) =>
              entry.id !== id
                ? entry
                : {
                    ...entry,
                    studyPriority: value,
                    ...(kind === 'source' && value === undefined ? { priority: undefined } : {}),
                  },
            ),
          }
        },
        { undoLabel: '调整学习优先级' },
      )
    },
    previewNewCardBalance(options: NewCardBalanceOptions) {
      current(scope.value)
      return previewNewCardBalance(library.value, options)
    },
    async balanceNewCards(plan: NewCardBalancePlan, expectedScope: string) {
      current(expectedScope)
      const owned = structuredClone(plan)
      await commit(
        (base) => {
          current(expectedScope)
          return applyNewCardBalance(base, owned)
        },
        { undoLabel: '均衡安排新卡' },
      )
    },
    async beginStudyStatistics(expectedScope: string, now = new Date()) {
      await context.savingDone
      current(expectedScope)
      if (studySettings(library.value).statisticsSince) return
      await commit(
        (base) => {
          current(expectedScope)
          if (studySettings(base).statisticsSince) return base
          return {
            ...base,
            studySettings: [{ ...studySettings(base), statisticsSince: now.toISOString() }],
          }
        },
        { undoLabel: false, backgroundMetadata: true },
      )
    },
    async recordStudyActivity(input: StudyActivity[], expectedScope: string) {
      await context.savingDone
      current(expectedScope)
      if (input.length > 100) throw new Error('activity-batch-too-large')
      const rows = input.map((entry) => studyActivitySchema.parse(entry))
      await commit(
        (base) => {
          current(expectedScope)
          const updates = new Map(rows.map((entry) => [entry.id, entry]))
          const existing = new Set(base.studyActivity.map((entry) => entry.id))
          const studyActivity = base.studyActivity.map((entry) => {
            const next = updates.get(entry.id)
            if (!next) return entry
            if (
              next.kind !== entry.kind ||
              next.studyDay !== entry.studyDay ||
              next.startedAt !== entry.startedAt
            )
              throw new Error('activity-identity-conflict')
            return next.activeMs >= entry.activeMs && next.endedAt >= entry.endedAt ? next : entry
          })
          studyActivity.push(...rows.filter((entry) => !existing.has(entry.id)))
          if (studyActivity.length > 500_000) throw new Error('activity-limit')
          return { ...base, studyActivity }
        },
        { undoLabel: false, backgroundMetadata: true },
      )
    },
    studyApi(owner: StudyPluginIdentity, environment: StudyEnvironment): StudyHostApi {
      owner.signal.addEventListener(
        'abort',
        () => {
          for (const [key, value] of tokens) if (value.owner === owner) tokens.delete(key)
        },
        { once: true },
      )
      function guard(signal?: AbortSignal) {
        owner.signal.throwIfAborted()
        signal?.throwIfAborted()
        owner.assertCurrent()
        current(owner.scope)
      }
      function effectiveSignal(signal?: AbortSignal) {
        return signal ? AbortSignal.any([owner.signal, signal]) : owner.signal
      }
      function purge() {
        for (const [key, value] of tokens)
          if (
            value.expires < Date.now() ||
            value.owner.signal.aborted ||
            value.owner.scope !== scope.value
          )
            tokens.delete(key)
      }
      const api: StudyHostApi = {
        async statistics(query, signal) {
          guard(signal)
          return studyStatistics(library.value, query, {
            workspaceScope: owner.scope,
            revision: context.revision,
            canReview: context.canReviewCard,
          })
        },
        async statisticsDetails(query, signal) {
          guard(signal)
          return studyStatisticsDetails(library.value, query, {
            workspaceScope: owner.scope,
            revision: context.revision,
            canReview: context.canReviewCard,
          })
        },
        async trainingState(query = {}, signal) {
          guard(signal)
          const base = library.value
          if (query.deckId && !base.decks.some((deck) => deck.id === query.deckId))
            throw new Error('missing-deck')
          const notes = new Map(base.notes.map((note) => [note.id, note.deckId]))
          const cards = new Map(base.cards.map((card) => [card.id, notes.get(card.noteId)]))
          const counts = new Map<string, number>()
          for (const review of base.reviews) {
            const deck = cards.get(review.cardId)
            if (deck) counts.set(deck, (counts.get(deck) ?? 0) + 1)
          }
          const decks = base.decks.map((deck) => ({
            id: deck.id,
            name: deck.name,
            reviewCount: counts.get(deck.id) ?? 0,
          }))
          const globalDecks = new Set(
            base.decks.filter((deck) => !deck.activeFsrsModelId).map((deck) => deck.id),
          )
          return {
            workspaceScope: owner.scope,
            revision: context.revision,
            deckId: query.deckId,
            decks,
            reviewCount: query.deckId
              ? (counts.get(query.deckId) ?? 0)
              : decks
                  .filter((deck) => globalDecks.has(deck.id))
                  .reduce((total, deck) => total + deck.reviewCount, 0),
            activeModelId: query.deckId
              ? base.decks.find((deck) => deck.id === query.deckId)?.activeFsrsModelId
              : studySettings(base).activeFsrsModelId,
            models: structuredClone(
              base.fsrsModels.filter((model) => model.deckId === query.deckId),
            ),
            activity: environment.activity(),
          }
        },
        async trainingSnapshot(query = {}, signal) {
          guard(signal)
          purge()
          if (tokens.size + preparing >= 8) throw new Error('too-many-training-snapshots')
          preparing++
          try {
            const snapshot = await trainingSnapshot(library.value, {
              workspaceScope: owner.scope,
              deckId: query.deckId,
              signal: effectiveSignal(signal),
            })
            guard(signal)
            tokens.set(snapshot.token, {
              snapshot: structuredClone(snapshot),
              owner,
              expires: Date.now() + 30 * 60_000,
            })
            return snapshot
          } finally {
            preparing--
          }
        },
        async submitCandidate(request, signal) {
          guard(signal)
          purge()
          const token = request.token
          const value = tokens.get(token)
          if (!value || value.owner !== owner) throw new Error('expired-training-snapshot')
          function checkToken() {
            guard(signal)
            purge()
            if (tokens.get(token) !== value) throw new Error('expired-training-snapshot')
          }
          if (value.submitting) throw new Error('training-submission-in-progress')
          value.submitting = true
          try {
            const snapshot = value.snapshot
            const weights = validateTrainingWeights(request.weights, snapshot.enableShortTerm)
            const engine = request.engine
            const combined = effectiveSignal(signal)
            if (
              (await trainingFingerprint(library.value, snapshot.deckId, combined)) !==
              snapshot.fingerprint
            )
              throw new Error('stale-training-history')
            const metrics = await evaluateCandidate(snapshot, weights, combined)
            checkToken()
            const model = fsrsModelSchema.parse({
              id: crypto.randomUUID(),
              deckId: snapshot.deckId,
              createdAt: new Date().toISOString(),
              modelVersion: 'FSRS-6',
              weights,
              baselineWeights: snapshot.weights,
              baselineModelId: snapshot.baselineModelId,
              baselineSelectionId: snapshot.baselineSelectionId,
              historyFingerprint: snapshot.fingerprint,
              counts: snapshot.counts,
              metrics,
              engine,
            })
            await commit(
              async (base) => {
                checkToken()
                if (
                  (await trainingFingerprint(base, snapshot.deckId, combined)) !==
                  snapshot.fingerprint
                )
                  throw new Error('stale-training-history')
                checkToken()
                if (base.fsrsModels.length >= 200) throw new Error('fsrs-model-limit')
                return { ...base, fsrsModels: [...base.fsrsModels, model] }
              },
              { undoLabel: '保存个人记忆参数' },
            )
            tokens.delete(token)
            guard(signal)
            return structuredClone(model)
          } finally {
            value.submitting = false
          }
        },
        async activateModel(request, signal) {
          guard(signal)
          if (request.workspaceScope !== owner.scope) throw new Error('stale-workspace-session')
          await commit(
            async (base) => {
              guard(signal)
              const model = base.fsrsModels.find((entry) => entry.id === request.modelId)
              if (!model || (model.deckId && !base.decks.some((deck) => deck.id === model.deckId)))
                throw new Error('missing-fsrs-model')
              if (
                (await trainingFingerprint(base, model.deckId, effectiveSignal(signal))) !==
                model.historyFingerprint
              )
                throw new Error('stale-training-history')
              guard(signal)
              return model.deckId
                ? {
                    ...base,
                    decks: base.decks.map((deck) =>
                      deck.id === model.deckId ? { ...deck, activeFsrsModelId: model.id } : deck,
                    ),
                  }
                : {
                    ...base,
                    studySettings: [{ ...studySettings(base), activeFsrsModelId: model.id }],
                  }
            },
            { undoLabel: '采用个人记忆参数' },
          )
          guard(signal)
        },
        async rollbackModel(request, signal) {
          guard(signal)
          if (request.workspaceScope !== owner.scope) throw new Error('stale-workspace-session')
          await commit(
            (base) => {
              guard(signal)
              const active = request.deckId
                ? base.decks.find((deck) => deck.id === request.deckId)?.activeFsrsModelId
                : studySettings(base).activeFsrsModelId
              const model = base.fsrsModels.find((entry) => entry.id === active)
              if (
                active !== request.expectedActiveModelId ||
                !model ||
                model.deckId !== request.deckId
              )
                throw new Error('stale-fsrs-model')
              const previous = model.baselineSelectionId
              if (
                previous &&
                !base.fsrsModels.some(
                  (entry) => entry.id === previous && entry.deckId === request.deckId,
                )
              )
                throw new Error('missing-baseline-model')
              return request.deckId
                ? {
                    ...base,
                    decks: base.decks.map((deck) =>
                      deck.id === request.deckId ? { ...deck, activeFsrsModelId: previous } : deck,
                    ),
                  }
                : {
                    ...base,
                    studySettings: [{ ...studySettings(base), activeFsrsModelId: previous }],
                  }
            },
            { undoLabel: '回退个人记忆参数' },
          )
          guard(signal)
        },
        discardTraining(token) {
          guard()
          if (tokens.get(token)?.owner === owner) tokens.delete(token)
        },
        activity() {
          guard()
          return { ...environment.activity() }
        },
        subscribe(listener) {
          guard()
          return environment.subscribe(() => {
            if (!owner.signal.aborted && scope.value === owner.scope) {
              guard()
              listener()
            }
          })
        },
      }
      return api
    },
  }
}
