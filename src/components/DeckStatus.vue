<script setup lang="ts">
import { t } from '../i18n'
import type { DeckStudyStatus } from '../core/deck-status'
defineProps<{ status: DeckStudyStatus; compact?: boolean }>()
</script>
<template>
  <section :class="['deck-study-status', { compact }]" :aria-label="t('卡组学习状态')">
    <p class="state-label">{{ t('今日可学') }}</p>
    <dl>
      <div class="new">
        <dt>{{ t('新卡') }}</dt>
        <dd>{{ status.newReady }}</dd>
      </div>
      <div class="learning">
        <dt>{{ t('学习中') }}</dt>
        <dd>{{ status.learningReady }}</dd>
      </div>
      <div class="review">
        <dt>{{ t('待复习') }}</dt>
        <dd>{{ status.reviewReady }}</dd>
      </div>
    </dl>
    <p class="state-detail">
      {{
        t('未学 {new} 张 · 稍后到期 {future} 张', { new: status.newTotal, future: status.future })
      }}
    </p>
    <p v-if="status.limited" class="state-detail">
      {{ t('另有 {count} 张已达今日额度', { count: status.limited }) }}
    </p>
    <p v-if="!compact && (status.suspended || status.buried)" class="state-detail">
      {{
        t('暂停 {suspended} 张 · 今日暂缓 {buried} 张', {
          suspended: status.suspended,
          buried: status.buried,
        })
      }}
    </p>
  </section>
</template>
<style scoped>
.deck-study-status {
  padding: 1.25rem 1.5rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  margin-bottom: 1.5rem;
}
.deck-study-status.compact {
  padding: 0;
  border: 0;
  margin: 1rem 0;
  background: transparent;
}
.state-label {
  font-size: var(--font-size-meta);
  color: var(--ui-text-muted);
  margin: 0 0 0.65rem;
}
dl {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin: 0;
}
dl > div {
  min-width: 3.5rem;
  display: flex;
  flex-direction: column-reverse;
  gap: 0.2rem;
}
dt {
  font-size: var(--font-size-meta);
}
dd {
  margin: 0;
  font-size: var(--font-size-display);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
}
.new {
  color: var(--ui-info);
}
.learning {
  color: var(--ui-warning);
}
.review {
  color: var(--ui-success);
}
.state-detail {
  font-size: var(--font-size-meta);
  color: var(--ui-text-muted);
  line-height: var(--line-height-ui);
  margin: 0.75rem 0 0;
}
</style>
