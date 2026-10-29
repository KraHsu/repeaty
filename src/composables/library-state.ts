import { ref, shallowRef } from 'vue'
import { emptyLibrary } from '../core/model'
import type { LibraryState, UndoEntry } from '../application/library-context'
import type { BackupSummary } from '../core/storage'
import type { ReadingUndo } from '../core/reading-operations'
import type { DisplayMessage } from '../i18n'

export function createLibraryState() {
  return {
    library: shallowRef(emptyLibrary()),
    scope: ref(''),
    ready: ref(false),
    busy: ref(false),
    loadError: ref<DisplayMessage>(''),
    backupError: ref(''),
    backups: shallowRef<BackupSummary[]>([]),
    readingUndo: shallowRef<ReadingUndo>(),
    operations: shallowRef<UndoEntry[]>([]),
  } satisfies LibraryState
}
