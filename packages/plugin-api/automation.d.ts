/** Portable automation protocol. The host supplies identity, grants and library scope;
 * none of them may be supplied by a model, a document, or these request objects. */
export type AutomationEntity = 'sources' | 'folders' | 'collections' | 'notes' | 'decks' | 'cards'
export interface AutomationPage {
  revision?: number
  offset?: number
  limit?: number
}
export type AutomationQuery =
  | { kind: 'library'; revision?: number }
  | (AutomationPage & { kind: 'decks'; id?: string; text?: string })
  | (AutomationPage & { kind: 'folders'; id?: string; parentId?: string; text?: string })
  | (AutomationPage & { kind: 'collections'; id?: string; text?: string; archived?: boolean })
  | (AutomationPage & {
      kind: 'sources'
      id?: string
      folderId?: string
      parentSourceId?: string
      text?: string
    })
  | (AutomationPage & {
      kind: 'notes'
      id?: string
      deckId?: string
      sourceId?: string
      text?: string
      tag?: string
    })
  | (AutomationPage & { kind: 'cards'; id?: string; noteId?: string; deckId?: string })
  | (AutomationPage & {
      kind: 'history'
      cardId?: string
      historyKind?: 'reviews' | 'practices' | 'reading'
    })
  | { kind: 'source.body'; sourceId: string; versionId?: string; revision?: number }
  /** Native host capabilities: availability must be discovered before use. */
  | (AutomationPage & { kind: 'retired' | 'checkpoints' })

export interface AutomationNoteInput {
  deckId: string
  type: 'basic' | 'reversed' | 'cloze'
  format?: 'plain' | 'markdown'
  front: string
  back: string
  tags?: string[]
  frontMedia?: string[]
  backMedia?: string[]
  studyPriority?: number
}
export interface AutomationDeckInput {
  name: string
  description?: string
  color?: 'sage' | 'sand' | 'lavender' | 'blue' | 'rose'
  newLimit?: number
  reviewLimit?: number
  burySiblings?: boolean
  leechThreshold?: number
  desiredRetention?: number
  studyPriority?: number
}
export interface AutomationDestination {
  folderId?: string
  parentSourceId?: string
}
export type AutomationCommand =
  | {
      kind: 'source.create'
      destination?: AutomationDestination
      input: { title: string; body: string; format?: 'plain' | 'markdown'; url?: string }
    }
  | {
      kind: 'source.patch'
      sourceId: string
      versionId: string
      patch: { title?: string; body?: string }
    }
  | { kind: 'source.archive' | 'source.restore'; sourceId: string }
  | { kind: 'source.move'; sourceId: string; destination: AutomationDestination; beforeId?: string }
  | { kind: 'folder.create'; name: string; parentId?: string }
  | { kind: 'folder.patch'; folderId: string; name: string }
  | { kind: 'folder.remove'; folderId: string }
  | { kind: 'folder.move'; folderId: string; destination: { folderId?: string }; beforeId?: string }
  | { kind: 'collection.create'; name: string; sourceIds?: string[] }
  | { kind: 'collection.patch'; collectionId: string; name: string }
  | { kind: 'collection.members'; collectionId: string; add?: string[]; remove?: string[] }
  | { kind: 'collection.reorder'; collectionId: string; sourceIds: string[] }
  | { kind: 'collection.archive' | 'collection.restore'; collectionId: string }
  | { kind: 'note.create'; input: AutomationNoteInput }
  | {
      kind: 'note.patch'
      noteId: string
      patch: Partial<AutomationNoteInput>
      allowRemove?: boolean
    }
  | { kind: 'note.move'; noteIds: string[]; deckId: string }
  | { kind: 'note.tags'; noteIds: string[]; add?: string[]; remove?: string[] }
  | { kind: 'note.remove'; noteIds: string[] }
  | { kind: 'deck.create'; input: AutomationDeckInput }
  | { kind: 'deck.patch'; deckId: string; patch: Partial<AutomationDeckInput> }
  /** Host actions are never mixed with pure commands in one request. */
  | { kind: 'history.undo' | 'history.redo' }
  | { kind: 'retired.restore'; noteId: string }
  | { kind: 'checkpoint.restore'; checkpointId: string }

export interface AutomationRequest {
  protocolVersion: 1
  /** Stable caller request ID. Reuse only with the identical canonical request. */
  operationId: string
  expectedRevision: number
  commands: AutomationCommand[]
}
export interface AutomationApply {
  request: AutomationRequest
  fingerprint: string
  /** Optional preview cache handle; receipt replay never depends on it. */
  planId?: string
}
export interface AutomationChange {
  entity: AutomationEntity
  id: string
  action: 'create' | 'update' | 'remove'
  fields: string[]
}
export type AutomationIds = Record<AutomationEntity, string[]>
export interface AutomationResult {
  /** The original committed revision, including when a reply is replayed. */
  revision: number
  resultIds: AutomationIds
}
export interface AutomationPreview {
  planId: string
  fingerprint: string
  request: AutomationRequest
  revision: number
  changes: AutomationChange[]
  touched: AutomationIds
  resultIds: AutomationIds
}
export interface AutomationCommit extends AutomationResult {
  operationId: string
  replayed: boolean
}
export type AutomationScope =
  | { kind: 'all' }
  | { kind: 'sources'; sourceIds: string[] }
  | { kind: 'folders'; folderIds: string[] }
export interface AutomationGrant {
  id: string
  libraryScope: string
  scope: AutomationScope
  write: boolean
}
/** API availability does not confer permission. Hosts check the current grant on every call. */
export interface AutomationApi {
  capabilities(): unknown
  /** Scope-picker metadata for host/user UI only; never forward ungranted context to a model. */
  context(): {
    sources: { id: string; title: string; folderId?: string; parentSourceId?: string }[]
    folders: { id: string; name: string; parentId?: string }[]
    selection?: { sourceId: string; versionId: string; text: string }
  }
  /** Opens host-owned consent UI. The requested scope is not an authorization. */
  authorize(input: { scope: AutomationScope; write: boolean }): Promise<AutomationGrant>
  revoke(): void
  query(query: AutomationQuery, signal?: AbortSignal): Promise<unknown>
  preview(request: AutomationRequest, signal?: AbortSignal): Promise<AutomationPreview>
  apply(input: AutomationApply, signal?: AbortSignal): Promise<AutomationCommit>
  operationStatus(operationId: string, signal?: AbortSignal): Promise<AutomationCommit | undefined>
}
