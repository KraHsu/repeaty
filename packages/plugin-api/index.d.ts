import type {
  Component,
  DeepReadonly,
  DefineComponent,
  Directive,
  Ref,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  HTMLAttributes,
} from 'vue'
export * from './materials'
import type { MaterialLocator } from './materials'

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
  excerpt?: {
    sourceId: string
    mediaId: string
    start: number
    end: number
    quote: string
    locator?: MaterialLocator
  }
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
/** A plugin that provides pages or widgets without creating a question type or review panel. */
export interface ExtensionPlugin {
  id: string
  kind: 'frontend' | 'local'
  type: 'extension'
  label: string
  version: number
  description?: string
  dispose?: () => void | Promise<void>
}
export type FrontendPlugin = (QuestionPlugin | ReviewPanelPlugin | ExtensionPlugin) & {
  kind: 'frontend'
}
/** The active learning-library scope. It changes by remounting the page, not by reusing its state. */
export interface PluginPageProps {
  workspaceScope: string
}
/** Every registered page gets a sidebar entry; IDs are local to the contributing plugin. */
export interface PluginPageContribution {
  id: string
  /** Labels may be reactive getters, for example to follow the interface language. */
  title: string
  description?: string
  icon?: Component
  component: Component
}
/** Register during activation; the returned idempotent function removes this registration only. */
export declare function registerPage(contribution: PluginPageContribution): () => void
export type PluginWidgetPlacement = 'overview.after-decks' | 'overview.bottom'
export interface PluginWidgetProps {
  workspaceScope: string
  /** Read-only rating summaries from the current library, without card bodies or attempts. */
  reviews: readonly Readonly<Review>[]
}
export interface PluginWidgetContribution {
  id: string
  title: string
  placement: PluginWidgetPlacement
  component: Component
}
/** Widgets use stable plugin load order, then registration order within each plugin. */
export declare function registerWidget(contribution: PluginWidgetContribution): () => void
export interface AppPageProps {
  title?: string
  description?: string
}
/** Optional shared page container. Slots: default (content), description, and actions. */
export declare const AppPage: DefineComponent<AppPageProps & HTMLAttributes>
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
export interface UiInputInstance {
  inputRef?: HTMLInputElement
}
export interface UiTextareaInstance {
  textareaRef?: HTMLTextAreaElement
}
export interface UiTextControlOptions {
  modelValue?: string | number | null
  'onUpdate:modelValue'?: (value: any) => void
  ui?: { root?: string; base?: string; trailing?: string }
}
export declare const UiInput: DefineComponent<
  InputHTMLAttributes & UiTextControlOptions,
  UiInputInstance
>
export declare const UiTextarea: DefineComponent<
  TextareaHTMLAttributes & UiTextControlOptions,
  UiTextareaInstance
>
export declare const UiSelect: DefineComponent<
  HTMLAttributes & {
    modelValue?: string | number
    items?: readonly {
      value: string | number | null
      label: string
      description?: string
      disabled?: boolean
    }[]
    disabled?: boolean
    name?: string
    required?: boolean
    placeholder?: string
    'onUpdate:modelValue'?: (value: any) => void
    onChange?: (event: Event) => void
  }
>
export declare const UiCheckbox: DefineComponent<
  HTMLAttributes & {
    modelValue?: boolean | 'indeterminate'
    label?: string
    description?: string
    disabled?: boolean
    required?: boolean
    name?: string
    'onUpdate:modelValue'?: (value: boolean | 'indeterminate') => void
  }
>
export declare const UiProgress: DefineComponent<
  HTMLAttributes & {
    modelValue?: number | null
    max?: number
    status?: boolean
  }
>
export declare const UiCollapsible: DefineComponent<
  HTMLAttributes & {
    open?: boolean
    defaultOpen?: boolean
    disabled?: boolean
    unmountOnHide?: boolean
    'onUpdate:open'?: (value: boolean) => void
  }
>
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
/** @deprecated Use host-rendered UiInput, UiTextarea, UiSelect or SettingField. */
export declare const vUiControl: Directive<HTMLElement, UiControlOptions | undefined>
/** @deprecated Use host-rendered UiButton or UiCollapsible. */
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
