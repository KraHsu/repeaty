<script setup lang="ts">
import { desktopEdition } from '../edition'
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
import MediaAttachments from './MediaAttachments.vue'
const CardContent = defineAsyncComponent(() => import('./CardContent.vue'))
import { usePlugins } from '../plugins'
import { usePluginManager } from '../plugins/manager'
const { enabledEditorPlugins, canReviewCard } = usePlugins()
const { holdPluginRuntime } = usePluginManager()
import { onUnmounted } from 'vue'
const releasePluginRuntime = holdPluginRuntime()
onUnmounted(releasePluginRuntime)
import { insertCloze } from '../core/authoring'
const props = defineProps<{
  library: Library
  note?: Note
  initial?: Partial<NoteInput>
  initialUploads?: MediaUpload[]
  draft?: boolean
  saveDraft?: (input: NoteInput, uploads: MediaUpload[]) => Promise<boolean>
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
  deckId:
    props.note?.deckId ?? props.initial?.deckId ?? props.deckId ?? props.library.decks[0]?.id ?? '',
  type: props.note?.type ?? props.initial?.type ?? 'basic',
  format: props.note?.format ?? props.initial?.format ?? 'markdown',
  plugin: props.note?.plugin,
  excerpt: props.note?.excerpt ?? props.initial?.excerpt,
  front: props.note?.front ?? props.initial?.front ?? '',
  back: props.note?.back ?? props.initial?.back ?? '',
  tags: [...(props.note?.tags ?? props.initial?.tags ?? [])],
  frontMedia: [...(props.note?.frontMedia ?? props.initial?.frontMedia ?? [])],
  backMedia: [...(props.note?.backMedia ?? props.initial?.backMedia ?? [])],
})
const pluginChoices = enabledEditorPlugins
const selectedPluginId = ref(props.note?.plugin?.id ?? pluginChoices.value[0]?.id)
const selectedPlugin = computed(() =>
  pluginChoices.value.find((plugin) => plugin.id === selectedPluginId.value),
)
const tagsText = ref(form.tags.join(', ')),
  uploads = ref<MediaUpload[]>(props.initialUploads ?? []),
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
function selectQuestionPlugin(id: string) {
  if (!pluginChoices.value.some((plugin) => plugin.id === id)) return
  form.type = 'plugin'
  selectedPluginId.value = id
}
function shortcut(event: KeyboardEvent) {
  // Enter/Shift+C while an IME composition is open belongs to the IME, not to the form.
  if (event.isComposing || event.keyCode === 229) return
  if (!(event.ctrlKey || event.metaKey) || event.repeat) return
  if (event.shiftKey && event.key.toLowerCase() === 'c' && event.target === frontInput.value) {
    event.preventDefault()
    void addCloze()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void save(!props.note && !props.initial?.excerpt)
  }
}
function remove(id: string, side: 'frontMedia' | 'backMedia') {
  form[side] = form[side].filter((entry) => entry !== id)
  uploads.value = uploads.value.filter((entry) => entry.meta.id !== id)
}
async function save(continueAdding = false) {
  if (props.busy || !editor.value?.reportValidity()) return
  error.value = ''
  if (form.type === 'plugin' && (!selectedPlugin.value || (form.plugin && !canReviewCard(form)))) {
    error.value = '请先在插件页面启用对应插件，再编辑或保存题目。'
    return
  }
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
  if (form.type === 'plugin' && !form.plugin) {
    error.value = '读取题目后再保存。题面会保存在本地，提交判题需要联网。'
    return
  }
  if (
    await props.submit(
      { ...form, plugin: form.type === 'plugin' ? form.plugin : undefined, tags },
      uploads.value,
      allowRemove.value,
    )
  ) {
    if (continueAdding && !props.note) {
      form.plugin = undefined
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
async function keepDraft() {
  if (props.busy || !props.saveDraft) return
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
  error.value = ''
  if (await props.saveDraft({ ...form, tags }, uploads.value)) emit('close')
}
</script>
<template>
  <form
    ref="editor"
    class="editor-form note-editor"
    @submit.prevent="save(false)"
    @keydown="shortcut"
  >
    <fieldset class="editor-fields note-fields" :disabled="busy">
      <div class="editor-scroll">
        <p v-if="savedCount" class="editor-status" role="status">
          {{ t('已保存 {p0} 条笔记。', { p0: savedCount }) }}
        </p>
        <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
        <p v-if="saveDraft" class="form-note">{{ t('尚未完成时可先保存草稿，下次继续编辑。') }}</p>
        <details v-if="form.excerpt" class="source-note-excerpt">
          <summary>
            {{ t('原文摘录') }} ·
            {{ library.sources.find((source) => source.id === form.excerpt?.sourceId)?.title }}
          </summary>
          <blockquote>{{ form.excerpt.quote }}</blockquote>
        </details>
        <div class="note-metadata">
          <div class="form-field">
            <label for="note-type">{{ t('笔记类型') }}</label>
            <select id="note-type" v-model="form.type">
              <option
                v-for="(label, key) in noteTypes"
                :key="key"
                :value="key"
                :disabled="key === 'plugin' && (draft || !pluginChoices.length)"
              >
                {{ t(label) }}
              </option>
            </select>
          </div>
          <div class="form-field">
            <label for="card-deck">{{ t('所属卡组') }}</label>
            <select id="card-deck" v-model="form.deckId" required>
              <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">
                {{ deck.name }}
              </option>
            </select>
          </div>
          <div v-if="form.type !== 'plugin'" class="form-field">
            <label for="note-format">{{ t('内容格式') }}</label>
            <select id="note-format" v-model="form.format">
              <option value="markdown">{{ t('Markdown / 数学公式') }}</option>
              <option value="plain">{{ t('纯文本') }}</option>
            </select>
          </div>
          <div v-else class="form-field">
            <label for="question-plugin">{{ t('题目插件') }}</label>
            <select
              id="question-plugin"
              v-model="selectedPluginId"
              @change="form.plugin = undefined"
            >
              <option v-if="!selectedPlugin" :value="selectedPluginId">
                {{ selectedPluginId }}
              </option>
              <option v-for="plugin in pluginChoices" :key="plugin.id" :value="plugin.id">
                {{ t(plugin.label) }}
              </option>
            </select>
          </div>
        </div>
        <div v-if="form.type !== 'plugin'" class="editor-hints">
          <p class="form-note">
            {{
              form.format === 'markdown'
                ? t('支持 Markdown 和数学公式，图片可直接粘贴到输入框。')
                : t('图片可直接粘贴到输入框。')
            }}
          </p>
          <button
            v-for="plugin in !draft ? pluginChoices.filter((entry) => entry.createLabel) : []"
            :key="plugin.id"
            type="button"
            class="text-button plugin-shortcut"
            @click="selectQuestionPlugin(plugin.id)"
          >
            {{ t(plugin.createLabel!) }}
          </button>
        </div>
        <component
          v-if="form.type === 'plugin' && selectedPlugin?.editor"
          :is="selectedPlugin.editor"
          :key="savedCount"
          :model-value="form"
          @update:model-value="Object.assign(form, $event)"
        />
        <p v-if="form.type === 'plugin' && !selectedPlugin" class="import-warning" role="status">
          {{ t('请先在插件页面启用对应插件，再编辑或保存题目。') }}
        </p>
        <div class="note-sides" :class="{ 'single-side': form.type === 'plugin' }">
          <section v-if="form.type !== 'plugin'" class="note-side">
            <div class="note-side-heading">
              <label for="card-front">{{ t('正面 · 问题') }}</label>
              <button
                type="button"
                class="text-button cloze-button"
                :aria-label="t('选中文字挖空 · Ctrl / ⌘ + Shift + C')"
                :title="t('选中文字挖空 · Ctrl / ⌘ + Shift + C')"
                @mousedown.prevent
                @click="addCloze"
              >
                {{ t('挖空') }}
              </button>
            </div>
            <textarea
              id="card-front"
              ref="frontInput"
              v-model="form.front"
              @paste="paste($event, 'frontMedia')"
              required
              maxlength="10000"
              rows="6"
              autofocus
              :placeholder="
                form.type === 'cloze' ? t('法国的首都是 {{c1::巴黎::城市}}。') : t('输入问题')
              "
            />
            <p
              v-if="form.type === 'cloze'"
              class="form-note"
              v-text="
                t(
                  '将要记住的内容写在 {{c1::答案}} 中，也可写成 {{c1::答案::提示}}。显示答案时会自动还原；同编号一起隐藏，不同编号各生成一张卡片。',
                )
              "
            />
            <MediaAttachments
              :label="t('正面图片 / 音频')"
              :ids="form.frontMedia"
              :media="media"
              :get-media="getMedia"
              @attach="attachFiles($event, 'frontMedia')"
              @remove="remove($event, 'frontMedia')"
            />
          </section>
          <section class="note-side">
            <div class="note-side-heading">
              <label for="card-back"
                >{{
                  t(
                    form.type === 'plugin'
                      ? '解题笔记'
                      : form.type === 'cloze'
                        ? '补充说明'
                        : '背面 · 答案',
                  )
                }}<span v-if="form.type === 'cloze' || form.type === 'plugin'" class="optional">{{
                  t('可选')
                }}</span></label
              >
            </div>
            <textarea
              id="card-back"
              v-model="form.back"
              @paste="paste($event, 'backMedia')"
              :required="form.type !== 'cloze' && form.type !== 'plugin'"
              maxlength="10000"
              rows="6"
              :placeholder="
                t(
                  form.type === 'cloze'
                    ? '答案来自正面的挖空内容，这里可留空。'
                    : '输入答案或补充说明',
                )
              "
            />
            <MediaAttachments
              :label="t('背面图片 / 音频')"
              :ids="form.backMedia"
              :media="media"
              :get-media="getMedia"
              @attach="attachFiles($event, 'backMedia')"
              @remove="remove($event, 'backMedia')"
            />
          </section>
        </div>
        <p class="form-note attachment-hint">{{ t('每面最多 8 个附件，每个不超过 10 MB。') }}</p>
        <div class="form-field note-tags">
          <label for="card-tags"
            >{{ t('标签') }}<span class="optional">{{ t('可选，用逗号分隔') }}</span></label
          >
          <input
            id="card-tags"
            v-model="tagsText"
            maxlength="820"
            :placeholder="t('英语, 常用词')"
          />
        </div>
        <details v-if="form.type !== 'plugin'" class="note-preview">
          <summary>{{ t('将生成 {p0} 张卡片 · 预览', { p0: generated.length }) }}</summary>
          <article v-for="card in previews" :key="card.variant">
            <CardContent :text="card.front" :format="card.format" />
            <MediaList :ids="card.frontMedia" :media="media" :get-media="getMedia" />
            <hr />
            <CardContent :text="card.back" :format="card.format" />
            <MediaList :ids="card.backMedia" :media="media" :get-media="getMedia" />
          </article>
        </details>
        <label v-if="removed.length" class="check-line import-warning">
          <input v-model="allowRemove" type="checkbox" required />{{
            t(
              desktopEdition
                ? '确认让不再生成的 {p0} 张卡片暂不复习，记录保留，重新添加后恢复。'
                : '确认移除不再生成的 {p0} 张卡片及其复习记录（会先保存快照）。',
              {
                p0: removed.length,
              },
            )
          }}
        </label>
      </div>
      <div class="form-actions editor-actions">
        <button
          v-if="saveDraft"
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="keepDraft"
        >
          {{ t('保存草稿') }}
        </button>
        <button
          v-if="!note && !initial?.excerpt"
          type="button"
          class="button secondary save-continue"
          :disabled="busy"
          @click="save(true)"
        >
          {{ t('保存并继续') }}
        </button>
        <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
          {{ t('取消') }}
        </button>
        <button class="button primary" :disabled="busy">
          {{ busy ? t('保存中…') : t(draft ? '确认并保存卡片' : '保存卡片') }}
        </button>
      </div>
    </fieldset>
  </form>
</template>
