<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { ReviewPanelProps } from '@repeaty/plugin-api'
import { preferences, initializePreferences } from './preferences'
import { locale, t } from './i18n'
const props = defineProps<ReviewPanelProps>()
onMounted(initializePreferences)
const entries = computed(() => {
  const found = []
  for (let i = props.reviews.length - 1; i >= 0 && found.length < preferences.historyLength; i--) {
    const review = props.reviews[i]!
    if (review.cardId === props.card.id) found.push(review)
  }
  return found.reverse()
})
const names = ['重来', '困难', '良好', '简单']
</script>
<template>
  <ol
    v-if="!preferences.historyAfterReveal || revealed"
    class="review-history-dots"
    :aria-label="t('当前卡片的答题历史')"
  >
    <li
      v-for="entry in entries"
      :key="entry.id"
      :class="['history-dot', `rating-${entry.rating}`]"
      :title="`${t(names[entry.rating - 1]!)} · ${new Date(entry.reviewedAt).toLocaleString(locale)}`"
    >
      <span class="sr-only"
        >{{ t(names[entry.rating - 1]!) }} ·
        {{ new Date(entry.reviewedAt).toLocaleString(locale) }}</span
      >
    </li>
    <li class="history-dot current" :title="t('本次作答')">
      <span class="sr-only">{{ t('本次作答') }}</span>
    </li>
  </ol>
</template>
<style scoped>
.review-history-dots {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  margin: 0.25rem auto 1rem;
  padding: 0.25rem 1.25rem;
  list-style: none;
  max-width: 850px;
}
.history-dot {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  border-radius: 50%;
  border: 2px solid #ffffffb3;
  box-shadow: 0 0 0 1px #253d3426;
}
.rating-1 {
  background: #ba5c4c;
}
.rating-2 {
  background: #c39437;
}
.rating-3 {
  background: #49765c;
}
.rating-4 {
  background: #527ba8;
}
.history-dot.current {
  width: 22px;
  height: 22px;
  flex-basis: 22px;
  border: 2px dashed #728172;
  box-shadow: none;
  background: transparent;
}
</style>
