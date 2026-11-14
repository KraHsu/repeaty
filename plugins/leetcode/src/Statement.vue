<script setup lang="ts">
import { computed } from 'vue'
import { statementHtml } from './content'
const props = defineProps<{ content: string }>()
const html = computed(() => statementHtml(props.content))
</script>
<template><div class="leetcode-statement rendered-content" v-html="html" /></template>
