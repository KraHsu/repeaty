import type { Component } from 'vue'
import type { CardView, Grade, Media } from '../core/model'
import type { Assessment } from './data'
import type { Practice, Attempt } from '../core/practice-data'

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
  attempts?: Attempt[]
  saveAttempt?: (practice: Practice, attempt: Attempt, scope: string) => Promise<void>
}
/** Each component receives QuestionProps. An optional editor uses a NoteInput v-model. */
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
