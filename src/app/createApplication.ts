import { useNativeCollection } from './useNativeCollection'
import { useDeviceSync } from './useDeviceSync'
import { useSourceConnections } from './useSourceConnections'
import { computed, onScopeDispose, watch } from 'vue'
import { t } from '../i18n'
import { useLibrary } from '../composables/useLibrary'
import { useReadingProgress } from '../composables/useReadingProgress'
import { useOffline } from '../composables/useOffline'
import { useNotifications } from '../notifications'
import { useStudyActivity } from './useStudyActivity'
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
import { useReadingLeaveGuard } from './useReadingLeaveGuard'
import { useAutomationConsent } from './useAutomationConsent'
import { usePluginNetworkConsent } from './usePluginNetworkConsent'
import { useInputCommands } from '../input/controller'
import { provideMenuPreferences } from '../input/menus'

/** One composition root owns UI controllers and connects the selected storage adapter. */
export function createApplication() {
  const plugins = usePluginManager()
  providePluginManager(plugins)
  const { clearNotifications, notify } = useNotifications()

  const workspace = useLibrary()
  const input = useInputCommands(workspace.scope)
  const menus = provideMenuPreferences(workspace.scope)
  watch(
    () =>
      plugins.pluginRuntime.installations.flatMap((owner) =>
        (owner.commands ?? []).map((command) => ({ owner, command })),
      ),
    (entries, _previous, onCleanup) => {
      const disposers = entries.map(({ owner, command }) =>
        input.registerDefinition({
          id: `plugin:${owner.plugin.id}:${command.id}`,
          title: `${owner.plugin.label} · ${command.title}`,
          context: 'material',
          defaultShortcuts: command.shortcut ? [command.shortcut] : [],
        }),
      )
      onCleanup(() => disposers.forEach((dispose) => dispose()))
    },
    { immediate: true },
  )
  const networkConsent = usePluginNetworkConsent(workspace.scope)
  onScopeDispose(plugins.setNetworkConsent(networkConsent.consent))
  onScopeDispose(plugins.setPublishingHost((owner) => workspace.publishingApi(owner)))
  const automationConsent = useAutomationConsent(workspace.scope)
  onScopeDispose(
    plugins.setAutomationHost((owner) =>
      workspace.automationApi(
        { ...owner, actorId: `plugin:${owner.pluginId}` },
        automationConsent.consent,
      ),
    ),
  )
  const releaseMaterials = plugins.setMaterialHost((owner) =>
    workspace.materialApi(owner, (id) =>
      plugins.pluginRuntime.installations
        .find((entry) => entry.plugin.id === owner.pluginId)
        ?.importers?.find((entry) => entry.id === id),
    ),
  )
  onScopeDispose(releaseMaterials)
  const readingProgress = useReadingProgress(workspace)
  const offline = useOffline()
  const { library, ready, busy, loadError, backups, backupError } = workspace
  const collection = computed(() => {
    const scope = workspace.scope.value
    if (!ready.value || !scope) return undefined
    return workspace.collectionApi(() =>
      plugins.pluginRuntime.installations.flatMap((installation) =>
        (installation.importers ?? []).map((importer) => ({
          pluginId: installation.plugin.id,
          id: importer.id,
          title: importer.title,
          extensions: importer.extensions,
          current: () =>
            workspace.scope.value === scope &&
            plugins.pluginRuntime.installations.some(
              (entry) =>
                entry.instanceId === installation.instanceId && entry.importers?.includes(importer),
            ),
          parse: (file, files, signal) =>
            plugins.parseMaterialFile(installation.plugin.id, importer.id, file, { signal, files }),
        })),
      ),
    )
  })
  const sourceConnections = useSourceConnections(workspace, plugins)
  const capture = useNativeCollection(workspace, collection)
  const base = {
    input,
    menus,
    sourceConnections,
    capture,
    workspace,
    readingProgress,
    offline,
    library,
    ready,
    busy,
    loadError,
    backups,
    backupError,
    collection,
  }
  const clock = useStudyClock()
  const views = useStudyViews()
  const leaveReading = useReadingLeaveGuard({
    scope: workspace.scope,
    busy,
    ...views,
    reading: readingProgress,
  })
  let activity: ReturnType<typeof useStudyActivity> | undefined
  function beforeLeave(allowBackgroundSave = false): boolean | Promise<boolean> {
    const expectedScope = workspace.scope.value
    const reading = leaveReading(allowBackgroundSave)
    if (allowBackgroundSave) return reading
    return Promise.resolve(reading).then(async (allowed) => {
      if (!allowed) return false
      try {
        await activity?.flush()
        return true
      } catch {
        if (workspace.scope.value === expectedScope)
          notify('学习活动记录尚未保存，请重试后再关闭或切换学习库。', 'error')
        return false
      }
    })
  }
  const navigation = useAppNavigation(undefined, () => beforeLeave(true))
  activity = useStudyActivity(
    workspace,
    computed(() => {
      if (navigation.mixed.value) return views.mixedController.value?.activityKind ?? 'other'
      if (navigation.review.value)
        return navigation.review.value.study && !navigation.review.value.study.reschedule
          ? 'practice'
          : 'review'
      return views.activeSource.value?.studying ? 'reading' : 'other'
    }),
  )
  const studyActivity = activity
  onScopeDispose(plugins.setStudyHost((owner) => workspace.studyApi(owner, studyActivity)))
  const extensions = usePluginViews(navigation, workspace.scope, plugins)
  const readPluginReviews = createPluginReviewReader()
  const pluginReviews = computed(() => readPluginReviews(library.value.reviews))
  const queries = useLibraryQueries({ ...base, ...clock, ...navigation })
  const runner = useOperationRunner({ ...base, ...clock })
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
  const deviceSync = useDeviceSync(
    workspace,
    computed(() => {
      if (!ready.value) return '请先打开桌面工作目录。'
      if (busy.value) return '学习库正在保存，请稍后再合入。'
      if (navigation.review.value || navigation.mixed.value)
        return '请先结束当前复习，再合入同步更新。'
      if (navigation.modal.value || views.activeSource.value || views.mixedReader.value)
        return '请先结束阅读或编辑，再合入同步更新。'
      return null
    }),
    () => plugins.reloadPlugins(),
  )
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
    beforeLeave,
    beforeClose: () => studyActivity.close(),
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
    beforeLeave,
    pluginReviews,
    automationConsent,
    networkConsent,
    deviceSync,
    pageTitle: computed(() =>
      extensions.activePluginPage.value
        ? t(extensions.activePluginPage.value.contribution.title)
        : queries.pageTitle.value,
    ),
  }
}
