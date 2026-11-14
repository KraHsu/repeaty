<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { t } from '../../i18n'
import type { QuestionProps } from '../../plugins/types'
import MediaList from '../MediaList.vue'
const CardContent = defineAsyncComponent(() => import('../CardContent.vue'))
defineProps<QuestionProps>()
</script>
<template>
  <template v-if="card.cloze">
    <div class="cloze-answers" :aria-label="t('挖空答案')">
      <div v-for="(answer, index) in card.cloze.answers" :key="index" class="cloze-answer">
        <CardContent
          :text="answer"
          :format="card.format"
          :inline-media="card.inlineMedia"
          :get-media="getMedia"
        />
      </div>
    </div>
    <CardContent
      :text="card.cloze.context"
      :format="card.format"
      :inline-media="card.inlineMedia"
      :get-media="getMedia"
    />
    <div v-if="card.cloze.extra" class="cloze-extra app-section-divider">
      <span class="eyebrow">{{ t('补充说明') }}</span>
      <CardContent
        :text="card.cloze.extra"
        :format="card.format"
        :inline-media="card.inlineMedia"
        :get-media="getMedia"
      />
    </div>
  </template>
  <CardContent
    v-else
    :text="card.back"
    :format="card.format"
    :inline-media="card.inlineMedia"
    :get-media="getMedia"
  />
  <MediaList :ids="card.backMedia" :media="media" :get-media="getMedia" />
</template>
