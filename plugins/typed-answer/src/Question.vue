<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { SettingField, type QuestionProps } from '@repeaty/plugin-api'
import { dataSchema, matches } from './model'
const props = defineProps<QuestionProps>()
const answer = ref('')
const data = computed(() => dataSchema.safeParse(props.card.plugin?.data))
watchEffect(() => {
  props.state.busy = false
  props.state.allowedGrades =
    data.value.success && matches(answer.value, data.value.data.answer) ? [1, 2, 3, 4] : [1]
})
</script>
<template>
  <p class="card-question">{{ card.front }}</p>
  <SettingField
    v-if="data.success"
    id="typed-answer"
    type="text"
    label="Your answer"
    layout="stack"
    :model-value="answer"
    :disabled="revealed"
    autocomplete="off"
    @update:model-value="answer = String($event)"
  />
  <p v-else role="alert">This card has invalid answer data. Edit it before reviewing.</p>
</template>
