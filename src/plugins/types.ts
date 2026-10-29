import type { Component } from 'vue'
import type { CardView, Grade, Media, Review } from '../core/model'
import type { Assessment } from './data'
import type { Practice, Attempt, AttemptRecord } from '../core/practice-data'
import type { PluginSettingsContribution } from './settings'
import type { PluginPageContribution } from './pages'
export type { PluginPageContribution, RegisterPluginPage } from './pages'
import type { PluginWidgetContribution } from './widgets'
import type {
  MaterialImporterContribution,
  MaterialReaderContribution,
  MaterialCommandContribution,
  MaterialSearchProviderContribution,
} from './materials'
export type {
  PluginWidgetContribution,
  PluginWidgetPlacement,
  RegisterPluginWidget,
} from './widgets'
export type {
  PluginSettingField,
  PluginSettingsContribution,
  RegisterPluginSettings,
} from './settings'

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
  /** @deprecated Register contributions through registerSettings instead. */
  settings?: Component
  /** Read-only practice history. Receives PracticeHistoryProps. */
  history?: Component
  createLabel?: string
  dispose?: () => void | Promise<void>
}

export interface ReviewPanelProps {
  card: CardView
  reviews: readonly Review[]
  revealed: boolean
}
/** Frontend-only review decorations do not create or judge a question type. */
export interface ReviewPanelPlugin {
  id: string
  kind: 'frontend'
  label: string
  version: number
  description?: string
  reviewPanel: Component
  /** @deprecated Register contributions through registerSettings instead. */
  settings?: Component
  dispose?: () => void | Promise<void>
}
/** An extension plugin registers at least one page, widget, or material contribution. */
export interface ExtensionPlugin {
  type: 'extension'
  id: string
  kind: 'frontend' | 'local'
  label: string
  version: number
  description?: string
  dispose?: () => void | Promise<void>
}
export type PluginDefinition = QuestionPlugin | ReviewPanelPlugin | ExtensionPlugin
export function isQuestionPlugin(plugin: PluginDefinition): plugin is QuestionPlugin {
  return 'showQuestion' in plugin
}

/** Installed by the deployment, then optionally enabled by each browser. */
export interface PluginInstallation {
  plugin: PluginDefinition
  /** Changes on every runtime activation; views use it to discard replaced component state. */
  instanceId?: string
  settings?: readonly PluginSettingsContribution[]
  pages?: readonly PluginPageContribution[]
  widgets?: readonly PluginWidgetContribution[]
  importers?: readonly MaterialImporterContribution[]
  readers?: readonly MaterialReaderContribution[]
  commands?: readonly MaterialCommandContribution[]
  searchProviders?: readonly MaterialSearchProviderContribution[]
  enabledByDefault?: boolean
  builtin?: boolean
}

/** Browser editions cannot install desktop local plugins. */
export type FrontendPlugin = PluginDefinition & { kind: 'frontend' }
export type FrontendPluginInstallation = Omit<PluginInstallation, 'plugin'> & {
  plugin: FrontendPlugin
}
