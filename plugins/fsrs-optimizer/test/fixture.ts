import type { StudyFsrsModel, StudyTrainingSnapshot, StudyTrainingState } from '@repeaty/plugin-api'
import { TRAINING_ENGINE } from '../src/training'

export function snapshot(): StudyTrainingSnapshot {
  return {
    token: 'snapshot-1',
    workspaceScope: 'library-1',
    fingerprint: 'fingerprint-1',
    modelVersion: 'FSRS-6',
    weights: Array(21).fill(0.1),
    retention: 0.9,
    maximumInterval: 36500,
    enableShortTerm: true,
    dayStartHour: 4,
    cutoff: '2025-02-18T04:00:00.000Z',
    createdAt: '2025-03-10T04:00:00.000Z',
    counts: { reviews: 1440, cards: 160, training: 960, validation: 320, excluded: 0 },
    histories: Array.from({ length: 160 }, (_, card) => ({
      cardId: `card-${card}`,
      ratings: Array.from({ length: 9 }, (_, index) =>
        (card + index) % 7 === 0 ? 1 : (card + index) % 11 === 0 ? 2 : 3,
      ),
      elapsedDays: Array.from({ length: 9 }, (_, index) => (index === 0 ? 0 : 7)),
      reviewedAt: Array.from({ length: 9 }, (_, index) =>
        new Date(Date.UTC(2025, 0, 1 + index * 7, 12)).toISOString(),
      ),
    })),
  }
}

export function candidate(): StudyFsrsModel {
  return {
    id: 'model-1',
    createdAt: '2025-03-10T04:00:00.000Z',
    modelVersion: 'FSRS-6',
    weights: Array(21).fill(0.2),
    baselineWeights: Array(21).fill(0.1),
    historyFingerprint: 'fingerprint-1',
    counts: snapshot().counts,
    metrics: { baseline: { logLoss: 0.7, rmse: 0.3 }, candidate: { logLoss: 0.6, rmse: 0.2 } },
    engine: TRAINING_ENGINE,
  }
}

export function state(): StudyTrainingState {
  return {
    workspaceScope: 'library-1',
    revision: 1,
    reviewCount: 1440,
    decks: [{ id: 'deck-1', name: '基础知识', reviewCount: 1440 }],
    models: [],
    activity: { foreground: true, studying: false, idleMs: 30_000 },
  }
}
