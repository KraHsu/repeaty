<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Check, Clipboard, FilePlus, FolderOpen, Upload, X } from '@lucide/vue'
import type { CollectionHostApi, CollectionImportPlan } from '@repeaty/plugin-api'
import {
  collectDataTransfer,
  collectSelectedFiles,
  readCollectionClipboard,
  type CollectionInput,
  type CollectionInputIssue,
} from '../core/collection-input'
import { t } from '../i18n'
import AppModal from './AppModal.vue'
import { UiButton, UiCheckbox, UiInput, UiSelect, UiTextarea } from './ui'

const props = defineProps<{
  api: CollectionHostApi
  scope: string
  busy?: boolean
  readClipboard?: () => Promise<CollectionInput>
}>()
const emit = defineEmits<{
  collected: [sourceIds: readonly string[], destination: 'inbox' | 'library']
  activity: [open: boolean]
}>()
const open = ref(false),
  loading = ref(false),
  committing = ref(false),
  dragOver = ref(false),
  error = ref(''),
  text = ref(''),
  title = ref(''),
  url = ref(''),
  format = ref<'plain' | 'markdown'>('markdown'),
  destination = ref<'inbox' | 'library'>('inbox'),
  textOpen = ref(false)
watch(open, (value) => emit('activity', value), { flush: 'sync' })
const input = shallowRef<CollectionInput>({ files: [], issues: [], bytes: 0 })
const importerSelections = ref<Record<string, string>>({})
const ambiguousFiles = computed(() => {
  const available = props.api.importers?.() ?? []
  return input.value.files.flatMap((entry) => {
    if (/\.(md|markdown|txt)$/i.test(entry.file.name)) return []
    const matches = available.filter((importer) =>
      importer.extensions.some((extension) =>
        entry.file.name.toLowerCase().endsWith(extension.toLowerCase()),
      ),
    )
    return matches.length > 1 ? [{ ...entry, matches }] : []
  })
})
const needsImporter = computed(() =>
  ambiguousFiles.value.some(
    (entry) =>
      !entry.matches.some(
        (importer) =>
          `${importer.pluginId}:${importer.id}` === importerSelections.value[entry.path],
      ),
  ),
)
const plan = shallowRef<CollectionImportPlan>()
const selection = ref<string[]>([])
const fileInput = ref<HTMLInputElement>(),
  directoryInput = ref<HTMLInputElement>()
const ready = computed(() => !!input.value.files.length || !!text.value.trim())
const disabled = computed(() => loading.value || committing.value || props.busy)
const reasonLabels: Record<CollectionInputIssue['reason'], string> = {
  private: '已跳过私有目录或隐藏文件',
  temporary: '已跳过临时文件',
  'unsafe-path': '文件路径无效',
  'duplicate-path': '相同路径重复选择',
  unreadable: '无法读取，请检查文件权限',
  limit: '超过本次收集的数量、大小或层级限制',
}
let sequence = 0,
  alive = true,
  controller: AbortController | undefined,
  planApi: CollectionHostApi | undefined,
  operationId = '',
  captureKind: 'file' | 'clipboard' | undefined
function clearPlan() {
  sequence++
  controller?.abort()
  if (plan.value) planApi?.discardCollection(plan.value.id)
  plan.value = undefined
  planApi = undefined
  selection.value = []
  loading.value = false
}
function reset() {
  clearPlan()
  input.value = { files: [], issues: [], bytes: 0 }
  importerSelections.value = {}
  text.value = title.value = url.value = error.value = ''
  textOpen.value = false
  captureKind = undefined
  destination.value = 'inbox'
  format.value = 'markdown'
}
function show() {
  // A background save may start after the invoking button was clicked. Opening
  // is read-only; keep the form visible and let disabled controls guard mutations.
  if (committing.value) return
  reset()
  open.value = true
}
function close() {
  if (committing.value) return
  reset()
  open.value = false
}
function applyInput(result: CollectionInput, kind: 'file' | 'clipboard') {
  const combined = [...input.value.files, ...result.files]
  // Preserve directory-relative names on the File passed to host parsers.
  const files = combined.map(({ file, path }) => {
    if (file.webkitRelativePath === path) return file
    const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified })
    Object.defineProperty(copy, 'webkitRelativePath', { value: path })
    return copy
  })
  const collected = collectSelectedFiles(files)
  input.value = {
    ...collected,
    issues: [...input.value.issues, ...result.issues, ...collected.issues],
  }
  if (result.text) {
    text.value = [text.value, result.text].filter(Boolean).join('\n\n')
    textOpen.value = true
  }
  captureKind = kind
}
function selectedFiles(event: Event) {
  clearPlan()
  error.value = ''
  const element = event.target as HTMLInputElement
  applyInput(collectSelectedFiles(Array.from(element.files ?? [])), 'file')
  element.value = ''
}
async function receiveTransfer(transfer: DataTransfer, kind: 'file' | 'clipboard') {
  if (disabled.value) return
  clearPlan()
  error.value = ''
  const current = ++sequence,
    scope = props.scope
  controller = new AbortController()
  loading.value = true
  try {
    const result = await collectDataTransfer(transfer, { signal: controller.signal })
    if (alive && current === sequence && scope === props.scope) applyInput(result, kind)
  } catch (issue) {
    if (alive && current === sequence) error.value = t(issue as Error)
  } finally {
    if (alive && current === sequence) loading.value = false
  }
}
function drop(event: DragEvent) {
  dragOver.value = false
  if (!event.dataTransfer) return
  void receiveTransfer(event.dataTransfer, 'file')
}
function paste(event: ClipboardEvent) {
  // Native text input/selection keeps its usual paste and IME semantics.
  if ((event.target as Element | null)?.closest('input, textarea, [contenteditable="true"]')) return
  if (!event.clipboardData) return
  event.preventDefault()
  void receiveTransfer(event.clipboardData, 'clipboard')
}
async function clipboard() {
  if (disabled.value) return
  clearPlan()
  error.value = ''
  const current = ++sequence,
    scope = props.scope
  controller = new AbortController()
  loading.value = true
  try {
    if (!props.readClipboard && !navigator.clipboard?.read)
      throw new Error('请在正文框粘贴文字，或将文件拖入收集区域。')
    const result = props.readClipboard
      ? await props.readClipboard()
      : await readCollectionClipboard(() => navigator.clipboard.read(), {
          signal: controller.signal,
        })
    if (!alive || current !== sequence || scope !== props.scope) return
    if (!result.files.length && !result.text?.trim())
      throw new Error('剪贴板中没有可收集的文字或图片。')
    applyInput(result, 'clipboard')
  } catch (issue) {
    if (alive && current === sequence)
      error.value =
        issue instanceof DOMException && issue.name === 'NotAllowedError'
          ? t('无法读取剪贴板。请允许读取，或在正文框中直接粘贴。')
          : t(issue as Error)
  } finally {
    if (alive && current === sequence) loading.value = false
  }
}
function removeFile(path: string) {
  clearPlan()
  input.value = collectSelectedFiles(
    input.value.files.filter((entry) => entry.path !== path).map((entry) => entry.file),
  )
}
async function preview() {
  if (!ready.value || disabled.value || needsImporter.value) return
  clearPlan()
  error.value = ''
  const current = ++sequence,
    scope = props.scope,
    api = props.api
  controller = new AbortController()
  loading.value = true
  try {
    const result = await api.prepareCollection(
      {
        files: input.value.files.map((entry) => entry.file),
        importers: Object.fromEntries(
          ambiguousFiles.value.map((entry) => [entry.path, importerSelections.value[entry.path]!]),
        ),
        ...(text.value.trim()
          ? {
              text: {
                text: text.value,
                title: title.value.trim() || undefined,
                url: url.value.trim() || undefined,
                format: format.value,
              },
            }
          : {}),
        destination: destination.value,
        kind: captureKind,
      },
      controller.signal,
    )
    if (!alive || current !== sequence || scope !== props.scope) {
      api.discardCollection(result.id)
      return
    }
    planApi = api
    plan.value = result
    selection.value = result.candidates.map((candidate) => candidate.key)
    operationId = crypto.randomUUID()
  } catch (issue) {
    if (
      alive &&
      current === sequence &&
      !(issue instanceof DOMException && issue.name === 'AbortError')
    )
      error.value = t(issue as Error)
  } finally {
    if (alive && current === sequence) loading.value = false
  }
}
function toggle(key: string, checked: boolean) {
  selection.value = checked
    ? [...selection.value, key]
    : selection.value.filter((entry) => entry !== key)
}
async function confirm() {
  const pending = plan.value,
    api = planApi,
    scope = props.scope,
    target = destination.value
  if (!pending || !api || disabled.value || !selection.value.length) return
  committing.value = true
  error.value = ''
  try {
    const result = await api.commitCollection({
      planId: pending.id,
      expectedRevision: pending.revision,
      operationId,
      selection: [...selection.value],
    })
    if (!alive || scope !== props.scope || plan.value !== pending) return
    api.discardCollection(pending.id)
    plan.value = undefined
    open.value = false
    emit('collected', result.sourceIds, target)
  } catch (issue) {
    if (alive && scope === props.scope) error.value = t(issue as Error)
  } finally {
    if (alive) committing.value = false
  }
}
watch(
  () => props.scope,
  () => {
    reset()
    open.value = false
  },
)
onUnmounted(() => {
  alive = false
  emit('activity', false)
  clearPlan()
})
defineExpose({ show })
</script>

<template>
  <AppModal
    v-if="open"
    wide
    :title="t('收集材料')"
    :busy="committing"
    :error="error"
    @close="close"
  >
    <div class="collection-import" @paste="paste">
      <div class="collection-body">
        <template v-if="!plan">
          <div
            class="collection-drop"
            :class="{ 'is-over': dragOver, 'is-compact': textOpen }"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="drop"
          >
            <Upload :size="24" aria-hidden="true" />
            <strong>{{ t('把文件或文件夹拖到这里') }}</strong>
            <p>{{ t('自动识别文件格式，确认前可以预览和选择。') }}</p>
            <div class="collection-input-actions">
              <UiButton :disabled="disabled" @click="fileInput?.click()"
                ><FilePlus :size="16" />{{ t('选择文件') }}</UiButton
              >
              <UiButton :disabled="disabled" @click="directoryInput?.click()"
                ><FolderOpen :size="16" />{{ t('选择文件夹') }}</UiButton
              >
              <UiButton :disabled="disabled" @click="clipboard"
                ><Clipboard :size="16" />{{ t('读取剪贴板') }}</UiButton
              >
            </div>
            <input
              ref="fileInput"
              class="sr-only"
              tabindex="-1"
              type="file"
              multiple
              data-testid="collection-files"
              :aria-label="t('选择材料文件')"
              @change="selectedFiles"
            />
            <input
              ref="directoryInput"
              class="sr-only"
              tabindex="-1"
              type="file"
              multiple
              webkitdirectory
              data-testid="collection-directory"
              :aria-label="t('选择材料文件夹')"
              @change="selectedFiles"
            />
          </div>
          <ul v-if="input.files.length" class="collection-files" :aria-label="t('待收集文件')">
            <li v-for="entry in input.files" :key="entry.path">
              <span class="collection-file-name">{{ entry.path }}</span>
              <span class="muted">{{ Math.max(1, Math.ceil(entry.file.size / 1024)) }} KB</span>
              <UiButton
                icon
                variant="ghost"
                :disabled="disabled"
                :aria-label="t('移除 {name}', { name: entry.path })"
                @click="removeFile(entry.path)"
                ><X :size="16"
              /></UiButton>
            </li>
          </ul>
          <div v-if="ambiguousFiles.length" class="collection-parsers">
            <p class="form-note">{{ t('这些文件有多种导入方式，请选择后再预览。') }}</p>
            <label v-for="entry in ambiguousFiles" :key="entry.path">
              <span>{{ entry.path }}</span>
              <UiSelect
                v-model="importerSelections[entry.path]"
                :disabled="disabled"
                :aria-label="t('导入方式：{name}', { name: entry.path })"
                :placeholder="t('选择导入方式')"
                data-testid="collection-importer"
                :items="
                  entry.matches.map((importer) => ({
                    value: `${importer.pluginId}:${importer.id}`,
                    label: importer.title,
                  }))
                "
              />
            </label>
          </div>
          <UiButton
            class="collection-text-toggle"
            variant="ghost"
            :aria-expanded="textOpen"
            :disabled="disabled"
            @click="textOpen = !textOpen"
            >{{ t(textOpen ? '收起文字输入' : '粘贴或输入文字') }}</UiButton
          >
          <div v-if="textOpen" class="collection-text">
            <div class="collection-field-row">
              <label
                >{{ t('标题（可选）')
                }}<UiInput
                  v-model="title"
                  maxlength="160"
                  :disabled="disabled"
                  :placeholder="t('留空时使用正文首行')"
              /></label>
              <label
                >{{ t('格式')
                }}<UiSelect
                  v-model="format"
                  :disabled="disabled"
                  :items="[
                    { value: 'markdown', label: 'Markdown' },
                    { value: 'plain', label: t('纯文本') },
                  ]"
              /></label>
            </div>
            <label class="sr-only" for="collection-text">{{ t('正文') }}</label>
            <UiTextarea
              id="collection-text"
              v-model="text"
              rows="7"
              maxlength="250000"
              :disabled="disabled"
              :placeholder="t('把想稍后阅读的内容放在这里…')"
            />
            <label
              >{{ t('来源链接（可选）')
              }}<UiInput
                v-model="url"
                type="url"
                maxlength="2048"
                :disabled="disabled"
                placeholder="https://"
            /></label>
          </div>
          <details v-if="input.issues.length" class="collection-skipped">
            <summary>{{ t('已跳过 {count} 项', { count: input.issues.length }) }}</summary>
            <ul>
              <li v-for="(issue, index) in input.issues" :key="index">
                <span>{{ issue.path }}</span
                ><span>{{ t(reasonLabels[issue.reason]) }}</span>
              </li>
            </ul>
          </details>
          <label class="collection-destination"
            >{{ t('保存到')
            }}<UiSelect
              v-model="destination"
              :disabled="disabled"
              :items="[
                { value: 'inbox', label: t('收件箱 · 稍后整理') },
                { value: 'library', label: t('阅读材料') },
              ]"
          /></label>
        </template>
        <template v-else>
          <div class="collection-preview-title">
            <Check :size="20" />
            <div>
              <strong>{{ t('确认要收集的材料') }}</strong>
              <p>{{ t('相同来源和内容保留已有材料；未勾选的内容不会保存。') }}</p>
            </div>
          </div>
          <ul class="collection-candidates" :aria-label="t('收集预览')">
            <li v-for="candidate in plan?.candidates ?? []" :key="candidate.key">
              <UiCheckbox
                :model-value="selection.includes(candidate.key)"
                :disabled="disabled"
                :aria-label="t('选择 {title}', { title: candidate.title })"
                @update:model-value="toggle(candidate.key, !!$event)"
              />
              <div>
                <strong>{{ candidate.title }}</strong
                ><span>{{ candidate.sourceName }} · {{ candidate.format }}</span>
              </div>
              <span class="collection-candidate-status">{{
                t(candidate.duplicate ? '已收集' : '新增')
              }}</span>
            </li>
          </ul>
          <details v-if="plan?.skipped.length" class="collection-skipped" open>
            <summary>{{ t('无法收集 {count} 项', { count: plan?.skipped.length }) }}</summary>
            <ul>
              <li v-for="(item, index) in plan?.skipped ?? []" :key="index">
                <span>{{ item.name }}</span
                ><span>{{ t(item.reason) }}</span>
              </li>
            </ul>
          </details>
        </template>
        <p v-if="loading" class="collection-progress" role="status">{{ t('正在准备材料…') }}</p>
      </div>
      <div class="collection-footer">
        <span class="muted">{{
          plan ? t('已选择 {count} 项', { count: selection.length }) : t('原始文件不会被修改。')
        }}</span>
        <div>
          <UiButton
            variant="secondary"
            :disabled="committing"
            @click="plan ? clearPlan() : close()"
            >{{ t(plan ? '返回修改' : '取消') }}</UiButton
          >
          <UiButton
            v-if="!plan"
            variant="primary"
            :busy="loading"
            :disabled="disabled || !ready || needsImporter"
            @click="preview"
            >{{ t('预览材料') }}</UiButton
          >
          <UiButton
            v-else
            variant="primary"
            :busy="committing"
            :disabled="disabled || !selection.length"
            @click="confirm"
            >{{ t(destination === 'inbox' ? '保存到收件箱' : '保存到阅读材料') }}</UiButton
          >
        </div>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.collection-import {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  gap: 1rem;
}
:global(.app-modal-body:has(> .collection-import)) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.collection-body {
  min-height: 0;
  display: grid;
  gap: 1rem;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.collection-parsers,
.collection-parsers label {
  display: grid;
  gap: 0.5rem;
}
.collection-parsers label > span {
  overflow-wrap: anywhere;
  font-size: var(--font-size-meta);
}
.collection-drop.is-compact {
  padding: 0.75rem 1rem;
  gap: 0.35rem;
}
.collection-drop.is-compact > svg,
.collection-drop.is-compact > p {
  display: none;
}
.collection-drop {
  display: grid;
  justify-items: center;
  gap: 0.65rem;
  padding: 1.6rem 1rem;
  border: 1px dashed var(--line);
  border-radius: var(--app-radius);
  background: var(--app-surface-subtle);
  transition:
    border-color 160ms ease,
    background 160ms ease;
}
.collection-drop.is-over {
  border-color: var(--green);
  background: var(--app-selected);
}
.collection-drop > svg {
  color: var(--green);
}
.collection-drop p,
.collection-preview-title p {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.collection-input-actions,
.collection-footer > div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.collection-input-actions {
  justify-content: center;
  margin-top: 0.25rem;
}
.collection-files,
.collection-candidates,
.collection-skipped ul {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 20rem;
  overflow: auto;
}
.collection-files li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--line);
}
.collection-file-name,
.collection-skipped li span {
  overflow-wrap: anywhere;
}
.collection-text-toggle {
  justify-self: start;
}
.collection-text,
.collection-text label {
  display: grid;
  gap: 0.5rem;
}
.collection-text {
  gap: 1rem;
  animation: collection-appear 160ms ease;
}
.collection-field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 9rem;
  gap: 1rem;
}
.collection-destination {
  display: grid;
  grid-template-columns: auto minmax(10rem, 18rem);
  gap: 0.75rem;
  align-items: center;
}
.collection-skipped {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.collection-skipped summary {
  cursor: pointer;
}
.collection-skipped li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  padding: 0.5rem 0;
}
.collection-preview-title {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}
.collection-preview-title > svg {
  flex: none;
  color: var(--green);
  margin-top: 0.15rem;
}
.collection-preview-title p {
  margin-top: 0.3rem;
}
.collection-candidates li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--line);
}
.collection-candidates li > div {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.collection-candidates li > div > span,
.collection-candidate-status {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.collection-footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.collection-footer > .muted {
  font-size: var(--font-size-meta);
}
.collection-progress {
  margin: 0;
  color: var(--muted);
}
@keyframes collection-appear {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (max-width: 560px) {
  .collection-footer {
    align-items: flex-start;
    flex-direction: column;
  }
  .collection-footer > div {
    width: 100%;
    justify-content: flex-end;
  }
  .collection-field-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .collection-input-actions {
    justify-content: flex-start;
  }
  .collection-drop {
    justify-items: start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .collection-drop {
    transition: none;
  }
  .collection-text {
    animation: none;
  }
}
</style>
