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
)
export interface MaterialTaskProgress {
  completed: number
  total?: number
  message?: string
}
/** Abort is cooperative. CPU-intensive parsing must use a Worker, not synchronous main-thread work. */
export interface MaterialTaskContext {
  signal: AbortSignal
  progress(value: MaterialTaskProgress): void
  /** Cleanup runs exactly once on completion, cancellation, failure, or plugin unload. */
  onCleanup(dispose: () => void): void
  /** Yield to the host between bounded batches; throws when the task is no longer current. */
  yield(): Promise<void>
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
  document?: {
    schemaVersion: 1
    providerId: string
    readerId?: string
    format: string
    originalMediaId: string
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
  material: Readonly<MaterialRecord>
  text: string
  original?: Blob
  selection?: MaterialSelection
  position?: MaterialReadingPosition
  onSelect: (selection: MaterialSelection | undefined) => void
  onPosition?: (position: MaterialReadingPosition) => void
}
export interface MaterialReaderContribution {
  id: string
  title: string
  formats: readonly string[]
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
  run(context: MaterialCommandContext): Promise<void>
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
  prepareImport(request: MaterialImportRequest, signal?: AbortSignal): Promise<MaterialImportPlan>
  commitImport(request: MaterialMutationContext & { planId: string }): Promise<MaterialImportResult>
  discardImport(planId: string): void
  createNote(request: MaterialCreateNoteRequest): Promise<{ noteId: string; revision: number }>
  createExcerpt(
    request: MaterialCreateExcerptRequest,
  ): Promise<{ sourceId: string; revision: number }>
  search(query: MaterialSearchQuery, signal?: AbortSignal): Promise<MaterialSearchPage>
}
/** Host-owned transactions. Every call stays bound to this plugin instance and learning library. */
export declare const materials: MaterialHostApi
