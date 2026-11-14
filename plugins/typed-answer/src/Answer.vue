<script setup lang="ts">
import { computed } from 'vue'
import type { QuestionProps } from '@repeaty/plugin-api'
import { dataSchema } from './model'
const props = defineProps<QuestionProps>()
const data = computed(() => dataSchema.safeParse(props.card.plugin?.data))
</script>
<template>
  <p v-if="data.success" class="card-answer">{{ data.data.answer }}</p>
</template>
