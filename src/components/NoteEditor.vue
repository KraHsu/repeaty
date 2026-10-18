<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, reactive, ref } from 'vue'
import {
  noteTypes,
  variants,
  renderCard,
  newCard,
  type Library,
  type Note,
  type NoteInput,
  type MediaUpload,
} from '../core/model'
import { prepareMedia } from '../core/media'
import MediaList from './MediaList.vue'
const CardContent = defineAsyncComponent(() => import('./CardContent.vue'))
import { insertCloze } from '../core/authoring'
const props = defineProps<{
  library: Library
  note?: Note
  deckId?: string
  busy: boolean
  getMedia: (id: string) => Promise<Blob | undefined>
  submit: (input: NoteInput, uploads: MediaUpload[], allowRemove: boolean) => Promise<boolean>
}>()
const emit = defineEmits<{
  close: []
}>()
const editor = ref<HTMLFormElement>()
const frontInput = ref<HTMLTextAreaElement>()
const savedCount = ref(0)
const form = reactive<NoteInput>({
  deckId: props.note?.deckId ?? props.deckId ?? props.library.decks[0]?.id ?? '',
  type: props.note?.type ?? 'basic',
  format: props.note?.format ?? 'markdown',
  front: props.note?.front ?? '',
  back: props.note?.back ?? '',
  tags: [...(props.note?.tags ?? [])],
  frontMedia: [...(props.note?.frontMedia ?? [])],
  backMedia: [...(props.note?.backMedia ?? [])],
})
const tagsText = ref(form.tags.join(', ')),
  uploads = ref<MediaUpload[]>([]),
  error = ref(''),
  allowRemove = ref(false)
const media = computed(() => [...props.library.media, ...uploads.value.map((item) => item.meta)])
const generated = computed(() => {
  try {
    return variants(form)
  } catch {
    return []
  }
})
const removed = computed(() =>
  props.library.cards.filter(
    (card) => card.noteId === props.note?.id && !generated.value.includes(card.variant),
  ),
)
const previews = computed(() =>
  generated.value.map((variant) =>
    renderCard(newCard('preview', variant), {
      ...form,
      format: form.format ?? 'plain',
      id: 'preview',
      createdAt: '',
      updatedAt: '',
    }),
  ),
)
async function getMedia(id: string) {
  return uploads.value.find((entry) => entry.meta.id === id)?.blob ?? props.getMedia(id)
}
function attach(event: Event, side: 'frontMedia' | 'backMedia') {
  const input = event.target as HTMLInputElement
  attachFiles([...(input.files ?? [])], side)
  input.value = ''
}
function attachFiles(files: File[], side: 'frontMedia' | 'backMedia') {
  if (props.busy) return
  try {
    if (files.length + form[side].length > 8) throw new Error('每一面最多添加 8 个媒体文件。')
    const prepared = files.map(prepareMedia)
    uploads.value.push(...prepared)
    form[side] = [...form[side], ...prepared.map((item) => item.meta.id)]
    error.value = ''
  } catch (issue) {
    error.value = (issue as Error).message
  }
}
function paste(event: ClipboardEvent, side: 'frontMedia' | 'backMedia') {
  const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
    file.type.startsWith('image/'),
  )
  if (!files.length) return
  event.preventDefault()
  attachFiles(files, side)
}
async function addCloze() {
  if (props.busy || !frontInput.value) return
  try {
    const result = insertCloze(
      form.front,
      frontInput.value.selectionStart,
      frontInput.value.selectionEnd,
    )
    form.front = result.text
    form.type = 'cloze'
    error.value = ''
    await nextTick()
    frontInput.value.focus()
    frontInput.value.setSelectionRange(result.cursor, result.cursor)
  } catch (issue) {
    error.value = (issue as Error).message
  }
}
function shortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.repeat) return
  if (event.shiftKey && event.key.toLowerCase() === 'c' && event.target === frontInput.value) {
    event.preventDefault()
    void addCloze()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void save(!props.note)
  }
}
function remove(id: string, side: 'frontMedia' | 'backMedia') {
  form[side] = form[side].filter((entry) => entry !== id)
  uploads.value = uploads.value.filter((entry) => entry.meta.id !== id)
}
async function save(continueAdding = false) {
  if (props.busy || !editor.value?.reportValidity()) return
  error.value = ''
  const tags = [
    ...new Set(
      tagsText.value
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ]
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) {
    error.value = '最多 20 个标签，每个不超过 40 字。'
    return
  }
  if (!generated.value.length) {
    error.value = '请检查挖空格式，例如 {{c1::巴黎::城市}}。'
    return
  }
  if (await props.submit({ ...form, tags }, uploads.value, allowRemove.value)) {
    if (continueAdding && !props.note) {
      form.front = ''
      form.back = ''
      form.frontMedia = []
      form.backMedia = []
      uploads.value = []
      allowRemove.value = false
      savedCount.value++
      await nextTick()
      frontInput.value?.focus()
    } else emit('close')
  }
}
</script>
<template>
  <form ref="editor" class="editor-form" @submit.prevent="save(false)" @keydown="shortcut">
    <p v-if="savedCount" class="form-note" role="status">
      已连续保存 {{ savedCount }} 条笔记，可以继续添加。
    </p>
    <fieldset class="editor-fields" :disabled="busy">
      <p v-if="error" class="import-warning" role="alert">{{ error }}</p>
      <label for="note-type">笔记类型</label>
      <select id="note-type" v-model="form.type">
        <option v-for="(label, key) in noteTypes" :key="key" :value="key">{{ label }}</option>
      </select>
      <label for="note-format">内容格式</label>
      <select id="note-format" v-model="form.format">
        <option value="markdown">Markdown / 数学公式</option>
        <option value="plain">纯文本</option>
      </select>
      <p class="form-note">
        支持 **加粗**、列表、代码和 $行内公式$ / $$独立公式$$。图片可直接粘贴到问题或答案输入框。
      </p>
      <label for="card-deck">所属卡组</label>
      <select id="card-deck" v-model="form.deckId" required>
        <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">
          {{ deck.name }}
        </option>
      </select>
      <label for="card-front">正面 · 问题</label
      ><textarea
        id="card-front"
        ref="frontInput"
        v-model="form.front"
        @paste="paste($event, 'frontMedia')"
        required
        maxlength="10000"
        rows="4"
        autofocus
        :placeholder="
          form.type === 'cloze' ? '法国的首都是 {{c1::巴黎::城市}}。' : '你想问自己什么？'
        "
      />
      <button type="button" class="text-button" @mousedown.prevent @click="addCloze">
        选中文字挖空 · Ctrl / ⌘ + Shift + C
      </button>
      <p v-if="form.type === 'cloze'" class="form-note" v-pre>
        使用 {{ c1::答案 }} 或
        {{ c1::答案::提示 }}。同编号一起隐藏，不同编号各生成一张卡片；暂不支持嵌套挖空。
      </p>
      <label class="file-label"
        >正面图片 / 音频
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,audio/*"
          @change="attach($event, 'frontMedia')"
      /></label>
      <MediaList :ids="form.frontMedia" :media="media" :get-media="getMedia" />
      <div class="attachment-actions">
        <button
          v-for="id in form.frontMedia"
          :key="id"
          type="button"
          class="text-button danger-text"
          @click="remove(id, 'frontMedia')"
        >
          移除 {{ media.find((item) => item.id === id)?.name }}
        </button>
      </div>
      <label for="card-back"
        >背面 · 答案
        <span v-if="form.type === 'cloze'" class="optional">可选，补充解释</span></label
      ><textarea
        id="card-back"
        v-model="form.back"
        @paste="paste($event, 'backMedia')"
        :required="form.type !== 'cloze'"
        maxlength="10000"
        rows="3"
        placeholder="用自己的话，写下答案或补充解释。"
      />
      <label class="file-label"
        >背面图片 / 音频
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,audio/*"
          @change="attach($event, 'backMedia')"
      /></label>
      <MediaList :ids="form.backMedia" :media="media" :get-media="getMedia" />
      <div class="attachment-actions">
        <button
          v-for="id in form.backMedia"
          :key="id"
          type="button"
          class="text-button danger-text"
          @click="remove(id, 'backMedia')"
        >
          移除 {{ media.find((item) => item.id === id)?.name }}
        </button>
      </div>
      <label for="card-tags">标签 <span class="optional">可选，用逗号分隔</span></label
      ><input id="card-tags" v-model="tagsText" maxlength="820" placeholder="英语, 常用词" />
      <details class="note-preview">
        <summary>将生成 {{ generated.length }} 张卡片 · 预览</summary>
        <article v-for="card in previews" :key="card.variant">
          <CardContent :text="card.front" :format="card.format" />
          <MediaList :ids="card.frontMedia" :media="media" :get-media="getMedia" />
          <hr />
          <CardContent :text="card.back" :format="card.format" />
          <MediaList :ids="card.backMedia" :media="media" :get-media="getMedia" />
        </article>
      </details>
      <p class="form-note">
        同一笔记的卡片共享内容，各自记录学习进度。已有且仍然生成的卡片会保留原进度。媒体每个不超过
        10 MB。
      </p>
      <label v-if="removed.length" class="check-line import-warning"
        ><input v-model="allowRemove" type="checkbox" required />确认移除不再生成的
        {{ removed.length }} 张卡片及其复习记录（会先保存快照）。</label
      >
      <div class="form-actions">
        <button
          v-if="!note"
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="save(true)"
        >
          保存并继续
        </button>
        <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
          取消</button
        ><button class="button primary" :disabled="busy">
          {{ busy ? '保存中…' : '保存卡片' }}
        </button>
      </div>
    </fieldset>
  </form>
</template>
