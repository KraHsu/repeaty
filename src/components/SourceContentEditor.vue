<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { UiButton, UiInput, UiTextarea, UiCollapsible } from './ui'
import { t } from '../i18n'
import type { Source } from '../core/source-data'
import { applyMarkdownEdit } from '../core/markdown-editing'
import {
  sourceDraftSchema,
  type SourceDraft,
  type SourceContentUpdate,
} from '../core/source-workbench'

const props = defineProps<{
  source: Source
  text: string
  scope: string
  busy?: boolean
  prepare: (
    id: string,
    mediaId: string,
    scope: string,
  ) => Promise<{ properties: string; draft?: SourceDraft }>
  writeDraft: (draft: SourceDraft) => Promise<void>
  discardDraft: (sourceId: string, id: string, scope: string) => Promise<void>
  save: (update: SourceContentUpdate) => Promise<boolean>
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const identity = { sourceId: props.source.id, mediaId: props.source.mediaId, scope: props.scope }
const metadata = { title: props.source.title, url: props.source.url }
const id = ref<string>(crypto.randomUUID()),
  content = ref(props.text),
  properties = ref(props.source.properties ?? ''),
  title = ref(props.source.title),
  url = ref(props.source.url),
  loading = ref(true),
  initialized = ref(false),
  saving = ref(false),
  pending = ref(false),
  draftSaved = ref(false),
  error = ref(''),
  conflict = ref(false)
const textarea = ref<{ textareaRef?: HTMLTextAreaElement }>()
let alive = true,
  baseline = '',
  durable = '',
  latest = 0
let timer: ReturnType<typeof setTimeout> | undefined
let staged: SourceDraft | undefined
let writing: Promise<void> | undefined
const state = () => ({
  content: content.value,
  properties: properties.value,
  title: title.value,
  url: url.value,
})
const dirty = computed(() => JSON.stringify(state()) !== baseline)
function beforeUnload(event: BeforeUnloadEvent) {
  // An awaited draft write permits leaving even while the body remains unpublished.
  // Pending writes can still replace the persisted draft, including an undo to original text.
  if (initialized.value && (staged || writing || JSON.stringify(state()) !== durable)) {
    event.preventDefault()
    event.returnValue = ''
  }
}
useEventListener(window, 'beforeunload', beforeUnload)
const identityStale = computed(
  () =>
    props.source.id !== identity.sourceId ||
    props.source.mediaId !== identity.mediaId ||
    props.scope !== identity.scope,
)
const metadataStale = computed(
  () => props.source.title !== metadata.title || props.source.url !== metadata.url,
)
const stale = computed(() => identityStale.value || metadataStale.value)
const locked = computed(
  () =>
    !initialized.value ||
    loading.value ||
    saving.value ||
    !!props.busy ||
    stale.value ||
    conflict.value,
)
function capture(): SourceDraft {
  return sourceDraftSchema.parse({
    ...identity,
    ...state(),
    baseTitle: metadata.title,
    baseUrl: metadata.url,
    id: id.value,
    updatedAt: new Date().toISOString(),
  })
}
function queueDraft() {
  if (!alive || locked.value || (JSON.stringify(state()) === durable && !staged && !writing)) return
  try {
    staged = capture()
  } catch (issue) {
    error.value = t(issue as Error)
    draftSaved.value = false
    return
  }
  latest++
  pending.value = true
  stopTimer()
  timer = setTimeout(() => {
    timer = undefined
    void writeStaged().catch(() => {})
  }, 300)
}
function stopTimer() {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}
function writeStaged(): Promise<void> {
  if (writing) return writing
  if (!staged || !alive || identityStale.value) return Promise.resolve()
  const draft = staged,
    sequence = latest
  staged = undefined
  writing = props
    .writeDraft(draft)
    .then(
      () => {
        durable = JSON.stringify({
          content: draft.content,
          properties: draft.properties,
          title: draft.title,
          url: draft.url,
        })
        if (alive && sequence === latest) {
          draftSaved.value = true
          error.value = ''
        }
      },
      (issue) => {
        if (alive && sequence === latest) {
          draftSaved.value = false
          error.value = t(issue instanceof Error ? issue : String(issue))
        }
        throw issue
      },
    )
    .finally(() => {
      writing = undefined
      if (alive && !staged) pending.value = false
      // Keep one latest snapshot behind a slow write, never a keystroke backlog.
      if (alive && staged && timer === undefined) void writeStaged().catch(() => {})
    })
  return writing
}
watch([content, properties, title, url], queueDraft, { flush: 'sync' })
watch(
  identityStale,
  (value) => {
    if (value) {
      stopTimer()
      staged = undefined
    }
  },
  { flush: 'sync' },
)
onMounted(async () => {
  try {
    const value = await props.prepare(identity.sourceId, identity.mediaId, identity.scope)
    if (!alive || stale.value) return
    properties.value = value.properties
    baseline = JSON.stringify(state())
    if (value.draft) {
      const draft = value.draft
      id.value = draft.id
      content.value = draft.content
      properties.value = draft.properties
      title.value = draft.title
      url.value = draft.url
      conflict.value =
        draft.mediaId !== identity.mediaId ||
        (draft.baseTitle !== undefined && draft.baseTitle !== metadata.title) ||
        (draft.baseUrl !== undefined && draft.baseUrl !== metadata.url)
      draftSaved.value = true
    }
    durable = JSON.stringify(state())
    initialized.value = true
    await nextTick()
    textarea.value?.textareaRef?.focus()
  } catch (issue) {
    if (alive) error.value = t(issue instanceof Error ? issue : String(issue))
  } finally {
    if (alive) loading.value = false
  }
})
onUnmounted(() => {
  alive = false
  stopTimer()
  staged = undefined
})
async function flush() {
  if (loading.value) return false
  // Failed initialization never enabled editing; leaving must not erase a draft.
  if (!initialized.value) return true
  if (identityStale.value) return false
  if (error.value && !locked.value) queueDraft()
  stopTimer()
  try {
    while (staged || writing) await (writing ?? writeStaged())
    return JSON.stringify(state()) === durable
  } catch {
    return false
  }
}
async function leave() {
  if (await flush()) emit('close')
}
async function discard() {
  if (saving.value || loading.value) return
  saving.value = true
  stopTimer()
  staged = undefined
  latest++
  if (writing) {
    try {
      await writing
    } catch {}
  }
  try {
    await props.discardDraft(identity.sourceId, id.value, identity.scope)
    if (alive) {
      durable = JSON.stringify(state())
      pending.value = false
      emit('close')
    }
  } catch (issue) {
    if (alive) error.value = t(issue as Error)
  } finally {
    if (alive) saving.value = false
  }
}
async function commit() {
  if (locked.value || !(await flush())) return
  saving.value = true
  try {
    const ok = await props.save({
      ...identity,
      ...state(),
      before: metadata,
      ...(draftSaved.value ? { draftId: id.value } : {}),
    })
    if (ok && alive) emit('saved')
  } catch (issue) {
    if (alive) error.value = t(issue as Error)
  } finally {
    if (alive) saving.value = false
  }
}
function edit(action: Parameters<typeof applyMarkdownEdit>[3]) {
  const input = textarea.value?.textareaRef
  if (!input || locked.value) return
  const changed = applyMarkdownEdit(content.value, input.selectionStart, input.selectionEnd, action)
  if (!changed) return
  input.focus()
  input.setSelectionRange(0, input.value.length)
  if (!document.execCommand('insertText', false, changed.text)) {
    input.value = changed.text
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  void nextTick(() => input.setSelectionRange(changed.start, changed.end))
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || locked.value) return
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    void commit()
    return
  }
  if (props.source.format !== 'markdown' || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'Tab') {
    event.preventDefault()
    edit(event.shiftKey ? 'outdent' : 'indent')
  }
  if (event.key === 'Enter') {
    const input = textarea.value?.textareaRef
    if (
      input &&
      applyMarkdownEdit(content.value, input.selectionStart, input.selectionEnd, 'continue-list')
    ) {
      event.preventDefault()
      edit('continue-list')
    }
  }
}
defineExpose({ flush, dirty })
</script>
<template>
  <section
    class="source-content-editor"
    :aria-label="t('编辑材料正文')"
    :aria-busy="loading || saving"
  >
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    <p v-if="metadataStale" role="alert" class="form-note">
      {{ t('材料信息已变化。请保留草稿并重新打开，确认后继续编辑。') }}
    </p>
    <p v-if="conflict" role="alert" class="form-note">
      {{ t('草稿对应的正文或材料信息已变化。原草稿保留；请复制需要的内容后重新打开编辑。') }}
    </p>
    <UiCollapsible :unmount-on-hide="false">
      <UiButton variant="ghost">{{ t('属性与来源') }}</UiButton>
      <template #content
        ><div class="source-editor-properties">
          <label
            >{{ t('标题') }}<UiInput v-model="title" :disabled="locked" :maxlength="160"
          /></label>
          <label
            >{{ t('来源网址') }}<UiInput v-model="url" :disabled="locked" :maxlength="2048"
          /></label>
          <label class="source-editor-yaml"
            >{{ t('自定义属性（YAML）')
            }}<UiTextarea
              v-model="properties"
              :disabled="locked"
              :rows="5"
              :maxlength="65536"
              :placeholder="t('例如：author: 作者')"
              spellcheck="false"
          /></label></div
      ></template>
    </UiCollapsible>
    <div
      v-if="source.format === 'markdown'"
      class="source-editor-tools"
      role="toolbar"
      :aria-label="t('编辑材料正文')"
    >
      <UiButton variant="ghost" :disabled="locked" @click="edit('indent')">{{
        t('缩进')
      }}</UiButton>
      <UiButton variant="ghost" :disabled="locked" @click="edit('outdent')">{{
        t('减少缩进')
      }}</UiButton>
      <UiButton variant="ghost" :disabled="locked" @click="edit('task')">{{
        t('任务列表')
      }}</UiButton>
      <UiButton variant="ghost" :disabled="locked" @click="edit('code')">{{
        t('代码块')
      }}</UiButton>
      <UiButton variant="ghost" :disabled="locked" @click="edit('math')">{{ t('公式') }}</UiButton>
    </div>
    <UiTextarea
      ref="textarea"
      v-model="content"
      class="source-editor-body"
      :aria-label="t('材料正文')"
      :readonly="locked"
      :rows="20"
      :maxlength="250000"
      spellcheck="false"
      @keydown="keydown"
    />
    <footer class="source-editor-footer">
      <span role="status" class="form-note">{{
        pending ? t('正在保存草稿…') : draftSaved ? t('草稿已保存') : ''
      }}</span>
      <div class="source-editor-actions">
        <UiButton variant="ghost" :disabled="loading || saving" @click="discard">{{
          t('放弃草稿')
        }}</UiButton>
        <UiButton variant="secondary" :disabled="loading || saving" @click="leave">{{
          t('保留草稿并返回')
        }}</UiButton>
        <UiButton variant="primary" :disabled="locked || !dirty" @click="commit">{{
          t('保存为新版本')
        }}</UiButton>
      </div>
    </footer>
  </section>
</template>
<style scoped>
.source-content-editor {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.source-editor-properties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.source-editor-properties label {
  display: grid;
  gap: 0.5rem;
}
.source-editor-yaml {
  grid-column: 1 / -1;
}
.source-editor-tools,
.source-editor-footer,
.source-editor-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.source-editor-footer {
  justify-content: space-between;
}
.source-editor-body :deep(textarea) {
  min-height: 26rem;
  line-height: 1.75;
  font-family: var(--font-mono);
}
.source-editor-yaml :deep(textarea) {
  font-family: var(--font-mono);
}
@media (max-width: 600px) {
  .source-editor-properties {
    grid-template-columns: 1fr;
  }
  .source-editor-body :deep(textarea) {
    min-height: 20rem;
  }
}
</style>
