import { computed, watch } from 'vue'
import { t } from '../i18n'
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
import { providePluginManager, usePluginManager } from '../plugins/manager'
import { usePluginViews } from './usePluginViews'
import { createPluginReviewReader } from '../plugins/activity'

/** One composition root owns UI controllers and connects the selected storage adapter. */
export function createApplication() {
  const plugins = usePluginManager()
  providePluginManager(plugins)
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
  const extensions = usePluginViews(navigation, workspace.scope, plugins)
  const readPluginReviews = createPluginReviewReader()
  const pluginReviews = computed(() => readPluginReviews(library.value.reviews))
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
    void plugins.initializePlugins(workspace.scope.value).catch(() => {})
  })
  useApplicationLifecycle({
    workspace,
    plugins,
    globalKeydown: study.globalKeydown,
    tick: clock.tick,
  })
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
    ...extensions,
    pluginReviews,
    pageTitle: computed(() =>
      extensions.activePluginPage.value
        ? t(extensions.activePluginPage.value.contribution.title)
        : queries.pageTitle.value,
    ),
  }
}
