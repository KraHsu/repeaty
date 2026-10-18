<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseNoteImport, noteKey } from '../core/batch'
import { variants, type Library, type NoteInput } from '../core/model'
const props = defineProps<{ library: Library; deckId?: string; busy: boolean }>()
const emit = defineEmits<{ import: [notes: NoteInput[], skip: boolean]; close: [] }>()
const exampleUrl = `${import.meta.env.BASE_URL}example.csv`
const selectedDeck = ref(props.deckId || props.library.decks[0]?.id || '')
const delimiter = ref<',' | '\t'>(',')
const text = ref(''),
  error = ref(''),
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
    error.value = (issue as Error).message
  }
}
async function fileChanged(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('CSV / TSV 文件不能超过 2 MB。')
    delimiter.value = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ','
    text.value = await file.text()
  } catch (issue) {
    error.value = (issue as Error).message
  }
  input.value = ''
}
</script>
<template>
  <form class="editor-form" @submit.prevent="validate">
    <p class="form-note">
      支持 UTF-8 CSV / TSV，最多 5000 条。type 为 basic、reversed 或 cloze；tags 用 |
      分隔。支持带引号的逗号与多行字段。
    </p>
    <a class="text-button" :href="exampleUrl" download>下载 CSV 示例</a>
    <label for="import-deck">导入到卡组</label
    ><select id="import-deck" v-model="selectedDeck" required>
      <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">{{ deck.name }}</option>
    </select>
    <label for="import-file">选择 CSV / TSV 文件</label
    ><input
      id="import-file"
      type="file"
      accept=".csv,.tsv,text/csv,text/tab-separated-values"
      @change="fileChanged"
    />
    <label for="import-delimiter">分隔符</label
    ><select id="import-delimiter" v-model="delimiter">
      <option value=",">逗号 CSV</option>
      <option :value="'\t'">制表符 TSV</option>
    </select>
    <label for="import-text">或粘贴表格文本</label
    ><textarea
      id="import-text"
      v-model="text"
      required
      rows="7"
      placeholder="type,front,back,tags&#10;basic,hello,你好,英语|问候"
    />
    <p v-if="error" class="import-warning" role="alert">{{ error }}</p>
    <div v-if="preview.length" class="import-preview">
      <p>
        校验通过：{{ preview.length }} 条笔记，{{
          preview.reduce((sum, note) => sum + variants(note).length, 0)
        }}
        张卡片；{{ duplicates }} 条内容重复。
      </p>
      <ol>
        <li v-for="(note, i) in preview.slice(0, 5)" :key="i">{{ note.front }}</li>
      </ol>
      <label class="check-line"
        ><input v-model="skip" type="checkbox" />跳过同卡组中题型、正面和背面均相同的笔记</label
      >
    </div>
    <div class="form-actions">
      <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
        取消</button
      ><button v-if="!preview.length" class="button primary" :disabled="busy">校验并预览</button
      ><button
        v-else
        type="button"
        class="button primary"
        :disabled="busy"
        @click="emit('import', preview, skip)"
      >
        确认导入
      </button>
    </div>
  </form>
</template>
