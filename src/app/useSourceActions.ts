import { t } from '../i18n'
import { computed } from 'vue'
import type {
  SourceInput,
  SourceDetailsUpdate,
  SaveSourceExcerptInput,
  SourceQueueUpdate,
  SourceBatchUpdate,
  ReadingUpdate,
} from '../core/source-data'
import { remoteWorkspace, desktopEdition } from '../edition'
import type { useLibrary } from '../composables/useLibrary'
import type { useReadingProgress } from '../composables/useReadingProgress'
import type { useStudyClock } from './useStudyClock'
import type { useOperationRunner } from './useOperationRunner'
import type { MaterialWorkbenchActions } from '../components/material-workbench-actions'
export function useSourceActions({
  library,
  busy,
  workspace,
  readingProgress,
  now,
  notice,
  run,
}: {
  library: ReturnType<typeof useLibrary>['library']
  busy: ReturnType<typeof useLibrary>['busy']
  workspace: ReturnType<typeof useLibrary>
  readingProgress: ReturnType<typeof useReadingProgress>
  now: ReturnType<typeof useStudyClock>['now']
  notice: ReturnType<typeof useOperationRunner>['notice']
  run: ReturnType<typeof useOperationRunner>['run']
}) {
  const sourceBindings = computed(() => {
    const ownerScope = workspace.scope.value
    return {
      library: library.value,
      busy: busy.value,
      scope: workspace.scope.value,
      reading: readingProgress,
      now: now.value,
      canShare: desktopEdition && !remoteWorkspace.value,
      read: workspace.getSource,
      save: saveSource,
      updateDetails: editSourceDetails,
      saveExcerpt: saveSourceExcerpt,
      remove: deleteSource,
      arrange: arrangeSource,
      arrangeBatch: arrangeSources,
      undoReading,
      canUndoReading: workspace.canUndoReading.value,
      readingUndoId: workspace.readingUndo.value?.id,
      saveReading,
      actionError: notice.value?.error ? t(notice.value.text) : undefined,
      readProperties: (id: string) => workspace.readSourceProperties(id, ownerScope),
      workbench: {
        setPriority: (kind, id, value) =>
          run(() => workspace.setStudyPriority(kind, id, value, ownerScope), '学习优先级已保存'),
        prepareEditor: workspace.prepareSourceEditor,
        writeDraft: workspace.writeSourceDraft,
        discardDraft: workspace.discardSourceDraft,
        editContent: (update) => run(() => workspace.editSourceContent(update), '材料已保存'),
        annotate: (update) => run(() => workspace.upsertSourceAnnotation(update), '批注已保存'),
        removeAnnotation: (id, annotationId, scope) =>
          run(() => workspace.removeSourceAnnotation(id, annotationId, scope), '批注已删除'),
        createFolder: (name, parentId) =>
          run(() => workspace.createMaterialFolder(ownerScope, name, parentId)),
        renameFolder: (id, name) => run(() => workspace.renameMaterialFolder(ownerScope, id, name)),
        removeFolder: (id) => run(() => workspace.removeMaterialFolder(ownerScope, id)),
        move: (move) => run(() => workspace.moveMaterial(ownerScope, move)),
      } satisfies MaterialWorkbenchActions,
    }
  })
  async function saveSource(input: SourceInput, scope: string) {
    return run(() => workspace.saveSource(input, scope), '材料已保存')
  }
  async function editSourceDetails(update: SourceDetailsUpdate) {
    return run(() => workspace.editSourceDetails(update), '材料信息已保存')
  }
  async function saveSourceExcerpt(input: SaveSourceExcerptInput) {
    return run(() => workspace.saveSourceExcerpt(input), '摘录已保存')
  }
  async function deleteSource(id: string, scope: string) {
    return run(() => workspace.deleteSource(id, scope), '材料已删除')
  }
  async function arrangeSource(update: SourceQueueUpdate) {
    return run(() => workspace.arrangeSource(update), '阅读安排已保存')
  }
  async function arrangeSources(update: SourceBatchUpdate) {
    return run(() => workspace.arrangeSources(update), '阅读安排已保存')
  }
  async function undoReading() {
    return run(() => workspace.undoReadingArrangement(workspace.scope.value), '阅读安排已撤销')
  }
  async function saveReading(update: ReadingUpdate) {
    return run(() => workspace.saveSourceReading(update, new Date()))
  }
  return {
    sourceBindings,
    saveSource,
    editSourceDetails,
    saveSourceExcerpt,
    deleteSource,
    arrangeSource,
    arrangeSources,
    undoReading,
    saveReading,
  }
}
