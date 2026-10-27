import type { Component, DeepReadonly, Ref } from 'vue'

export type Grade = 1 | 2 | 3 | 4
export interface PluginData {
  id: string
  version: number
  data: Record<string, unknown>
}
export interface NoteInput {
  deckId: string
  type: 'basic' | 'reversed' | 'cloze' | 'plugin'
  format?: 'plain' | 'markdown'
  front: string
  back: string
  tags: string[]
  frontMedia: string[]
  backMedia: string[]
  plugin?: PluginData
  excerpt?: { sourceId: string; mediaId: string; start: number; end: number; quote: string }
}
export interface CardView extends Omit<NoteInput, 'format'> {
  id: string
  noteId: string
  variant: string
  format: 'plain' | 'markdown'
  createdAt: string
  updatedAt: string
}
export interface Media {
  id: string
  name: string
  type: string
  size: number
  createdAt: string
}
export interface Review {
  id: string
  cardId: string
  rating: Grade
  reviewedAt: string
}
export interface Assessment {
  pluginId: string
  mode: 'manual' | 'automatic'
  attempts: number
  elapsedMs: number
  outcome: 'accepted' | 'rejected' | 'unanswered'
  submissionId?: string
  suggestedGrade?: Grade
  answerSeen?: boolean
  ruleVersion?: number
}
export interface Practice {
  id: string
  cardId: string
  contentRevision: string
  question: { front: string; back: string; format: 'plain' | 'markdown'; plugin: PluginData }
  startedAt: string
  answerSeen?: boolean
  completedAt?: string
  completion?: 'review' | 'practice'
  assessment?: Assessment
  rating?: Grade
  reviewId?: string
  ratingUndoneAt?: string
}
export interface JudgeResult {
  outcome: 'accepted' | 'rejected'
  status: string
  runtime: string
  memory: string
  detail: string
}
export interface Attempt {
  id: string
  practiceId: string
  submittedAt: string
  updatedAt: string
  language: string
  code: string
  elapsedMs: number
  status: 'submitting' | 'pending' | 'completed' | 'unknown' | 'failed'
  submissionId?: string
  result?: JudgeResult
}
export interface AttemptSummary extends Omit<Attempt, 'code' | 'result'> {
  code?: never
  result?: Omit<JudgeResult, 'detail'> & { detail?: never }
}
export type AttemptRecord = Attempt | AttemptSummary
export interface QuestionState {
  allowedGrades: Grade[]
  suggestedGrade?: Grade
  assessment?: Assessment
  practiceId?: string
  busy: boolean
  complete?: () => Promise<void>
}
export interface QuestionProps {
  card: CardView
  media: Media[]
  getMedia: (id: string) => Promise<Blob | undefined>
  state: QuestionState
  revealed: boolean
  workspaceScope?: string
  practices?: Practice[]
  attempts?: AttemptRecord[]
  getAttempt?: (id: string, signal?: AbortSignal) => Promise<Attempt>
  saveAttempt?: (practice: Practice, attempt: Attempt, scope: string) => Promise<void>
}
export interface PracticeHistoryProps {
  practices: Practice[]
  attempts: AttemptRecord[]
  getAttempt?: (id: string, signal?: AbortSignal) => Promise<Attempt>
  activeId?: string
  standalone?: boolean
}
export interface ReviewPanelProps {
  card: CardView
  reviews: readonly Review[]
  revealed: boolean
}
export interface QuestionPlugin {
  id: string
  kind: 'frontend' | 'local'
  label: string
  /** Data schema version, independent of the package's semantic version. */
  version: number
  showQuestion: Component
  showAnswer: Component
  editor?: Component
  description?: string
  settings?: Component
  history?: Component
  createLabel?: string
  dispose?: () => void | Promise<void>
}
export interface ReviewPanelPlugin {
  id: string
  kind: 'frontend'
  label: string
  version: number
  description?: string
  reviewPanel: Component
  settings?: Component
  dispose?: () => void | Promise<void>
}
export type FrontendPlugin = (QuestionPlugin | ReviewPanelPlugin) & { kind: 'frontend' }
export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: 1
  dataVersion: number
  kind: 'frontend' | 'local'
  description?: string
  permissions?: { origins?: string[]; secrets?: boolean; files?: boolean }
}
export declare const locale: DeepReadonly<Ref<'en' | 'zh-CN'>>
export declare function t(
  input: string | Error,
  params?: Record<string, string | number | undefined>,
): string
export declare function readSetting(key: string): string | null
export declare function writeSetting(key: string, value: string, onError?: () => void): void
export declare function practiceContentRevision(
  card: Pick<CardView, 'front' | 'back' | 'plugin'>,
): Promise<string>
export declare function hasAttemptBody(value: AttemptRecord): value is Attempt
export declare const MediaList: Component
export declare const CardContent: Component
export declare const PracticeHistory: Component
export declare const AttemptBody: Component
export declare const pluginData: {
  get(id: string, scope: string): Promise<unknown>
  set(id: string, value: unknown | undefined, scope: string): Promise<void>
}
export declare function nativePlugin(operation: string, payload: unknown): Promise<unknown>
export declare function onDispose(stop: () => void): void
export declare const pluginFiles: {
  read(path: string): Promise<string | null>
  write(path: string, value: string): Promise<void>
}
