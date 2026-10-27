import { watch } from 'vue'
import { useLibrary } from '../composables/useLibrary'
import { useReadingProgress } from '../composables/useReadingProgress'
import { useOffline } from '../composables/useOffline'
import { useNotifications } from '../notifications'
import { useStudyClock } from './useStudyClock'
import { useAppNavigation } from './useAppNavigation'
import { useLibraryQueries } from './useLibraryQueries'
import { useOperationRunner } from './useOperationRunner'
import { useStudyViews } from './useStudyViews'
import { useEditorActions } from './useEditorActions'
import { useSourceActions } from './useSourceActions'
import { useStudyActions } from './useStudyActions'
import { useBackupActions } from './useBackupActions'
import { useApplicationLifecycle } from './useApplicationLifecycle'

/** One composition root owns UI controllers and connects the selected storage adapter. */
export function createApplication() {
  const { clearNotifications } = useNotifications()

  const workspace = useLibrary()
  const readingProgress = useReadingProgress(workspace)
  const offline = useOffline()
  const { library, ready, busy, loadError, backups, backupError } = workspace
  const base = {
    workspace,
    readingProgress,
    offline,
    library,
    ready,
    busy,
    loadError,
    backups,
    backupError,
  }
  const clock = useStudyClock()
  const navigation = useAppNavigation()
  const queries = useLibraryQueries({ ...base, ...clock, ...navigation })
  const runner = useOperationRunner({ ...base, ...clock })
  const views = useStudyViews()
  const editor = useEditorActions({ ...base, ...navigation, ...queries, ...runner, ...views })
  const sources = useSourceActions({ ...base, ...clock, ...runner })
  const study = useStudyActions({
    ...base,
    ...clock,
    ...navigation,
    ...runner,
    ...views,
    ...editor,
  })
  const transfers = useBackupActions({ ...base, ...clock, ...navigation, ...runner })
  watch(workspace.scope, () => {
    navigation.resetLibrary()
    editor.resetEditor()
    clearNotifications()
  })
  useApplicationLifecycle({ workspace, globalKeydown: study.globalKeydown, tick: clock.tick })
  return {
    ...base,
    ...clock,
    ...navigation,
    ...queries,
    ...runner,
    ...views,
    ...editor,
    ...sources,
    ...study,
    ...transfers,
  }
}
