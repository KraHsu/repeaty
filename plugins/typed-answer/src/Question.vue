<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { QuestionProps } from '@repeaty/plugin-api'
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
  <div v-if="data.success" class="form-field">
    <label for="typed-answer">Your answer</label>
    <input id="typed-answer" v-model="answer" :disabled="revealed" autocomplete="off" />
  </div>
  <p v-else role="alert">This card has invalid answer data. Edit it before reviewing.</p>
</template>
