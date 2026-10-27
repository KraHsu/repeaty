<script setup lang="ts">
import AppSidebar from './app/views/AppSidebar.vue'
import AppHeader from './app/views/AppHeader.vue'
import OverviewPage from './app/views/OverviewPage.vue'
import CardsPage from './app/views/CardsPage.vue'
import BackupPage from './app/views/BackupPage.vue'
import StudyView from './app/views/StudyView.vue'
import SourceView from './app/views/SourceView.vue'
import EditorDialogs from './app/views/EditorDialogs.vue'
import BackupDialogs from './app/views/BackupDialogs.vue'
import StudyDialogs from './app/views/StudyDialogs.vue'
import { t } from './i18n'
import { Database, Repeat2 } from '@lucide/vue'
import NotificationCenter from './components/NotificationCenter.vue'
import { remoteWorkspace } from './edition'
import {
  ServerConnection,
  PlatformSettings,
  WorkspaceBrowser,
  WorkspaceNotice,
  DesktopTitlebar,
  workspaceAvailable,
} from '@repeaty-platform'
import { createApplication } from './app/createApplication'
import { provideApplication } from './app/context'
import { PracticeHistoryPanel, SettingsPage } from './app/view-components'
const application = createApplication()
provideApplication(application)
const {
  workspace,
  library,
  ready,
  busy,
  loadError,
  refreshClock,
  tab,
  historyCardId,
  review,
  mixed,
  navigate,
  run,
} = application
</script>
<template>
  <div class="app-layout" :class="{ 'desktop-window': DesktopTitlebar }">
    <component v-if="DesktopTitlebar" :is="DesktopTitlebar" />
    <AppSidebar />
    <main class="main-content">
      <AppHeader /><NotificationCenter />
      <component
        :is="WorkspaceNotice"
        v-if="WorkspaceNotice"
        :scope="workspace.scope.value"
        @open="navigate('workspace')"
      />
      <WorkspaceBrowser
        v-if="
          WorkspaceBrowser &&
          (tab === 'workspace' || (!workspaceAvailable && tab !== 'settings' && tab !== 'plugins'))
        "
        :workspace="workspace"
        @changed="refreshClock"
      />
      <SettingsPage
        v-else-if="tab === 'plugins' || tab === 'settings'"
        :key="tab"
        :initial-tab="tab === 'plugins' ? 'plugins' : 'general'"
        :platform-settings="PlatformSettings"
      />
      <section v-else-if="loadError" class="empty-state">
        <Database :size="36" />
        <h1>{{ t(remoteWorkspace ? '无法连接服务' : '本地存储暂不可用') }}</h1>
        <p role="alert">{{ t(loadError) }}</p>
        <ServerConnection v-if="remoteWorkspace" :busy="busy" @connect="workspace.init()" />
      </section>
      <section v-else-if="!ready" class="empty-state" role="status">
        <Repeat2 :size="32" />
        <p>{{ t('正在加载…') }}</p>
      </section>
      <StudyView v-else-if="mixed || review" />
      <OverviewPage v-else-if="tab === 'overview'" />
      <CardsPage v-else-if="tab === 'cards'" />
      <PracticeHistoryPanel
        v-else-if="tab === 'history'"
        :key="workspace.scope.value"
        v-model:card-id="historyCardId"
        :library="library"
        :get-attempt="workspace.getAttempt"
        @reveal="(id) => run(() => workspace.revealPracticeHistory(id, workspace.scope.value))"
      />
      <SourceView v-else-if="tab === 'sources'" />
      <BackupPage v-else />
    </main>
    <EditorDialogs /><BackupDialogs /><StudyDialogs />
  </div>
</template>
