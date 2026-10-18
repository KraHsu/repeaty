<script setup lang="ts">
import { t, msg, LocalizedError, type DisplayMessage } from '../i18n'

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
  error = ref<DisplayMessage>(''),
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
    if (files.length + form[side].length > 8)
      throw new LocalizedError(msg('每一面最多添加 8 个媒体文件。'))
    const prepared = files.map(prepareMedia)
    uploads.value.push(...prepared)
    form[side] = [...form[side], ...prepared.map((item) => item.meta.id)]
    error.value = ''
  } catch (issue) {
    error.value = issue as Error
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
    error.value = issue as Error
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
      {{ t('已保存 {p0} 条笔记。', { p0: savedCount }) }}
    </p>
    <fieldset class="editor-fields" :disabled="busy">
      <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
      <label for="note-type">{{ t('笔记类型') }}</label>
      <select id="note-type" v-model="form.type">
        <option v-for="(label, key) in noteTypes" :key="key" :value="key">{{ t(label) }}</option>
      </select>
      <label for="note-format">{{ t('内容格式') }}</label>
      <select id="note-format" v-model="form.format">
        <option value="markdown">{{ t('Markdown / 数学公式') }}</option>
        <option value="plain">{{ t('纯文本') }}</option>
      </select>
      <p class="form-note">
        {{
          t(
            '支持 **加粗**、列表、代码和 $行内公式$ / $$独立公式$$。图片可直接粘贴到问题或答案输入框。',
          )
        }}
      </p>
      <label for="card-deck">{{ t('所属卡组') }}</label>
      <select id="card-deck" v-model="form.deckId" required>
        <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">
          {{ deck.name }}
        </option>
      </select>
      <label for="card-front">{{ t('正面 · 问题') }}</label
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
          form.type === 'cloze' ? t('法国的首都是 {{c1::巴黎::城市}}。') : t('输入问题')
        "
      />
      <button type="button" class="text-button" @mousedown.prevent @click="addCloze">
        {{ t('选中文字挖空 · Ctrl / ⌘ + Shift + C') }}
      </button>
      <p
        v-if="form.type === 'cloze'"
        class="form-note"
        v-text="
          t(
            '使用 {{ c1::答案 }} 或 {{ c1::答案::提示 }}。同编号一起隐藏，不同编号各生成一张卡片；暂不支持嵌套挖空。',
          )
        "
      />
      <label class="file-label"
        >{{ t('正面图片 / 音频')
        }}<input
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
          {{ t('移除 {p0}', { p0: media.find((item) => item.id === id)?.name ?? id }) }}
        </button>
      </div>
      <label for="card-back"
        >{{ t('背面 · 答案')
        }}<span v-if="form.type === 'cloze'" class="optional">{{
          t('可选，补充解释')
        }}</span></label
      ><textarea
        id="card-back"
        v-model="form.back"
        @paste="paste($event, 'backMedia')"
        :required="form.type !== 'cloze'"
        maxlength="10000"
        rows="3"
        :placeholder="t('输入答案或补充说明')"
      />
      <label class="file-label"
        >{{ t('背面图片 / 音频')
        }}<input
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
          {{ t('移除 {p0}', { p0: media.find((item) => item.id === id)?.name ?? id }) }}
        </button>
      </div>
      <label for="card-tags"
        >{{ t('标签') }}<span class="optional">{{ t('可选，用逗号分隔') }}</span></label
      ><input id="card-tags" v-model="tagsText" maxlength="820" :placeholder="t('英语, 常用词')" />
      <details class="note-preview">
        <summary>{{ t('将生成 {p0} 张卡片 · 预览', { p0: generated.length }) }}</summary>
        <article v-for="card in previews" :key="card.variant">
          <CardContent :text="card.front" :format="card.format" />
          <MediaList :ids="card.frontMedia" :media="media" :get-media="getMedia" />
          <hr />
          <CardContent :text="card.back" :format="card.format" />
          <MediaList :ids="card.backMedia" :media="media" :get-media="getMedia" />
        </article>
      </details>
      <p class="form-note">
        {{
          t(
            '同一笔记生成的卡片共用内容，分别记录复习进度。编辑后保留的卡片会继续沿用原进度。每个附件最大 10 MB。',
          )
        }}
      </p>
      <label v-if="removed.length" class="check-line import-warning"
        ><input v-model="allowRemove" type="checkbox" required />{{
          t('确认移除不再生成的 {p0} 张卡片及其复习记录（会先保存快照）。', { p0: removed.length })
        }}</label
      >
      <div class="form-actions">
        <button
          v-if="!note"
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="save(true)"
        >
          {{ t('保存并继续') }}
        </button>
        <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
          {{ t('取消') }}</button
        ><button class="button primary" :disabled="busy">
          {{ busy ? t('保存中…') : t('保存卡片') }}
        </button>
      </div>
    </fieldset>
  </form>
</template>
