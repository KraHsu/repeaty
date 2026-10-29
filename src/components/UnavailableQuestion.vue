<script setup lang="ts">
import { t } from '../i18n'
import type { QuestionProps } from '../plugins/types'
defineProps<QuestionProps>()
</script>
<template>
  <p role="alert">
    {{
      t('题目插件不可用：{id}。请更新 Repeaty 后重试，题目数据仍会保留。', {
        id: card.plugin?.id ?? '',
      })
    }}
  </p>
  <p>{{ card.front }}</p>
</template>
