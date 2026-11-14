import type { Component } from 'vue'
import type { NoteInput } from './index'

/** Version IDs identify immutable source projections, never mutable paths or titles. */
export type MaterialLocator = {
  schemaVersion: 1
  sourceId: string
  versionId: string
} & (
  | { kind: 'text'; start: number; end: number; quote: string }
  | {
      kind: 'pdf'
      regions: { page: number; x: number; y: number; width: number; height: number }[]
    }
  | { kind: 'epub'; href: string; cfi?: string; start?: number; end?: number }
  | { kind: 'image'; x: number; y: number; width: number; height: number }
  | { kind: 'formula'; start: number; end: number; latex: string; leaves: number[] }
)
export interface MaterialTaskProgress {
  completed: number
  total?: number
  message?: string
}
/** Abort is cooperative. CPU-intensive parsing must use a Worker, not synchronous main-thread work. */
export interface MaterialTaskContext {
  signal: AbortSignal
  /** User-selected sidecar resources; no ambient filesystem access. */
  files?: readonly File[]
  progress(value: MaterialTaskProgress): void
  /** Cleanup runs exactly once on completion, cancellation, failure, or plugin unload. */
  onCleanup(dispose: () => void): void
  /** Host-owned Blob Worker; UTF-8 source <= 4 MiB. Terminated/revoked on task completion or abort.
   * Optional for older hosts and explicitly supplied contexts; check materials.capabilities().worker.
   */
  createWorker?(source: string, options?: { type?: 'classic' | 'module'; name?: string }): Worker
  /** Yield to the host between bounded batches; throws when the task is no longer current. */
  yield(): Promise<void>
}
/** Offline package assets and disposable reader resources, bound to this plugin/library. */
export declare const resources: {
  read(path: string): Blob | undefined
  createScope(): {
    signal: AbortSignal
    onCleanup(dispose: () => void): void
    createWorker(source: string, options?: { type?: 'classic' | 'module'; name?: string }): Worker
    url(path: string): string
    dispose(): void
  }
}
export interface MaterialTaskOptions {
  id: string
  title: string
  signal?: AbortSignal
  onProgress?: (value: Readonly<MaterialTaskProgress>) => void
}
export declare const tasks: {
  /** Per application: at most two active tasks and sixteen queued tasks. IDs are plugin-scoped. */
  run<T>(
    options: MaterialTaskOptions,
    run: (context: MaterialTaskContext) => Promise<T>,
  ): Promise<T>
}

/** A parser returns a portable text projection; the host stores identity, bytes and revisions. */
export interface MaterialImportCandidate {
  key: string
  title: string
  text: string
  format: 'plain' | 'markdown'
  documentFormat: string
  readerId?: string
  parentKey?: string
  documentPath?: string
  documentData?: Record<string, unknown>
  container?: boolean
  url?: string
  resources?: { path: string; blob: Blob }[]
  studySequence?: { groupKey: string; index: number; mode: 'free' | 'sequential' }
}
export interface MaterialImporterContribution {
  id: string
  title: string
  /** Lower-case dotted filename suffixes, e.g. ['.txt', '.md']; no wildcard or executable claim. */
  extensions: readonly string[]
  parse(file: File, context: MaterialTaskContext): Promise<readonly MaterialImportCandidate[]>
}
export interface MaterialRecord {
  id: string
  title: string
  versionId: string
  format: 'plain' | 'markdown'
  parentSourceId?: string
  studySequence?: {
    groupId: string
    index: number
    mode: 'free' | 'sequential'
    completed: boolean
  }
  locked: boolean
  document?: {
    schemaVersion: 1
    providerId: string
    readerId?: string
    format: string
    originalMediaId: string
    path?: string
    data?: Record<string, unknown>
    container?: boolean
    resources?: { path: string; mediaId: string }[]
  }
}
export interface MaterialSelection {
  locator: MaterialLocator
  /** Human-readable selected text. A locator is not permission to read other library content. */
  text: string
  /** Required for non-text locators: exact UTF-16 offsets in the immutable text projection. */
  projection?: { start: number; end: number }
}
export interface MaterialReadingPosition {
  locator: MaterialLocator
  projectionOffset: number
}
export interface MaterialReaderProps {
  workspaceScope: string
  material: Readonly<MaterialRecord>
  text: string
  original?: Blob
  resource?: (path: string) => Promise<Blob | undefined>
  readOnly?: boolean
  onOpen?: (sourceId: string, locator?: MaterialLocator) => void
  selection?: MaterialSelection
  /** Host navigation can request an offset alone (for example, restart at zero). */
  position?: { locator?: MaterialLocator; projectionOffset: number }
  onSelect: (selection: MaterialSelection | undefined) => void
  onPosition?: (position: MaterialReadingPosition) => void
}
export interface MaterialReaderContribution {
  id: string
  title: string
  formats: readonly string[]
  /** Accept exact text projection ranges from host search and legacy excerpts. */
  supportsTextLocation?: boolean
  component: Component
}
export interface MaterialCommandContext extends MaterialTaskContext {
  workspaceScope: string
  expectedRevision: number
  operationId: string
  sourceId?: string
  selection?: MaterialSelection
}
export interface MaterialCommandContribution {
  id: string
  title: string
  /** Optional suggestion only; the host owns collision resolution and actual key binding. */
  shortcut?: string
  /** Exactly one of run or component. Tool components receive { context, onClose }. */
  run?: (context: MaterialCommandContext) => Promise<void>
  component?: Component
  /** '*' contributes to every material format, including future readers. */
  formats?: readonly string[]
}
export interface MaterialSearchQuery {
  text: string
  cursor?: string
  limit: number
}
export interface MaterialSearchHit {
  sourceId: string
  versionId: string
  title: string
  snippet: string
  locator?: MaterialLocator
}
export interface MaterialSearchPage {
  hits: readonly MaterialSearchHit[]
  nextCursor?: string
}
/** Providers may build derived indexes in pluginData; those indexes must be rebuildable. */
export interface MaterialSearchProviderContribution {
  id: string
  title: string
  search(query: MaterialSearchQuery, context: MaterialTaskContext): Promise<MaterialSearchPage>
}
export declare function registerImporter(contribution: MaterialImporterContribution): () => void
export declare function registerReader(contribution: MaterialReaderContribution): () => void
export declare function registerCommand(contribution: MaterialCommandContribution): () => void
export declare function registerSearchProvider(
  contribution: MaterialSearchProviderContribution,
): () => void

export interface MaterialMutationContext {
  expectedRevision: number
  operationId: string
}
export interface MaterialImportRequest {
  importerId: string
  files: readonly File[]
  relatedFiles?: readonly File[]
}
export interface MaterialImportPlan {
  id: string
  revision: number
  candidates: readonly { key: string; title: string; duplicate: boolean }[]
}
export interface MaterialImportResult {
  sourceIds: readonly string[]
  revision: number
}
export interface MaterialCreateNoteRequest extends MaterialMutationContext {
  sourceId: string
  selection: MaterialSelection
  note: Omit<NoteInput, 'excerpt'>
}
export interface MaterialCreateExcerptRequest extends MaterialMutationContext {
  sourceId: string
  selection: MaterialSelection
  title: string
}
/** The current immutable version must still match; editing creates a new version and is undoable. */
export interface MaterialEditContentRequest extends MaterialMutationContext {
  sourceId: string
  versionId: string
  content: string
}
export interface MaterialCommandRequest extends MaterialMutationContext {
  sourceId?: string
  selection?: MaterialSelection
}
export interface MaterialCapabilities {
  protocolVersion: 1
  workspaceScope: string
  available: boolean
  import: boolean
  createNote: boolean
  search: boolean
  worker: boolean
}
export interface MaterialWorkspaceSnapshot {
  workspaceScope: string
  revision: number
  sources: readonly MaterialRecord[]
  decks: readonly { id: string; name: string }[]
}
export interface MaterialHostApi {
  capabilities(): MaterialCapabilities
  snapshot(): MaterialWorkspaceSnapshot
  list(): Promise<readonly MaterialRecord[]>
  get(sourceId: string, versionId?: string): Promise<{ material: MaterialRecord; text: string }>
  original(sourceId: string, versionId?: string): Promise<Blob | undefined>
  resource(sourceId: string, path: string, versionId?: string): Promise<Blob | undefined>
  setSequence(
    request: MaterialMutationContext & {
      sourceId: string
      mode?: 'free' | 'sequential'
      completed?: boolean
    },
  ): Promise<{ revision: number }>
  annotate(
    request: MaterialMutationContext & {
      sourceId: string
      selection: MaterialSelection
      body: string
      id?: string
    },
  ): Promise<{ id: string; revision: number }>
  removeAnnotation(
    request: MaterialMutationContext & { sourceId: string; id: string },
  ): Promise<{ revision: number }>
  prepareImport(request: MaterialImportRequest, signal?: AbortSignal): Promise<MaterialImportPlan>
  commitImport(request: MaterialMutationContext & { planId: string }): Promise<MaterialImportResult>
  discardImport(planId: string): void
  createNote(request: MaterialCreateNoteRequest): Promise<{ noteId: string; revision: number }>
  createExcerpt(
    request: MaterialCreateExcerptRequest,
  ): Promise<{ sourceId: string; revision: number }>
  editContent(
    request: MaterialEditContentRequest,
  ): Promise<{ sourceId: string; versionId: string; revision: number }>
  search(query: MaterialSearchQuery, signal?: AbortSignal): Promise<MaterialSearchPage>
}
/** Host-owned transactions. Every call stays bound to this plugin instance and learning library. */
export declare const materials: MaterialHostApi
