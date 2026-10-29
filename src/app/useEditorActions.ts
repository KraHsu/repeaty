import { msg, type DisplayMessage } from '../i18n'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import ReviewSession from '../components/ReviewSession.vue'
import type { SourceExcerpt } from '../core/source-data'
import { desktopEdition } from '../edition'
import {
  type CardView,
  type NoteInput,
  type MediaUpload,
  type Deck,
  type DeckInput,
} from '../core/model'
import type { useLibrary } from '../composables/useLibrary'
import type { useOperationRunner } from './useOperationRunner'
import type { useAppNavigation } from './useAppNavigation'
import type { useStudyViews } from './useStudyViews'
import type { useLibraryQueries } from './useLibraryQueries'
export function useEditorActions({
  library,
  notice,
  modal,
  activeReview,
  workspace,
  run,
  navigate,
  selectedDeck,
  cards,
}: {
  library: ReturnType<typeof useLibrary>['library']
  notice: ReturnType<typeof useOperationRunner>['notice']
  modal: ReturnType<typeof useAppNavigation>['modal']
  activeReview: ReturnType<typeof useStudyViews>['activeReview']
  workspace: ReturnType<typeof useLibrary>
  run: ReturnType<typeof useOperationRunner>['run']
  navigate: ReturnType<typeof useAppNavigation>['navigate']
  selectedDeck: ReturnType<typeof useAppNavigation>['selectedDeck']
  cards: ReturnType<typeof useLibraryQueries>['cards']
}) {
  const reviewEditTarget = ref<{ id: string; noteId: string; scope: string }>()
  let reviewEditorOwner: InstanceType<typeof ReviewSession> | undefined
  const editingId = ref<string>()
  const sourceDraft = ref<Partial<NoteInput>>()
  const deckForm = reactive<DeckInput>({
    name: '',
    description: '',
    color: 'sage',
    newLimit: 20,
    reviewLimit: 200,
    burySiblings: true,
    leechThreshold: 8,
    desiredRetention: 0.9,
  })
  const retentionPercent = computed({
    get: () => Math.round(deckForm.desiredRetention * 100),
    set: (value: number) => {
      deckForm.desiredRetention = value / 100
    },
  })
  const editingNote = computed(() =>
    library.value.notes.find((note) => note.id === editingId.value),
  )
  const confirmation = ref<{
    title: string
    message: DisplayMessage
    action: () => Promise<void>
  }>()
  function editDeck(deck?: Deck) {
    notice.value = null
    editingId.value = deck?.id
    Object.assign(deckForm, {
      name: deck?.name ?? '',
      description: deck?.description ?? '',
      color: deck?.color ?? 'sage',
      newLimit: deck?.newLimit ?? 20,
      reviewLimit: deck?.reviewLimit ?? 200,
      burySiblings: deck?.burySiblings ?? true,
      leechThreshold: deck?.leechThreshold ?? 8,
      desiredRetention: deck?.desiredRetention ?? 0.9,
    })
    modal.value = 'deck'
  }
  function editCard(card?: CardView) {
    reviewEditTarget.value = undefined
    sourceDraft.value = undefined
    notice.value = null
    if (!library.value.decks.length) {
      editDeck()
      return
    }
    editingId.value = card?.noteId
    modal.value = 'card'
  }
  function editReviewCard(card: CardView) {
    editCard(card)
    reviewEditorOwner = activeReview.value
    reviewEditTarget.value = { id: card.id, noteId: card.noteId, scope: workspace.scope.value }
  }
  function openImport() {
    notice.value = null
    if (!library.value.decks.length) {
      editDeck()
      return
    }
    modal.value = 'bulkImport'
  }
  async function saveDeck() {
    const isNew = !editingId.value
    if (await run(() => workspace.saveDeck({ ...deckForm }, editingId.value), '卡组已保存')) {
      modal.value = null
      if (isNew) {
        navigate('cards', () => {
          selectedDeck.value = library.value.decks.at(-1)?.id ?? ''
        })
      }
    }
  }
  async function saveCard(input: NoteInput, assets: MediaUpload[], allowRemove: boolean) {
    const target = reviewEditTarget.value
    const owner = reviewEditorOwner
    const saved = await run(
      () =>
        sourceDraft.value?.excerpt
          ? workspace.saveExcerptNote(
              input,
              sourceDraft.value.excerpt,
              workspace.scope.value,
              assets,
              allowRemove,
            )
          : workspace.saveNote(input, editingId.value, assets, allowRemove),
      '笔记与卡片已保存',
    )
    if (
      saved &&
      target?.scope === workspace.scope.value &&
      reviewEditTarget.value === target &&
      owner === activeReview.value
    ) {
      await nextTick()
      owner?.restart(target.id, target.noteId)
    }
    return saved
  }
  function createFromExcerpt(excerpt: SourceExcerpt, format: 'plain' | 'markdown', type?: 'cloze') {
    notice.value = null
    editingId.value = undefined
    sourceDraft.value =
      type === 'cloze'
        ? { excerpt, front: `{{c1::${excerpt.quote}}}`, back: '', format, type: 'cloze' }
        : { excerpt, back: excerpt.quote, format }
    modal.value = 'card'
  }
  function addReviewCard(card: CardView) {
    editCard()
    sourceDraft.value = { deckId: card.deckId, format: card.format }
  }
  function confirmDeleteDeck(deck: Deck) {
    notice.value = null
    const count = cards.value.filter((card) => card.deckId === deck.id).length
    confirmation.value = {
      title: '删除卡组',
      message: msg(
        desktopEdition
          ? '确定删除「{name}」吗？其中的 {count} 张卡片将退出学习队列，笔记与记录仍可在工作目录中恢复。'
          : '确定删除「{name}」吗？其中的 {count} 张卡片及对应复习记录也会被删除。会先自动保存快照。',
        { name: deck.name, count },
      ),
      action: async () => {
        await workspace.deleteDeck(deck.id)
        selectedDeck.value = ''
      },
    }
    modal.value = 'confirm'
  }
  function confirmDeleteNotes(ids: string[]) {
    notice.value = null
    const selected = new Set(ids)
    const count = library.value.cards.filter((card) => selected.has(card.noteId)).length
    confirmation.value = {
      title: '删除笔记',
      message: msg(
        desktopEdition
          ? '确定移除 {notes} 条笔记及其 {cards} 张关联卡片吗？笔记与学习记录仍可在工作目录中恢复。'
          : '确定删除 {notes} 条笔记及其 {cards} 张关联卡片和复习记录吗？会先自动保存快照。',
        {
          notes: selected.size,
          cards: count,
        },
      ),
      action: () => workspace.deleteNotes(selected),
    }
    modal.value = 'confirm'
  }
  async function confirmAction() {
    if (confirmation.value && (await run(confirmation.value.action, '已删除'))) modal.value = null
  }
  watch(modal, (value) => {
    if (value !== 'card') reviewEditTarget.value = undefined
  })
  function resetEditor() {
    sourceDraft.value = undefined
    reviewEditTarget.value = undefined
    reviewEditorOwner = undefined
  }

  return {
    reviewEditTarget,
    editingId,
    sourceDraft,
    deckForm,
    retentionPercent,
    editingNote,
    confirmation,
    editDeck,
    editCard,
    editReviewCard,
    openImport,
    saveDeck,
    saveCard,
    createFromExcerpt,
    addReviewCard,
    confirmDeleteDeck,
    confirmDeleteNotes,
    confirmAction,
    resetEditor,
  }
}
