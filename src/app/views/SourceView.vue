<script setup lang="ts">
import SourceConnections from '../../components/SourceConnections.vue'
import { useApplication } from '../context'
import { SourcePanel } from '../view-components'
const emit = defineEmits<{ settings: [category: string] }>()
const {
  workspace,
  collection,
  sourceConnections,
  capture,
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
    :collection="collection"
    :read-clipboard="capture.readClipboard"
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
    @settings="emit('settings', $event)"
  >
    <template #connections>
      <SourceConnections
        :controller="sourceConnections"
        :collection="collection"
        :sources="workspace.library.value.sources"
        :get-source="workspace.getSource"
        @settings="emit('settings', 'connections')"
      />
    </template>
  </SourcePanel>
</template>
