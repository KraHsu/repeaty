<script setup lang="ts">
import UInput from '@nuxt/ui/components/Input.vue'
import USelect from '@nuxt/ui/components/Select.vue'
import UPagination from '@nuxt/ui/components/Pagination.vue'
import { UiButton } from './ui'
import AppPage from './AppPage.vue'
import { computed, ref, watch } from 'vue'
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
const cardFilter = computed<string | null>({
  get: () => cardId.value || null,
  set: (value) => {
    cardId.value = value ?? ''
  },
})
const deckFilter = computed<string | null>({
  get: () => deckId.value || null,
  set: (value) => {
    deckId.value = value ?? ''
  },
})
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
  <AppPage
    class="practice-history-page"
    :title="t('练习历史')"
    :description="t('按题目查看历次代码、判题结果和复习评分。')"
  >
    <div class="history-filters">
      <div class="history-search">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          :aria-label="t('搜索练习历史')"
          :placeholder="t('搜索题目')"
          maxlength="1000"
        />
      </div>
      <div>
        <USelect
          v-model="cardFilter"
          :aria-label="t('筛选题目')"
          :placeholder="t('全部题目')"
          :items="[
            { value: null, label: t('全部题目') },
            ...questions.map(([value, label]) => ({ value, label })),
          ]"
        />
      </div>
      <div>
        <USelect
          v-model="deckFilter"
          :aria-label="t('筛选卡组')"
          :placeholder="t('全部卡组')"
          :items="[
            { value: null, label: t('全部卡组') },
            ...library.decks.map((deck) => ({ value: deck.id, label: deck.name })),
          ]"
        />
      </div>
      <div>
        <USelect
          v-model="outcome"
          :aria-label="t('判题结果')"
          :placeholder="t('全部结果')"
          :items="[
            { value: 'all', label: t('全部结果') },
            { value: 'accepted', label: t('通过') },
            { value: 'rejected', label: t('未通过') },
            { value: 'unconfirmed', label: t('尚未确认') },
          ]"
        />
      </div>
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
      <UPagination
        v-model:page="page"
        :total="filtered.length"
        :items-per-page="pageSize"
        :show-controls="false"
      >
        <template #prev
          ><UiButton :aria-label="t('上一页')">{{ t('上一页') }}</UiButton></template
        >
        <template #next
          ><UiButton :aria-label="t('下一页')">{{ t('下一页') }}</UiButton></template
        >
      </UPagination>
      <span role="status">{{ t('第 {page} / {pages} 页', { page, pages }) }}</span>
    </nav>
  </AppPage>
</template>
<style scoped>
.history-filters {
  display: grid;
  grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 1rem;
}
.history-filters > * {
  min-width: 0;
}
.history-filters :deep([data-slot='root']) {
  width: 100%;
}
.history-records {
  display: grid;
  gap: 1rem;
}
.history-empty {
  padding: 2rem 0;
  line-height: var(--line-height-ui);
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
