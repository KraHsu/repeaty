<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import UInputMenu from '@nuxt/ui/components/InputMenu.vue'
import { t } from '../i18n'
import type { Library } from '../core/model'
import { searchCompletions, type SearchCompletion } from '../core/search-completion'

const props = defineProps<{ library: Library }>()
const query = defineModel<string>({ default: '' })
const draft = ref(query.value)
const input = ref<{ inputRef?: HTMLInputElement }>()
const caret = ref(query.value.length)
const end = ref(query.value.length)
const requestedOpen = ref(false)
const composing = ref(false)
watch(query, (value) => {
  if (!composing.value) draft.value = value
})
watch(draft, (value) => {
  if (!composing.value) query.value = value
})
const vocabulary = computed(() => ({
  tags: [...new Set(props.library.notes.flatMap((note) => note.tags))].sort(),
  decks: props.library.decks.map((deck) => deck.name).sort(),
}))
const items = computed(() =>
  searchCompletions(draft.value, caret.value, end.value, vocabulary.value).map((choice) => ({
    label: choice.token,
    description: t(choice.description),
    value: choice.query,
    onSelect: (event: Event) => {
      event.preventDefault()
      void complete(choice)
    },
  })),
)

function syncCaret() {
  const element = input.value?.inputRef
  caret.value = element?.selectionStart ?? query.value.length
  end.value = element?.selectionEnd ?? caret.value
  // Closing the suggestion popup must not render an old value over native IME text.
  // Keep the displayed draft current, but do not search until composition is committed.
  if (composing.value && element) draft.value = element.value
}

function endComposition() {
  syncCaret()
  composing.value = false
  query.value = draft.value
}

async function complete(choice: SearchCompletion) {
  if (composing.value) return
  query.value = choice.query
  requestedOpen.value = false
  await nextTick()
  const element = input.value?.inputRef
  element?.focus({ preventScroll: true })
  element?.setSelectionRange(choice.caret, choice.caret)
  syncCaret()
  requestedOpen.value = false
}

function editingKey(event: KeyboardEvent) {
  // Keep IME confirmation and native line navigation inside the input. Reka's
  // listbox otherwise treats Home/End as candidate navigation while it is open.
  if (
    composing.value ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === 'Home' ||
    event.key === 'End'
  )
    event.stopImmediatePropagation()
}
</script>

<template>
  <UInputMenu
    ref="input"
    v-model="draft"
    mode="autocomplete"
    class="search-field card-search"
    icon="i-lucide-search"
    :trailing="false"
    :items="items"
    value-key="value"
    ignore-filter
    open-on-focus
    open-on-click
    :reset-search-term-on-blur="false"
    :open="requestedOpen && items.length > 0 && !composing"
    :aria-label="t('搜索卡片')"
    :placeholder="t('关键词、tag:英语、is:due、lapses:>=3…')"
    maxlength="1000"
    :ui="{
      base: 'min-h-11',
      content: 'z-[1200] max-w-[calc(100vw-1rem)]',
      item: 'min-h-11',
      itemLabel: 'font-mono text-sm',
      itemDescription: 'text-xs',
    }"
    @update:open="requestedOpen = $event"
    @input="syncCaret"
    @focus="syncCaret"
    @click="syncCaret"
    @keyup="syncCaret"
    @select="syncCaret"
    @compositionstart="composing = true"
    @compositionend="endComposition"
    @keydown.capture="editingKey"
  />
</template>
