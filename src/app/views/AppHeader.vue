<script setup lang="ts">
import { UiButton } from '../../components/ui'
import { t } from '../../i18n'
import { ChevronRight, Undo2, Redo2 } from '@lucide/vue'
import { remoteWorkspace, desktopEdition } from '../../edition'
import { AccountControls, DraftWorkbench } from '@repeaty-platform'
import { useApplication } from '../context'
const {
  workspace,
  mcpSelection,
  review,
  mixed,
  pageTitle,
  shortcutLocked,
  canUndoAction,
  undoTitle,
  undoLastAction,
  canRedoAction,
  redoTitle,
  redoLastAction,
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
        variant="ghost"
        :disabled="shortcutLocked || !canRedoAction"
        :title="redoTitle"
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        @click="redoLastAction"
      >
        <Redo2 :size="18" />{{ t('重做') }}
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
    </div>
  </header>
</template>
