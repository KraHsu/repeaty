<script setup lang="ts">
import { computed } from 'vue'
import type { NoteInput } from '../../../src/core/model'
const props = defineProps<{ modelValue: NoteInput }>()
const emit = defineEmits<{ 'update:modelValue': [value: NoteInput] }>()
const question = computed({
  get: () => props.modelValue.front,
  set: (front) => emit('update:modelValue', { ...props.modelValue, front }),
})
const answer = computed({
  get: () => String(props.modelValue.plugin?.data.answer ?? ''),
  set: (answer) =>
    emit('update:modelValue', {
      ...props.modelValue,
      plugin: { id: 'typed-answer', version: 1, data: { answer } },
    }),
})
</script>
<template>
  <div class="form-field">
    <label for="typed-question">Question</label>
    <textarea id="typed-question" v-model="question" required maxlength="10000" />
  </div>
  <div class="form-field">
    <label for="typed-expected">Expected answer</label>
    <input id="typed-expected" v-model="answer" required pattern=".*\S.*" maxlength="1000" />
  </div>
</template>
