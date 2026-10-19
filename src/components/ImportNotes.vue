<script setup lang="ts">
import { t, msg, LocalizedError, locale, type DisplayMessage } from '../i18n'

import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { parseNoteImport, noteKey } from '../core/batch'
import { variants, type Library, type NoteInput } from '../core/model'
import type { AnkiPackage } from '../core/anki/types'
const ImportAnki = defineAsyncComponent(() => import('./ImportAnki.vue'))
const props = defineProps<{
  library: Library
  deckId?: string
  busy: boolean
  workspaceScope: string
  importAnki: (data: AnkiPackage, deckId: string, scope: string) => Promise<boolean>
}>()
const importScope = props.workspaceScope
const emit = defineEmits<{ import: [notes: NoteInput[], skip: boolean]; close: [] }>()
const exampleUrl = computed(
  () => `${import.meta.env.BASE_URL}${locale.value === 'en' ? 'example.en.csv' : 'example.csv'}`,
)
const selectedDeck = ref(props.deckId || props.library.decks[0]?.id || '')
const format = ref<'table' | 'anki'>('table')
const delimiter = ref<',' | '\t'>(',')
const text = ref(''),
  error = ref<DisplayMessage>(''),
  preview = ref<NoteInput[]>([]),
  skip = ref(true)
watch([text, selectedDeck, delimiter], () => {
  preview.value = []
  error.value = ''
})
const duplicates = computed(() => {
  const seen = new Set(props.library.notes.map(noteKey))
  let count = 0
  for (const note of preview.value) {
    const key = noteKey(note)
    if (seen.has(key)) count++
    seen.add(key)
  }
  return count
})
function validate() {
  try {
    preview.value = parseNoteImport(text.value, selectedDeck.value, delimiter.value)
    error.value = ''
  } catch (issue) {
    preview.value = []
    error.value = issue as Error
  }
}
async function fileChanged(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 2 * 1024 * 1024) throw new LocalizedError(msg('CSV / TSV 文件不能超过 2 MB。'))
    delimiter.value = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ','
    text.value = await file.text()
  } catch (issue) {
    error.value = issue as Error
  }
  input.value = ''
}
</script>
<template>
  <div class="editor-form import-notes">
    <label for="import-format">{{ t('导入格式') }}</label>
    <select id="import-format" v-model="format" :disabled="busy">
      <option value="table">CSV / TSV</option>
      <option value="anki">{{ t('Anki .apkg') }}</option>
    </select>
    <label for="import-deck">{{ t('导入到卡组') }}</label>
    <select id="import-deck" v-model="selectedDeck" required :disabled="busy">
      <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">{{ deck.name }}</option>
    </select>
    <ImportAnki
      v-if="format === 'anki'"
      :library="library"
      :deck-id="selectedDeck"
      :busy="busy"
      :submit="(data, deckId) => importAnki(data, deckId, importScope)"
      @close="emit('close')"
    />
    <form v-else class="editor-form import-table-form" @submit.prevent="validate">
      <p class="form-note">
        {{
          t(
            '支持 UTF-8 CSV / TSV，最多 5000 条。type 为 basic、reversed 或 cloze；tags 用 | 分隔。支持带引号的逗号与多行字段。',
          )
        }}
      </p>
      <a class="text-button" :href="exampleUrl" download>{{ t('下载 CSV 示例') }}</a>
      <label for="import-file">{{ t('选择 CSV / TSV 文件') }}</label
      ><input
        id="import-file"
        type="file"
        accept=".csv,.tsv,text/csv,text/tab-separated-values"
        @change="fileChanged"
      />
      <label for="import-delimiter">{{ t('分隔符') }}</label
      ><select id="import-delimiter" v-model="delimiter">
        <option value=",">{{ t('逗号 CSV') }}</option>
        <option :value="'\t'">{{ t('制表符 TSV') }}</option>
      </select>
      <label for="import-text">{{ t('或粘贴表格文本') }}</label
      ><textarea
        id="import-text"
        v-model="text"
        required
        rows="7"
        :placeholder="t('type,front,back,tags\nbasic,hello,你好,英语|问候')"
      />
      <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
      <div v-if="preview.length" class="import-preview">
        <p>
          {{
            t('共 {p0} 条笔记，将生成 {p1} 张卡片；其中 {p2} 条重复。', {
              p0: preview.length,
              p1: preview.reduce((sum, note) => sum + variants(note).length, 0),
              p2: duplicates,
            })
          }}
        </p>
        <ol>
          <li v-for="(note, i) in preview.slice(0, 5)" :key="i">{{ note.front }}</li>
        </ol>
        <label class="check-line"
          ><input v-model="skip" type="checkbox" />{{
            t('跳过同卡组中类型、格式、正面和背面均相同的笔记')
          }}</label
        >
      </div>
      <div class="form-actions">
        <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
          {{ t('取消') }}</button
        ><button v-if="!preview.length" class="button primary" :disabled="busy">
          {{ t('检查并预览') }}</button
        ><button
          v-else
          type="button"
          class="button primary"
          :disabled="busy"
          @click="emit('import', preview, skip)"
        >
          {{ t('确认导入') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.import-notes {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 28px;
}
.import-notes :deep(.form-actions) {
  position: sticky;
  bottom: -20px;
  background: #fff;
  padding: 16px 28px;
  margin-inline: -28px;
  box-shadow: 0 -4px 12px #293d3308;
}
@media (max-width: 720px) {
  .import-notes {
    padding: 18px;
  }
  .import-notes :deep(.form-actions) {
    bottom: -18px;
    padding: 14px 18px;
    margin-inline: -18px;
  }
}
</style>
