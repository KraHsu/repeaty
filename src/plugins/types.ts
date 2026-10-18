import type { Component } from 'vue'
import type { CardView, Grade, Media } from '../core/model'
import type { Assessment } from './data'

export interface QuestionState {
  allowedGrades: Grade[]
  suggestedGrade?: Grade
  assessment?: Assessment
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
}
/** Each component receives QuestionProps. An optional editor uses a NoteInput v-model. */
export interface QuestionPlugin {
  id: string
  kind: 'frontend' | 'backend'
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
