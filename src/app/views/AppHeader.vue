<script setup lang="ts">
import { UiButton } from '../../components/ui'
import { t, locale } from '../../i18n'
import { ChevronRight, CircleHelp, Undo2 } from '@lucide/vue'
import { remoteWorkspace, desktopEdition } from '../../edition'
import { AccountControls, DraftWorkbench } from '@repeaty-platform'
import { useApplication } from '../context'
const {
  workspace,
  now,
  mcpSelection,
  review,
  mixed,
  modal,
  pageTitle,
  shortcutLocked,
  canUndoAction,
  undoTitle,
  undoLastAction,
} = useApplication()
</script>
<template>
  <header class="topbar">
    <div class="breadcrumb">
      Repeaty<ChevronRight :size="14" /><strong>{{
        mixed ? t('混合学习') : review ? t('复习') : pageTitle
      }}</strong>
    </div>
    <div class="topbar-tools">
      <UiButton
        variant="ghost"
        type="submit"
        :disabled="shortcutLocked || !canUndoAction"
        :title="undoTitle"
        aria-keyshortcuts="Control+Z Meta+Z"
        @click="undoLastAction"
      >
        <Undo2 :size="18" />{{ t('撤销') }}
      </UiButton>
      <UiButton
        v-bind="{ variant: 'ghost', icon: true }"
        type="submit"
        :aria-label="t('快捷键')"
        :title="t('快捷键') + ' · ?'"
        @click="modal = 'shortcuts'"
      >
        <CircleHelp :size="18" />
      </UiButton>
      <component
        v-if="DraftWorkbench"
        :is="DraftWorkbench"
        :workspace="workspace"
        :selection="mcpSelection"
        @close-selection="mcpSelection = undefined"
      />
      <component
        v-if="AccountControls && (!desktopEdition || remoteWorkspace)"
        :is="AccountControls"
      />
      <span class="today-date">{{
        new Intl.DateTimeFormat(locale, {
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        }).format(now)
      }}</span>
    </div>
  </header>
</template>
