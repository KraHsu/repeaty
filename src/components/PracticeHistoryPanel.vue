<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search } from '@lucide/vue'
import { t } from '../i18n'
import type { Library } from '../core/model'
import type { Attempt, AttemptRecord } from '../core/practice-data'
import { usePlugins } from '../plugins'
const { questionPlugin } = usePlugins()
import PracticeHistory from './PracticeHistory.vue'

const props = defineProps<{
  library: Library
  getAttempt?: (id: string, signal?: AbortSignal) => Promise<Attempt>
}>()
const emit = defineEmits<{ reveal: [practiceId: string] }>()
const cardId = defineModel<string>('cardId', { default: '' })
const query = ref('')
const deckId = ref('')
const outcome = ref('all')
const page = ref(1)
const pageSize = 20
const notes = computed(() => new Map(props.library.notes.map((note) => [note.id, note])))
const cards = computed(() => new Map(props.library.cards.map((card) => [card.id, card])))
const attempts = computed(() => {
  const grouped = new Map<string, AttemptRecord[]>()
  for (const attempt of props.library.attempts) {
    const group = grouped.get(attempt.practiceId) ?? []
    group.push(attempt)
    grouped.set(attempt.practiceId, group)
  }
  return grouped
})
const questions = computed(() => {
  const unique = new Map<string, string>()
  for (const practice of props.library.practices) {
    const card = cards.value.get(practice.cardId)
    unique.set(
      practice.cardId,
      notes.value.get(card?.noteId ?? '')?.front ?? practice.question.front,
    )
  }
  return [...unique].sort((a, b) => a[1].localeCompare(b[1]))
})
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return props.library.practices
    .filter((practice) => {
      const card = cards.value.get(practice.cardId)
      if (cardId.value && practice.cardId !== cardId.value) return false
      const current = notes.value.get(card?.noteId ?? '')
      if (deckId.value && current?.deckId !== deckId.value) return false
      if (
        search &&
        !`${practice.question.front}\n${current?.front ?? ''}`.toLocaleLowerCase().includes(search)
      )
        return false
      const records = attempts.value.get(practice.id) ?? []
      if (outcome.value === 'unconfirmed')
        return records.some((entry) => ['unknown', 'submitting', 'pending'].includes(entry.status))
      return outcome.value === 'all' || records.at(-1)?.result?.outcome === outcome.value
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visible = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize).map((practice) => ({
    practice,
    attempts: attempts.value.get(practice.id) ?? [],
    renderer:
      questionPlugin({ type: 'plugin', plugin: practice.question.plugin }).history ??
      PracticeHistory,
  })),
)
watch([cardId, query, deckId, outcome], () => {
  page.value = 1
})
watch(pages, (total) => {
  page.value = Math.min(page.value, total)
})
watch(questions, (entries) => {
  if (cardId.value && !entries.some(([id]) => id === cardId.value)) cardId.value = ''
})
</script>
<template>
  <section class="page practice-history-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('练习历史') }}</h1>
        <p>{{ t('按题目查看历次代码、判题结果和复习评分。') }}</p>
      </div>
    </header>
    <div class="history-filters">
      <label class="search-field"
        ><Search :size="18" /><input
          v-model="query"
          :aria-label="t('搜索练习历史')"
          :placeholder="t('搜索题目')"
          maxlength="1000"
      /></label>
      <label
        >{{ t('题目')
        }}<select v-model="cardId" :aria-label="t('筛选题目')">
          <option value="">{{ t('全部题目') }}</option>
          <option v-for="[id, title] in questions" :key="id" :value="id">{{ title }}</option>
        </select></label
      >
      <label
        >{{ t('卡组')
        }}<select v-model="deckId" :aria-label="t('筛选卡组')">
          <option value="">{{ t('全部卡组') }}</option>
          <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">
            {{ deck.name }}
          </option>
        </select></label
      >
      <label
        >{{ t('判题结果')
        }}<select v-model="outcome" :aria-label="t('判题结果')">
          <option value="all">{{ t('全部结果') }}</option>
          <option value="accepted">{{ t('通过') }}</option>
          <option value="rejected">{{ t('未通过') }}</option>
          <option value="unconfirmed">{{ t('尚未确认') }}</option>
        </select></label
      >
    </div>
    <p class="form-note" role="status">{{ t('{count} 次练习', { count: filtered.length }) }}</p>
    <p v-if="library.practices.some((entry) => !entry.completedAt)" class="form-note">
      {{ t('有未完成的同题练习时，查看往次代码会计为查看答案。') }}
    </p>
    <div v-if="!filtered.length" class="history-empty">
      <p>
        {{
          t(
            library.practices.length
              ? '没有符合筛选条件的练习。'
              : '还没有练习记录。提交题目后可在这里查看。',
          )
        }}
      </p>
    </div>
    <div v-else class="history-records">
      <component
        v-for="entry in visible"
        :is="entry.renderer"
        :key="entry.practice.id"
        :practices="[entry.practice]"
        :attempts="entry.attempts"
        :get-attempt="getAttempt"
        standalone
        @reveal="emit('reveal', $event)"
      />
    </div>
    <nav v-if="pages > 1" class="pagination" :aria-label="t('练习历史分页')">
      <button class="button secondary" :disabled="page <= 1" @click="page--">
        {{ t('上一页') }}
      </button>
      <span>{{ t('第 {page} / {pages} 页', { page, pages }) }}</span>
      <button class="button secondary" :disabled="page >= pages" @click="page++">
        {{ t('下一页') }}
      </button>
    </nav>
  </section>
</template>
<style scoped>
.history-filters {
  display: grid;
  grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 1rem;
}
.history-filters label {
  min-width: 0;
}
.search-field {
  margin: 0;
  height: 46px;
}
.history-filters select {
  width: 100%;
}
.history-records {
  display: grid;
  gap: 1rem;
}
.history-empty {
  padding: 2rem 0;
  line-height: 1.7;
}
@media (max-width: 1000px) {
  .history-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .history-filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
