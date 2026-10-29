<script setup lang="ts">
import { useApplication } from '../context'
import { SourcePanel } from '../view-components'
const {
  workspace,
  autoStartReading,
  mcpSelection,
  cards,
  notice,
  activeSource,
  editCard,
  createFromExcerpt,
  sourceBindings,
  startReview,
} = useApplication()

function bindActiveSource(instance: unknown) {
  activeSource.value = instance as typeof activeSource.value
}
</script>
<template>
  <SourcePanel
    :get-media="workspace.getMedia"
    :ref="bindActiveSource"
    :key="workspace.scope.value"
    v-bind="sourceBindings"
    :auto-start="autoStartReading"
    @start-handled="autoStartReading = false"
    @review="startReview()"
    @create="createFromExcerpt"
    @share="mcpSelection = $event"
    @edit="(id) => editCard(cards.find((card) => card.noteId === id))"
    @clear-notice="notice = null"
  />
</template>
