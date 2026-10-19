import type { Component } from 'vue'
import type { CardView, Grade, Media } from '../core/model'
import type { Assessment } from './data'
import type { Practice, Attempt, AttemptRecord } from '../core/practice-data'

export interface QuestionState {
  allowedGrades: Grade[]
  suggestedGrade?: Grade
  assessment?: Assessment
  practiceId?: string
  busy: boolean
  /** Called only after a rating has been saved successfully. */
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
/** Question/answer receive QuestionProps; an optional editor uses a NoteInput v-model. */
export interface QuestionPlugin {
  id: string
  kind: 'frontend' | 'local'
  label: string
  version: number
  showQuestion: Component
  showAnswer: Component
  editor?: Component
  description?: string
  settings?: Component
  /** Read-only practice history. Receives PracticeHistoryProps. */
  history?: Component
}

/** Installed by the deployment, then optionally enabled by each browser. */
export interface PluginInstallation {
  plugin: QuestionPlugin
  enabledByDefault?: boolean
  builtin?: boolean
}

/** Browser editions cannot install desktop local plugins. */
export type FrontendPlugin = QuestionPlugin & { kind: 'frontend' }
export type FrontendPluginInstallation = Omit<PluginInstallation, 'plugin'> & {
  plugin: FrontendPlugin
}
