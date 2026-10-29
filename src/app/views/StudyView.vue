<script setup lang="ts">
import ReviewSession from '../../components/ReviewSession.vue'
import { useApplication } from '../context'
import { SourcePanel, MixedSession } from '../view-components'
const {
  workspace,
  library,
  busy,
  now,
  mcpSelection,
  review,
  mixed,
  cards,
  notice,
  mixedReader,
  mixedController,
  activeReview,
  editCard,
  editReviewCard,
  createFromExcerpt,
  addReviewCard,
  confirmDeleteNotes,
  sourceBindings,
  undoReading,
  reviewBindings,
  leaveMixedReading,
  undoReview,
} = useApplication()

function bindMixedReader(instance: unknown) {
  mixedReader.value = instance as typeof mixedReader.value
}
function bindMixedController(instance: unknown) {
  mixedController.value = instance as typeof mixedController.value
}
function bindActiveReview(instance: unknown) {
  activeReview.value = instance as typeof activeReview.value
}
</script>
<template>
  <MixedSession
    v-if="mixed"
    :ref="bindMixedController"
    :key="workspace.scope.value"
    :library="library"
    :scope="workspace.scope.value"
    :now="now"
    :busy="busy"
    :cards-per-reading="mixed.cardsPerReading"
    :leave-reading="leaveMixedReading"
    :undo-card="undoReview"
    :undo-reading="undoReading"
    :can-undo-reading="workspace.canUndoReading.value"
    :reading-undo-id="workspace.readingUndo.value?.id"
    @close="mixed = null"
    @clear-notice="notice = null"
  >
    <template #card="{ item, done, activity }">
      <ReviewSession
        :key="item.key"
        :ref="bindActiveReview"
        v-bind="reviewBindings"
        :mixed-card-id="item.id"
        @step="done"
        @activity="activity"
        @edit="editReviewCard"
        @add="addReviewCard"
        @delete="(card) => confirmDeleteNotes([card.noteId])"
        @close="mixed = null"
      />
    </template>
    <template #reading="{ item, done, activity }">
      <SourcePanel
        :get-media="workspace.getMedia"
        :key="item.key"
        :ref="bindMixedReader"
        v-bind="sourceBindings"
        :session="{ sourceId: item.id, mediaId: item.mediaId }"
        @session-done="done"
        @activity="activity"
        @create="createFromExcerpt"
        @share="mcpSelection = $event"
        @edit="(id) => editCard(cards.find((card) => card.noteId === id))"
        @clear-notice="notice = null"
      />
    </template>
  </MixedSession>
  <ReviewSession
    v-else-if="review"
    :ref="bindActiveReview"
    v-bind="reviewBindings"
    :deck-id="review.deckId"
    :study="review.study"
    @close="review = null"
    @edit="editReviewCard"
    @add="addReviewCard"
    @delete="(card) => confirmDeleteNotes([card.noteId])"
  />
</template>
