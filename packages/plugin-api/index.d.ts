import type { Component, DeepReadonly, DefineComponent, Directive, Ref } from 'vue'

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
  /** @deprecated Register contributions through registerSettings instead. */
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
  /** @deprecated Register contributions through registerSettings instead. */
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
/** Host-rendered controls. Their styling and accessible behavior follow the application. */
export type SettingValue = string | number | boolean | string[]
export type SettingFieldType =
  | 'text'
  | 'password'
  | 'textarea'
  | 'number'
  | 'select'
  | 'radio'
  | 'multiselect'
  | 'range'
  | 'switch'
  | 'checkbox'
export interface SettingOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}
export interface SettingFieldProps {
  id?: string
  type?: SettingFieldType
  label: string
  description?: string
  error?: string
  modelValue: SettingValue
  options?: readonly SettingOption[]
  disabled?: boolean
  readonly?: boolean
  placeholder?: string
  min?: number
  max?: number
  step?: number | 'any'
  unit?: string
  rows?: number
  autocomplete?: string
  autocapitalize?: string
  inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url'
  maxlength?: number
  spellcheck?: boolean
  monospace?: boolean
  /** Change commits are useful when each update is persisted. Range defaults to change. */
  commit?: 'input' | 'change'
  layout?: 'row' | 'stack'
}
export interface SettingsCategory {
  id: string
  title: string
}
/** Values and labels may be reactive getters owned by the contributor. */
export interface SettingsField extends SettingFieldProps {
  key: string
  onChange: (value: SettingValue) => void | Promise<void>
}
export interface SettingsContribution {
  id: string
  title: string
  description?: string
  category?: readonly SettingsCategory[]
  fields?: readonly SettingsField[]
  component?: Component
  error?: string
}
/** Compatibility names retained for plugins built against SDK 1.4. */
export type PluginSettingField = SettingsField
export type PluginSettingsContribution = SettingsContribution
/** Registers with the active plugin instance; unload and scope changes remove the contribution. */
export declare function registerSettings(contribution: SettingsContribution): () => void
export declare const SettingField: DefineComponent<
  SettingFieldProps & { 'onUpdate:modelValue'?: (value: SettingValue) => void }
>
export declare const SettingGroup: DefineComponent<{
  title: string
  description?: string
  level?: 2 | 3
}>
export declare const SettingSection: DefineComponent<{
  title: string
  description?: string
  level?: 3 | 4
}>
export declare const UiNotice: DefineComponent<{
  tone?: 'info' | 'success' | 'warning' | 'error'
  title?: string
}>
export declare const UiStatus: DefineComponent<{
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'busy'
}>
export declare const UiButton: DefineComponent<{
  type?: 'button' | 'submit' | 'reset'
  variant?: UiButtonVariant
  tone?: UiButtonTone
  icon?: boolean
  disabled?: boolean
  busy?: boolean
}>
export declare const UiIconButton: DefineComponent<{
  label: string
  title?: string
  disabled?: boolean
  busy?: boolean
}>
export interface UiControlOptions {
  monospace?: boolean
  reading?: boolean
  swatch?: boolean
}
export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'rating'
export type UiButtonTone = 'again' | 'hard' | 'good' | 'easy'
export interface UiButtonOptions {
  variant?: UiButtonVariant
  tone?: UiButtonTone
  icon?: boolean
}
/** Apply the shared GUI while retaining native v-model, refs and event behavior. */
export declare const vUiControl: Directive<HTMLElement, UiControlOptions | undefined>
export declare const vUiButton: Directive<
  HTMLElement,
  UiButtonVariant | UiButtonOptions | undefined
>
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
