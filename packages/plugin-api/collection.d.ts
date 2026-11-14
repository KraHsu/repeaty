import type {
  MaterialMutationContext,
  MaterialTaskContext,
  MaterialImportResult,
} from './materials'

export interface SourceDirectory {
  files: readonly { path: string; size: number; modified?: string }[]
  /** Read-only, user-authorized snapshot. Throws if the file changed after listing. */
  read(path: string): Promise<Blob>
}
export interface SourceConnectorItem {
  key: string
  title: string
  text: string
  format: 'plain' | 'markdown'
  url?: string
  path?: string
  /** Short-lived URL or an authorized directory path. Kept in memory, never in a library or backup. */
  original?: { name: string; format: 'pdf' | 'epub' } & (
    { url: string; path?: never } | { path: string; url?: never }
  )
  resources?: { path: string; blob: Blob }[]
  links?: { targetKey: string; label?: string; anchor?: string }[]
}
export interface SourceConnectorRequest {
  connectionId: string
  settings: Readonly<Record<string, unknown>>
  cursor?: string
  directory?: SourceDirectory
}
export interface SourceConnectorSnapshot {
  items: readonly SourceConnectorItem[]
  deletedKeys?: readonly string[]
  cursor?: string
  /** Only a complete snapshot may infer deletion from absence. */
  complete: boolean
}
export interface SourceConnectorContribution {
  id: string
  title: string
  kind: 'directory' | 'remote' | 'hybrid'
  fields?: readonly {
    key: string
    title: string
    type: 'select' | 'text'
    options?: readonly { value: string; label: string }[]
    default?: string
  }[]
  credentialHint?: string
  scan(
    request: SourceConnectorRequest,
    context: MaterialTaskContext,
  ): Promise<SourceConnectorSnapshot>
}
/** Scanning produces reviewable candidates. It never changes accepted materials. */
export declare function registerSourceConnector(
  contribution: SourceConnectorContribution,
): () => void

export interface CollectionImportRequest {
  files?: readonly File[]
  /** Explicit parser for an ambiguous relative file path, in pluginId:importerId form. */
  importers?: Readonly<Record<string, string>>
  text?: { text: string; title?: string; url?: string; format?: 'plain' | 'markdown' }
  destination: 'inbox' | 'library'
  kind?: 'file' | 'clipboard' | 'global'
}
export interface CollectionImporter {
  pluginId: string
  id: string
  title: string
  extensions: readonly string[]
}
export interface CollectionImportPlan {
  id: string
  revision: number
  candidates: readonly {
    key: string
    title: string
    duplicate: boolean
    format: string
    sourceName: string
  }[]
  skipped: readonly { name: string; reason: string }[]
}
export interface CollectionHostApi {
  /** Available parsers. Plain text and Markdown always use the host's built-in reader. */
  importers?(): readonly CollectionImporter[]
  prepareCollection(
    request: CollectionImportRequest,
    signal?: AbortSignal,
  ): Promise<CollectionImportPlan>
  commitCollection(
    request: MaterialMutationContext & { planId: string; selection?: string[] },
  ): Promise<MaterialImportResult>
  discardCollection(planId: string): void
  organizeInbox(
    request: MaterialMutationContext & {
      sourceId: string
      title?: string
      url?: string
      action: 'file' | 'archive' | 'restore'
    },
  ): Promise<{ revision: number }>
  snapshot(): { revision: number; workspaceScope: string }
}
