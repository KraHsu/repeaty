<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { en, zh_cn as zhCN } from '@nuxt/ui/locale'
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
import { t, locale } from './i18n'
import { Database, Repeat2 } from '@lucide/vue'
import NotificationCenter from './components/NotificationCenter.vue'
import PluginViewBoundary from './components/PluginViewBoundary.vue'
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
import { SIDEBAR_MIN_WIDTH, useSidebarLayout } from './app/useSidebarLayout'
import { useColorTheme } from './app/useColorTheme'
useColorTheme()
const PluginPanel = defineAsyncComponent(() => import('./components/PluginPanel.vue'))
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
  activePluginPage,
  historyCardId,
  review,
  mixed,
  navigate,
  run,
} = application
const {
  width: sidebarWidth,
  maxWidth: sidebarMaxWidth,
  collapsed: sidebarCollapsed,
  canToggle: canToggleSidebar,
  toggle: toggleSidebar,
  resizing: sidebarResizing,
  vertical: verticalSidebar,
  startResize,
  moveResize,
  endResize,
  cancelResize,
  resizeWithKeyboard,
  resetWidth,
} = useSidebarLayout({ desktop: !!DesktopTitlebar, scope: workspace.scope, ready })
const settingsTarget = ref<string>()
const detailsTarget = ref<string>()
function configurePlugin(id: string) {
  settingsTarget.value = id
  navigate('settings')
}
function showPluginDetails(id: string) {
  detailsTarget.value = id
  navigate('plugins')
}
watch(tab, (page) => {
  if (page !== 'settings') settingsTarget.value = undefined
  if (page !== 'plugins') detailsTarget.value = undefined
})
watch(workspace.scope, () => {
  settingsTarget.value = undefined
  detailsTarget.value = undefined
})
</script>
<template>
  <UApp :locale="locale === 'en' ? en : zhCN" :toaster="null">
    <div
      class="app-layout"
      :class="{
        'desktop-window': DesktopTitlebar,
        'sidebar-collapsed': sidebarCollapsed,
        'sidebar-resizing': sidebarResizing,
      }"
      :style="{ '--sidebar-width': `${sidebarWidth}px` }"
    >
      <component v-if="DesktopTitlebar" :is="DesktopTitlebar" />
      <AppSidebar
        :collapsed="sidebarCollapsed"
        :can-toggle="canToggleSidebar"
        @toggle="toggleSidebar"
      />
      <div
        v-if="verticalSidebar"
        class="sidebar-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('调整侧栏宽度')"
        :aria-valuemin="SIDEBAR_MIN_WIDTH"
        :aria-valuemax="sidebarMaxWidth"
        :aria-valuenow="sidebarWidth"
        @pointerdown="startResize"
        @pointermove="moveResize"
        @pointerup="endResize"
        @pointercancel="cancelResize"
        @lostpointercapture="cancelResize"
        @keydown="resizeWithKeyboard"
        @dblclick="resetWidth"
      />
      <main class="main-content" tabindex="-1">
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
            (tab === 'workspace' ||
              (!workspaceAvailable && tab !== 'settings' && tab !== 'plugins'))
          "
          :workspace="workspace"
          @changed="refreshClock"
        />
        <SettingsPage
          v-else-if="tab === 'settings'"
          :key="workspace.scope.value"
          :platform-settings="PlatformSettings"
          :focus-plugin="settingsTarget"
          @plugin-details="showPluginDetails"
        />
        <PluginPanel
          v-else-if="tab === 'plugins'"
          :key="workspace.scope.value"
          :focus-plugin="detailsTarget"
          @configure="configurePlugin"
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
        <div
          v-else-if="tab === 'plugin-page' && activePluginPage"
          :key="activePluginPage.key"
          class="plugin-page-host"
        >
          <PluginViewBoundary
            kind="page"
            :title="t(activePluginPage.contribution.title)"
            :component="activePluginPage.contribution.component"
            :scope="activePluginPage.scope"
          />
        </div>
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
  </UApp>
</template>
