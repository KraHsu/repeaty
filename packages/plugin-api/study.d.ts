import type { Grade } from './index'

export interface StudyStatisticsQuery {
  from: string
  to: string
}
export interface StudyStatisticsCoverage {
  readingsFrom: string | null
  practicesFrom: string | null
  foregroundFrom: string | null
}
export interface StudyStatisticsDay {
  day: string
  reviews: number
  readings: number | null
  practices: number | null
  foregroundMs: number | null
  readingMs: number | null
  reviewMs: number | null
  practiceMs: number | null
  scheduledCards: number
  scheduledReadings: number
}
export interface StudyStatisticsSnapshot extends StudyStatisticsQuery {
  workspaceScope: string
  revision: number
  today: string
  dayStartHour: number
  coverage: StudyStatisticsCoverage
  days: StudyStatisticsDay[]
}
export type StudyStatisticsDetailKind =
  'reviews' | 'readings' | 'practices' | 'scheduledCards' | 'scheduledReadings'
export interface StudyStatisticsDetailsQuery {
  day: string
  kind: StudyStatisticsDetailKind
  offset?: number
  limit?: number
}
export interface StudyStatisticsDetailItem {
  id: string
  title: string
  occurredAt?: string
  dueAt?: string
  rating?: Grade
  cardId?: string
  sourceId?: string
}
export interface StudyStatisticsDetails {
  workspaceScope: string
  revision: number
  day: string
  kind: StudyStatisticsDetailKind
  total: number
  offset: number
  items: StudyStatisticsDetailItem[]
  nextOffset?: number
}
export interface StudyTrainingHistory {
  cardId: string
  ratings: Grade[]
  /** Integer UTC-day gaps matching the scheduler; the first entry is zero. */
  elapsedDays: number[]
  reviewedAt: string[]
}
export interface StudyTrainingCounts {
  reviews: number
  cards: number
  training: number
  validation: number
  excluded: number
}
export interface StudyTrainingSnapshot {
  workspaceScope: string
  token: string
  fingerprint: string
  modelVersion: 'FSRS-6'
  baselineModelId?: string
  baselineSelectionId?: string
  deckId?: string
  weights: number[]
  retention: number
  maximumInterval: number
  enableShortTerm: boolean
  dayStartHour: number
  cutoff: string
  createdAt: string
  counts: StudyTrainingCounts
  histories: StudyTrainingHistory[]
}
export interface StudyModelMetrics {
  logLoss: number
  rmse: number
}
export interface StudyFsrsModel {
  id: string
  deckId?: string
  createdAt: string
  modelVersion: 'FSRS-6'
  weights: number[]
  baselineWeights: number[]
  baselineSelectionId?: string
  baselineModelId?: string
  historyFingerprint: string
  counts: StudyTrainingCounts
  metrics: { baseline: StudyModelMetrics; candidate: StudyModelMetrics }
  engine: string
}
export interface StudyActivityStatus {
  foreground: boolean
  studying: boolean
  idleMs: number
}
export interface StudyTrainingState {
  workspaceScope: string
  revision: number
  deckId?: string
  reviewCount: number
  decks: { id: string; name: string; reviewCount: number }[]
  activeModelId?: string
  models: StudyFsrsModel[]
  activity: StudyActivityStatus
}
/** All writes are scoped, validated host transactions. Workers only propose weights. */
export interface StudyHostApi {
  statistics(query: StudyStatisticsQuery, signal?: AbortSignal): Promise<StudyStatisticsSnapshot>
  statisticsDetails(
    query: StudyStatisticsDetailsQuery,
    signal?: AbortSignal,
  ): Promise<StudyStatisticsDetails>
  trainingState(query?: { deckId?: string }, signal?: AbortSignal): Promise<StudyTrainingState>
  trainingSnapshot(
    query?: { deckId?: string },
    signal?: AbortSignal,
  ): Promise<StudyTrainingSnapshot>
  submitCandidate(
    request: { token: string; weights: number[]; engine: string },
    signal?: AbortSignal,
  ): Promise<StudyFsrsModel>
  activateModel(
    request: { modelId: string; workspaceScope: string },
    signal?: AbortSignal,
  ): Promise<void>
  rollbackModel(
    request: { deckId?: string; expectedActiveModelId: string; workspaceScope: string },
    signal?: AbortSignal,
  ): Promise<void>
  discardTraining(token: string): void
  activity(): StudyActivityStatus
  subscribe(listener: () => void): () => void
}
export declare const study: StudyHostApi
