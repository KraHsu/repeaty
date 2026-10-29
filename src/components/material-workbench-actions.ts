import type {
  SourceDraft,
  SourceContentUpdate,
  SourceAnnotationUpdate,
} from '../core/source-workbench'
import type { MaterialMove } from '../core/material-organization-data'

export interface MaterialWorkbenchActions {
  prepareEditor(
    id: string,
    mediaId: string,
    scope: string,
  ): Promise<{ properties: string; draft?: SourceDraft }>
  writeDraft(draft: SourceDraft): Promise<void>
  discardDraft(sourceId: string, id: string, scope: string): Promise<void>
  editContent(update: SourceContentUpdate): Promise<boolean>
  annotate(update: SourceAnnotationUpdate): Promise<boolean>
  removeAnnotation(sourceId: string, id: string, scope: string): Promise<boolean>
  createFolder(name: string, parentId?: string): Promise<boolean>
  renameFolder(id: string, name: string): Promise<boolean>
  removeFolder(id: string): Promise<boolean>
  move(move: MaterialMove): Promise<boolean>
}
