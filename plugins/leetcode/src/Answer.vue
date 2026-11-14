<script setup lang="ts">
import { t } from './i18n'
import type { QuestionProps } from '@repeaty/plugin-api'
import { MediaList } from '@repeaty/plugin-api'
import { CardContent } from '@repeaty/plugin-api'
defineProps<QuestionProps>()
</script>
<template>
  <p>
    {{
      state.assessment?.outcome === 'accepted'
        ? t('代码已通过 LeetCode 判题。')
        : t('尚未通过 LeetCode 判题，本次可记为“重来”。')
    }}
  </p>
  <template v-if="card.back"
    ><h3>{{ t('解题笔记') }}</h3>
    <CardContent :text="card.back" :format="card.format"
  /></template>
  <p v-else class="form-note">{{ t('尚未添加解题笔记。可在编辑卡片时补充思路或参考代码。') }}</p>
  <MediaList :ids="card.backMedia" :media="media" :get-media="getMedia" />
</template>
