import type { Library, MediaUpload } from '../core/model'
import type { ReadingUndo } from '../core/reading-operations'
import type { Operation } from '../core/operations'
import type { OperationHistory } from '../core/operation-history'
import type { Attempt } from '../core/practice-data'
import type { CardEligibility } from '../core/scheduler'
import type { DisplayMessage, MessageKey } from '../i18n'
import type { BackupSummary, createRepository } from '../core/storage'
import type { createNativeRepository, DocumentWrite } from '../desktop/repository'
import type { createServerRepository } from '../backend/repository'
import type { createBrowserRepository } from '../browser/repository'

/** Application services accept observable cells without depending on Vue or Pinia. */
export interface Cell<T> {
  value: T
}
export type LibraryRepository =
  | ReturnType<typeof createRepository>
  | ReturnType<typeof createNativeRepository>
  | ReturnType<typeof createServerRepository>
  | ReturnType<typeof createBrowserRepository>
export type UndoEntry = Operation
export interface LibraryState {
  library: Cell<Library>
  scope: Cell<string>
  ready: Cell<boolean>
  busy: Cell<boolean>
  loadError: Cell<DisplayMessage>
  backupError: Cell<string>
  backups: Cell<BackupSummary[]>
  readingUndo: Cell<ReadingUndo | undefined>
  operations: Cell<UndoEntry[]>
  redoOperations: Cell<UndoEntry[]>
}
export interface CommitOptions {
  sync?: import('../sync/commit').SyncCommit
  retired?: import('../desktop/retirement').RetiredNote[]
  assets?: MediaUpload[]
  reason?: string
  consumeCardDraft?: string
  consumeSourceDraft?: string
  externalDocuments?: DocumentWrite[]
  scanHash?: string
  assetObservations?: { path: string; hash: string }[]
  backgroundMetadata?: boolean
  undoLabel?: MessageKey | false
  undoKind?: Operation['kind']
  undoBarrier?: boolean
  operationHistory?: OperationHistory
}
export interface LibraryContext extends LibraryState {
  readonly repository: LibraryRepository
  readonly revision: number
  readonly savingDone: Promise<void>
  commit(
    update: (current: Library) => Library | Promise<Library>,
    options?: CommitOptions,
  ): Promise<void>
  getSource(id: string, signal?: AbortSignal, mediaId?: string): Promise<string>
  getAttempt(id: string, signal?: AbortSignal): Promise<Attempt>
  undoRecordedOperation(id: string): Promise<Operation>
  undoRating(): Promise<void>
  refreshBackups(): Promise<void>
  draftRepository(scope: string): unknown
  canReviewCard: CardEligibility
}
export interface LibraryDependencies {
  createWorkspaceRepository(onBlocked: () => void): Promise<LibraryRepository>
  remoteWorkspace: { readonly value: boolean }
  desktopEdition: boolean
  canReviewCard: CardEligibility
}
