import { t } from '../i18n'
import { computed } from 'vue'
import { deckStudyCounts } from '../core/deck-status'
import { usePlugins } from '../plugins'
import { localDay, createCardViewReader } from '../core/model'
import { queuedSources } from '../core/source-queue'
import { blockedByLimit, dayKey, dueCards, weekActivity } from '../core/scheduler'
import type { useLibrary } from '../composables/useLibrary'
import type { useStudyClock } from './useStudyClock'
import type { useAppNavigation } from './useAppNavigation'
export function useLibraryQueries({
  library,
  coarseNow,
  now,
  selectedDeck,
  tab,
}: {
  library: ReturnType<typeof useLibrary>['library']
  coarseNow: ReturnType<typeof useStudyClock>['coarseNow']
  now: ReturnType<typeof useStudyClock>['now']
  selectedDeck: ReturnType<typeof useAppNavigation>['selectedDeck']
  tab: ReturnType<typeof useAppNavigation>['tab']
}) {
  const { canReviewCard } = usePlugins()
  const readViews = createCardViewReader()
  const cards = computed(() => readViews(library.value))
  const due = computed(() => dueCards(library.value, coarseNow.value, undefined, canReviewCard))
  const limited = computed(() =>
    blockedByLimit(library.value, coarseNow.value, undefined, canReviewCard),
  )
  const readyReading = computed(() =>
    queuedSources(library.value.sources, 'ready', localDay(coarseNow.value)),
  )
  const readyExcerpts = computed(
    () => readyReading.value.filter((source) => source.kind === 'excerpt').length,
  )
  const newCount = computed(() => due.value.filter((card) => card.schedule.state === 0).length)
  const todayReviews = computed(() =>
    library.value.reviews.filter((entry) => entry.studyDay === dayKey(now.value)),
  )
  const activity = computed(() => weekActivity(library.value, coarseNow.value))
  const maxActivity = computed(() => Math.max(4, ...activity.value.map((day) => day.count)))
  const currentDeck = computed(() =>
    library.value.decks.find((deck) => deck.id === selectedDeck.value),
  )
  const pageTitle = computed(
    () =>
      ({
        overview: t('学习概览'),
        cards: currentDeck.value?.name ?? t('全部卡片'),
        data: t('数据与备份'),
        plugins: t('插件'),
        settings: t('设置'),
        history: t('练习历史'),
        sources: t('学习材料'),
        workspace: t('工作目录'),
      })[tab.value],
  )
  function deckDue(id: string) {
    return due.value.filter((card) => card.deckId === id).length
  }
  function deckCards(id: string) {
    return deckCounts.value.get(id) ?? 0
  }
  const deckCounts = computed(() => {
    const notes = new Map(library.value.notes.map((note) => [note.id, note.deckId])),
      counts = new Map<string, number>()
    for (const card of library.value.cards) {
      const deck = notes.get(card.noteId)!
      counts.set(deck, (counts.get(deck) ?? 0) + 1)
    }
    return counts
  })
  const deckStates = computed(() =>
    deckStudyCounts(library.value, coarseNow.value, due.value, cards.value, canReviewCard),
  )
  return {
    cards,
    due,
    limited,
    readyReading,
    readyExcerpts,
    newCount,
    todayReviews,
    activity,
    maxActivity,
    currentDeck,
    pageTitle,
    deckDue,
    deckCards,
    deckCounts,
    deckStates,
  }
}
