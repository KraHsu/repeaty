<script setup lang="ts">
import { UiButton, UiInput, UiSelect, UiCollapsible } from '../components/ui'
import { computed, onMounted, onUnmounted, ref, reactive, watch } from 'vue'
import {
  FolderOpen,
  FolderPlus,
  RefreshCw,
  X,
  Check,
  CheckCircle2,
  FileText,
  ChevronDown,
  ArchiveRestore,
  History,
} from '@lucide/vue'
import { t, validationMessage, type DisplayMessage } from '../i18n'
import type { useLibrary } from '../composables/useLibrary'
import type { ChangeStatus, FileChange } from '../workspace/changes'
import { previewScanSchema } from '../workspace/preview'
import { createInspector } from './workspace-inspector'
import { workspaceMonitor } from './workspace-monitor'
import { scanSchema, type WorkspaceScan } from './workspace-scan'
import { z } from 'zod'
import AppModal from '../components/AppModal.vue'
import { noteLifecycle, retiredSummarySchema, type RetiredNote } from './retirement'
import {
  readWorkspaceMarkdown,
  registerWorkspaceNote,
  registerWorkspaceSource,
  rewriteWorkspaceDocument,
  WorkspaceFormatError,
} from '../workspace/markdown'
import { workspacePathKey } from '../workspace/changes'
import { displayFilesystemPath } from './display-path'
import type { NoteInput } from '../core/model'
import { prepareSource } from '../core/sources'
import type { SourceInput } from '../core/source-data'
import type { DocumentWrite } from './repository'
import {
  workspaceStatus as status,
  workspaceLoading,
  workspaceAttention,
  initializeWorkspaces,
  loadWorkspaceStatus,
  chooseWorkspace,
  closeWorkspace,
  recentWorkspace,
  restoreWorkspace,
  workspaceApi,
  nativeError,
} from './workspaces'
const props = defineProps<{ workspace: ReturnType<typeof useLibrary> }>()
const emit = defineEmits<{ changed: [] }>()
const inspector = createInspector()
const busy = ref(true),
  error = ref<DisplayMessage>(''),
  files = ref<FileChange[]>([]),
  selected = ref(''),
  showAccepted = ref(false),
  query = ref(''),
  page = ref(1)
const scan = ref<WorkspaceScan>()
const archived = ref<{ notes: z.infer<typeof retiredSummarySchema>[]; total: number }>({
  notes: [],
  total: 0,
})
const archiveQuery = ref(''),
  archivePage = ref(1)
async function loadArchive(page = 1) {
  const active = status.value?.active
  if (!active) return
  const value = z
    .object({ notes: z.array(retiredSummarySchema).max(50), total: z.number().int().nonnegative() })
    .parse(
      await workspaceApi('workspace_read', {
        token: active.token,
        request: { type: 'retired-list', query: archiveQuery.value, offset: (page - 1) * 50 },
      }),
    )
  if (!alive) return
  const last = Math.max(1, Math.ceil(value.total / 50))
  if (page > last) {
    await loadArchive(last)
    return
  }
  archived.value = value
  archivePage.value = page
}
const locked = computed(() => busy.value || props.workspace.busy.value || workspaceLoading.value)
const current = computed(() => files.value.find((file) => file.path === selected.value))
const accepted = computed(
  () =>
    scan.value?.accepted.find(
      (doc) => doc.id === current.value?.identity?.id && doc.kind === current.value.identity.kind,
    ) ?? scan.value?.accepted.find((doc) => doc.path === selected.value),
)
const observed = computed(() => scan.value?.working.find((doc) => doc.path === selected.value))
const raw = computed(
  () =>
    (showAccepted.value ? accepted.value?.raw : observed.value?.raw) ?? accepted.value?.raw ?? '',
)
const filtered = computed(() =>
  files.value.filter((file) => file.path.toLowerCase().includes(query.value.toLowerCase())),
)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 50)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 50, page.value * 50))
const pendingCount = computed(
  () => files.value.filter((file) => file.status !== 'unchanged').length,
)
const workspaceName = computed(() => {
  const path = displayFilesystemPath(status.value?.active?.path ?? '')
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
})
const fileName = (path: string) => path.split('/').at(-1) ?? path
const labels: Record<ChangeStatus, string> = {
  unchanged: '未变化',
  modified: '文件已修改',
  renamed: '文件已改名',
  'renamed-modified': '改名并修改',
  new: '尚未接受',
  unmanaged: '待添加 · Markdown',
  unregistered: '缺少身份',
  pending: '需要检查',
  conflict: '存在冲突',
  missing: '文件缺失',
}
let mediaCheck = 0
async function checkMedia(path: string) {
  const sequence = ++mediaCheck,
    active = status.value?.active
  const file = files.value.find((file) => file.path === path)
  if (!active || !file?.identity || file.status !== 'unchanged') return
  try {
    const result = z.object({ changed: z.array(z.string()) }).parse(
      await workspaceApi('workspace_read', {
        token: active.token,
        request: { type: 'check-media', kind: file.identity.kind, id: file.identity.id },
      }),
    )
    if (!alive || sequence !== mediaCheck || selected.value !== path) return
    if (result.changed.length)
      files.value = files.value.map((entry) =>
        entry === file ? { ...entry, status: 'modified', reason: 'media-changed' } : entry,
      )
  } catch (issue) {
    if (alive && sequence === mediaCheck) error.value = issue as Error
  }
}
function selectFile(path: string) {
  selected.value = path
  showAccepted.value = false
  void checkMedia(path)
}
function reasonText(reason: string) {
  const labels: Record<string, string> = {
    'registered-identity-removed': '文件中的笔记身份已被移除，请恢复后再接受修改。',
    'registered-identity-changed': '文件身份与原笔记不同，请检查文件头。',
    'duplicate-id': '多个文件使用了同一个身份，请保留一份后重新扫描。',
    'duplicate-path': '文件路径重复，请改名后重新扫描。',
    'confirm-stable-deletion': '磁盘上缺少文件，已接受的内容和学习记录仍保留。',
    'media-changed': '正文引用的附件已变化，接受后保存新的附件版本。',
  }
  return t(labels[reason] ?? '文件格式或引用无效，请检查后重新扫描。')
}
let alive = true
async function run(action: () => unknown | Promise<unknown>) {
  if (locked.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (issue) {
    error.value = issue as Error
  } finally {
    if (alive) busy.value = false
  }
}
async function refresh() {
  if (!alive) return
  const active = status.value?.active
  if (!active) return
  const monitor = workspaceMonitor.value
  if (monitor?.active.token === active.token) {
    await monitor.refresh()
    if (alive && monitor.snapshot.value)
      await applyScan(monitor.snapshot.value, monitor.changes.value, true)
    return
  }
  const value = scanSchema.parse(
    await workspaceApi('workspace_read', { token: active.token, request: { type: 'scan' } }),
  )
  if (!alive) return
  const changes = await inspector.inspect(
    previewScanSchema.parse({
      token: active.token,
      complete: true,
      accepted: value.accepted.map((doc) => ({
        id: doc.id,
        path: doc.path,
        raw: doc.raw,
        cards:
          doc.kind === 'note'
            ? props.workspace.library.value.cards
                .filter((card) => card.noteId === doc.id)
                .map((card) => ({ id: card.id, variant: card.variant, lifecycle: 'active' }))
            : [],
      })),
      observations: value.working.map((doc) => ({ path: doc.path, raw: doc.raw })),
      issues: [],
    }),
  )
  if (!alive) return
  await applyScan(value, changes, true)
}
let displaySequence = 0
async function applyScan(value: WorkspaceScan, changes: FileChange[], resetPage = false) {
  if (!alive) return
  const sequence = ++displaySequence
  scan.value = value
  if (archiveQuery.value || archivePage.value > 1) await loadArchive(archivePage.value)
  else archived.value = { notes: value.retired, total: value.retiredCount }
  if (!alive || sequence !== displaySequence) return
  files.value = changes
  workspaceAttention.value = value.attention
  if (!changes.some((file) => file.path === selected.value)) selected.value = changes[0]?.path ?? ''
  page.value = resetPage
    ? 1
    : Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / 50)))
  if (resetPage || !workspaceMonitor.value) await checkMedia(selected.value)
}
type Action = {
  mode: 'accept' | 'remove' | 'restore'
  id: string
  path: string
  raw: string
  retired: RetiredNote
  expectedHash: string | null
  workingHash?: string
  scanHash: string
}
const action = ref<Action>()
const form = reactive({
  deckId: '',
  type: 'basic' as NoteInput['type'],
  format: 'markdown' as 'plain' | 'markdown',
  path: '',
})
const canAccept = computed(
  () =>
    !!current.value &&
    ((['new', 'modified', 'renamed', 'renamed-modified'].includes(current.value.status) &&
      ['note', 'source'].includes(current.value.identity?.kind ?? '')) ||
      ['unmanaged', 'unregistered'].includes(current.value.status)) &&
    (current.value.path.startsWith('notes/') || current.value.path.startsWith('sources/')),
)
const sourceAction = ref<{
  id: string
  path: string
  raw: string
  workingHash: string
  expectedHash: string | null
  scanHash: string
}>()
const sourceForm = reactive({ title: '', url: '', format: 'markdown' as 'plain' | 'markdown' })
async function prepareSourceFile() {
  const path = selected.value
  await refresh()
  if (selected.value !== path) throw nativeError('working-file-changed')
  if (!observed.value?.raw || !observed.value.hash || !scan.value) return
  const parsed = readWorkspaceMarkdown(observed.value.raw)
  const doc = parsed.status === 'managed' ? parsed.document : undefined
  if (
    (doc?.properties.title !== undefined && typeof doc.properties.title !== 'string') ||
    (doc?.properties.url !== undefined && typeof doc.properties.url !== 'string')
  )
    throw nativeError('invalid-data')
  const id = doc?.identity.id ?? crypto.randomUUID()
  const source = props.workspace.library.value.sources.find((source) => source.id === id)
  sourceForm.title = String(
    doc?.properties.title ??
      source?.title ??
      selected.value.split('/').at(-1)!.replace(/\.md$/, ''),
  )
  sourceForm.url = String(doc?.properties.url ?? source?.url ?? '')
  sourceForm.format = doc?.header.format ?? source?.format ?? 'markdown'
  sourceAction.value = {
    id,
    path: selected.value,
    raw: observed.value.raw,
    expectedHash: accepted.value?.hash ?? null,
    workingHash: observed.value.hash,
    scanHash: scan.value.scanHash,
  }
}
const sourceProposal = computed(() => {
  if (!sourceAction.value) return undefined
  try {
    let doc = registerWorkspaceSource(sourceAction.value.raw, {
      id: sourceAction.value.id,
      format: sourceForm.format,
    })
    if (doc.content.kind !== 'source') throw nativeError('invalid-data')
    const input: SourceInput = { ...sourceForm, content: doc.content.body }
    prepareSource(input)
    if (
      doc.properties.title !== sourceForm.title ||
      (doc.properties.url ?? '') !== sourceForm.url
    ) {
      const rewritten = rewriteWorkspaceDocument(
        doc,
        { title: sourceForm.title, url: sourceForm.url },
        doc.content,
      )
      const parsed = readWorkspaceMarkdown(rewritten)
      if (parsed.status !== 'managed') throw nativeError('invalid-data')
      doc = parsed.document
    }
    return { input, doc }
  } catch (issue) {
    return { error: actionError(issue) }
  }
})
async function confirmSource() {
  const value = sourceAction.value,
    prepared = sourceProposal.value
  if (!value || !prepared || 'error' in prepared) return
  await props.workspace.acceptExternalSource(
    value.id,
    prepared.input!,
    {
      kind: 'source',
      id: value.id,
      path: value.path,
      raw: prepared.doc!.raw,
      expectedHash: value.expectedHash,
      workingHash: value.workingHash,
    },
    value.scanHash,
  )
  sourceAction.value = undefined
  emit('changed')
  await refresh()
}
const canRemove = computed(
  () =>
    current.value?.status === 'missing' &&
    current.value.identity?.kind === 'note' &&
    props.workspace.library.value.notes.some((note) => note.id === current.value?.identity?.id),
)
function actionError(issue: unknown): DisplayMessage {
  if (issue instanceof z.ZodError) return validationMessage(issue)
  if (issue instanceof WorkspaceFormatError) {
    if (issue.message === 'missing-answer-boundary')
      return '题面和答案之间请单独放一行 <!-- repeaty:answer -->。'
    if (issue.message === 'invalid-cloze')
      return '挖空格式应为 {{c1::答案}} 或 {{c1::答案::提示}}，编号为 1–99，不支持嵌套挖空。'
    return '文件格式或引用无效，请检查后重新扫描。'
  }
  return issue instanceof Error ? issue : '内容无效，修改未保存。'
}
async function prepare(mode: Action['mode'], retiredId?: string) {
  const pathBefore = selected.value
  await refresh()
  if (mode !== 'restore' && selected.value !== pathBefore) throw nativeError('working-file-changed')
  if (!scan.value) return
  const file = current.value,
    doc = accepted.value,
    working = observed.value
  const id = retiredId ?? file?.identity?.id ?? crypto.randomUUID()
  const retired = await props.workspace.readRetiredNote(id)
  const saved = props.workspace.library.value.notes.find((note) => note.id === id) ?? retired.note
  const parseRaw = mode === 'restore' ? retired.document?.raw : working?.raw
  const parsed = parseRaw !== undefined ? readWorkspaceMarkdown(parseRaw) : undefined
  const header = parsed?.status === 'managed' ? parsed.document.header : undefined
  const path = mode === 'restore' ? retired.document?.path : file?.path
  if (
    !path ||
    (mode === 'accept' && !working) ||
    (mode === 'restore' && (!retired.note || !retired.document))
  )
    throw nativeError('not-found')
  form.deckId = header?.deckId ?? saved?.deckId ?? props.workspace.library.value.decks[0]?.id ?? ''
  if (!props.workspace.library.value.decks.some((deck) => deck.id === form.deckId))
    form.deckId = props.workspace.library.value.decks[0]?.id ?? ''
  form.type = header?.type ?? saved?.type ?? 'basic'
  form.format = header?.format ?? saved?.format ?? 'markdown'
  form.path = path
  action.value = {
    mode,
    id,
    path,
    raw: mode === 'restore' ? retired.document!.raw : (working?.raw ?? doc?.raw ?? ''),
    retired,
    expectedHash: mode === 'restore' ? null : (doc?.hash ?? null),
    workingHash: working?.hash,
    scanHash: scan.value.scanHash,
  }
}
const proposal = computed(() => {
  const value = action.value
  if (!value || value.mode === 'remove') return undefined
  try {
    if (!props.workspace.library.value.decks.length)
      return { error: '请先创建卡组，再添加或恢复笔记。' as DisplayMessage }
    if (
      !form.path.startsWith('notes/') ||
      !form.path.endsWith('.md') ||
      !workspacePathKey(form.path)
    )
      throw new Error(t('文件路径必须位于 notes/ 下，并以 .md 结尾。'))
    const doc = registerWorkspaceNote(value.raw, {
      id: value.id,
      deckId: form.deckId,
      type: form.type,
      format: form.format,
    })
    if (doc.content.kind !== 'note') throw nativeError('invalid-data')
    const previous =
      props.workspace.library.value.notes.find((note) => note.id === value.id) ?? value.retired.note
    const input: NoteInput = {
      deckId: form.deckId,
      type: form.type,
      format: form.format,
      plugin: doc.header.plugin,
      front: doc.content.front,
      back: doc.content.back,
      tags: Array.isArray(doc.properties.tags)
        ? (doc.properties.tags as string[])
        : (previous?.tags ?? []),
      frontMedia: doc.header.frontMedia?.map((media) => media.id) ?? previous?.frontMedia ?? [],
      backMedia: doc.header.backMedia?.map((media) => media.id) ?? previous?.backMedia ?? [],
      excerpt: previous?.excerpt,
      inlineMedia: previous?.inlineMedia,
    }
    const plan = noteLifecycle(props.workspace.library.value, input, value.id, value.retired, true)
    return { input, doc, plan }
  } catch (issue) {
    return { error: actionError(issue) }
  }
})
const removeCount = computed(
  () =>
    props.workspace.library.value.cards.filter((card) => card.noteId === action.value?.id).length,
)
async function confirmAction() {
  const value = action.value
  if (!value) return
  const prepared = proposal.value
  if (value.mode !== 'remove' && (!prepared || 'error' in prepared)) return
  const document: DocumentWrite = {
    kind: 'note',
    id: value.id,
    path: value.mode === 'restore' ? form.path : value.path,
    raw: value.mode === 'remove' ? null : prepared!.doc!.raw,
    expectedHash: value.expectedHash,
    ...(value.mode === 'accept' ? { workingHash: value.workingHash } : { missing: true }),
  }
  try {
    if (value.mode === 'remove')
      await props.workspace.removeExternalNote(value.id, document, value.scanHash)
    else
      await props.workspace.acceptExternalNote(
        value.id,
        prepared!.input!,
        document,
        value.mode === 'restore' ? undefined : value.scanHash,
      )
    action.value = undefined
    emit('changed')
    await refresh()
  } catch (issue) {
    error.value = actionError(issue)
  }
}
watch(
  [() => workspaceMonitor.value?.changes.value, () => locked.value, action, sourceAction],
  async () => {
    const monitor = workspaceMonitor.value
    if (
      !alive ||
      locked.value ||
      action.value ||
      sourceAction.value ||
      !monitor?.snapshot.value ||
      monitor.active.token !== status.value?.active?.token
    )
      return
    await applyScan(monitor.snapshot.value, monitor.changes.value)
  },
)
onMounted(async () => {
  try {
    await initializeWorkspaces()
    if (!alive) return
    await loadWorkspaceStatus()
    if (!alive) return
    await refresh()
  } catch (issue) {
    if (alive) error.value = issue as Error
  } finally {
    if (alive) busy.value = false
  }
})
onUnmounted(() => {
  alive = false
  inspector.dispose()
})
</script>
<template>
  <div class="page workspace-manager" :aria-busy="locked">
    <header class="page-heading">
      <div>
        <h1>{{ t('工作目录') }}</h1>
        <p>{{ t('卡片、材料、附件和学习进度保存在同一个文件夹中。') }}</p>
      </div>
      <div class="workspace-actions">
        <UiButton
          variant="secondary"
          type="submit"
          :disabled="locked || !status"
          @click="run(() => chooseWorkspace('open'))"
        >
          <FolderOpen :size="18" />{{ t('打开目录') }}
        </UiButton>
        <UiButton
          :variant="status?.active ? 'secondary' : 'primary'"
          type="submit"
          :disabled="locked || !status"
          @click="run(() => chooseWorkspace('create'))"
        >
          <FolderPlus :size="18" />{{ t('创建学习库') }}
        </UiButton>
      </div>
    </header>
    <p v-if="workspaceLoading" role="status">{{ t('正在读取工作目录…') }}</p>
    <p v-if="workspaceMonitor?.error.value" class="import-warning" role="alert">
      {{ t(workspaceMonitor.error.value) }}
    </p>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <div v-if="status?.error" class="workspace-card" role="alert">
      <p>{{ t(nativeError(status.error)) }}</p>
      <UiButton variant="secondary" type="submit" :disabled="locked" @click="run(restoreWorkspace)">
        {{ t('重试') }}
      </UiButton>
    </div>
    <section v-if="status?.active" class="workspace-card workspace-active">
      <div class="workspace-identity">
        <span class="workspace-identity-icon" aria-hidden="true"><FolderOpen :size="26" /></span>
        <div>
          <p class="workspace-eyebrow">{{ t('当前学习库') }}</p>
          <h2>{{ workspaceName }}</h2>
          <p class="workspace-path">{{ displayFilesystemPath(status.active.path) }}</p>
        </div>
      </div>
      <UiButton variant="ghost" :disabled="locked" @click="run(closeWorkspace)">
        <X :size="16" />{{ t('关闭目录') }}
      </UiButton>
    </section>
    <section v-else-if="!workspaceLoading" class="workspace-card workspace-welcome">
      <h2>{{ t('打开文件夹，开始学习') }}</h2>
      <p>{{ t('首次使用请选择空文件夹创建学习库，入门卡组会自动添加。') }}</p>
      <p>{{ t('已有学习库请选择包含 workspace.json 的文件夹。') }}</p>
    </section>
    <p v-if="workspaceAttention.length" class="import-warning" role="status">
      {{ t('部分正文文件需要检查。已保存的学习进度仍保留在当前目录。') }}
    </p>
    <section
      v-if="status?.active"
      class="workspace-review"
      aria-labelledby="workspace-review-title"
    >
      <header class="workspace-review-heading">
        <div>
          <div class="workspace-review-title">
            <h2 id="workspace-review-title">{{ t('文件检查') }}</h2>
            <span
              v-if="scan"
              class="workspace-summary"
              :class="{ 'has-pending': pendingCount > 0 }"
            >
              <CheckCircle2 v-if="!pendingCount" :size="15" aria-hidden="true" />
              {{
                pendingCount
                  ? t('{count} 项待处理', { count: pendingCount })
                  : t('暂无待处理的文件')
              }}
            </span>
          </div>
          <p v-if="workspaceMonitor?.available.value === false" class="form-note">
            {{ t('自动检测暂不可用，可手动重新扫描；返回窗口时会补检。') }}
          </p>
          <p v-else class="form-note">
            {{ t('外部修改会自动列出，确认接受后用于学习。') }}
          </p>
        </div>
        <div class="workspace-scan-action">
          <span
            v-if="workspaceMonitor?.available.value && !workspaceMonitor.error.value"
            class="workspace-watch-status"
          >
            <span aria-hidden="true"></span>{{ t('自动检测中') }}
          </span>
          <UiButton variant="secondary" :disabled="locked" :busy="busy" @click="run(refresh)">
            <RefreshCw :size="16" />{{ t('重新扫描') }}
          </UiButton>
        </div>
      </header>
      <div v-if="scan && files.length" class="workspace-inspector">
        <div class="workspace-files">
          <div class="workspace-file-search">
            <label for="workspace-file-search">{{ t('查找文件') }}</label>
            <span class="form-note">{{ t('文件数：{count}', { count: filtered.length }) }}</span>
          </div>
          <UiInput
            id="workspace-file-search"
            v-model="query"
            :placeholder="t('文件路径')"
            @input="page = 1"
          />
          <div class="workspace-file-list" :aria-label="t('文件检查')">
            <UiButton
              variant="ghost"
              v-for="file in visible"
              :key="file.path"
              class="workspace-file"
              :class="{ selected: selected === file.path }"
              :aria-pressed="selected === file.path"
              @click="selectFile(file.path)"
            >
              <FileText :size="18" aria-hidden="true" />
              <span class="workspace-file-info">
                <strong>{{ file.path }}</strong>
                <span class="workspace-file-status" :data-state="file.status">{{
                  t(labels[file.status])
                }}</span>
              </span>
            </UiButton>
            <p v-if="!visible.length" class="workspace-no-match form-note">
              {{ t('没有匹配的文件') }}
            </p>
          </div>
          <div v-if="pages > 1" class="workspace-actions">
            <UiButton variant="secondary" type="submit" :disabled="page === 1" @click="page--">
              {{ t('上一页') }}</UiButton
            ><span>{{ page }} / {{ pages }}</span
            ><UiButton variant="secondary" type="submit" :disabled="page === pages" @click="page++">
              {{ t('下一页') }}
            </UiButton>
          </div>
        </div>
        <div class="workspace-document">
          <header class="workspace-document-heading">
            <div>
              <h3>{{ current ? fileName(current.path) : t('选择文件') }}</h3>
              <p v-if="current" class="workspace-document-path">{{ current.path }}</p>
            </div>
            <span v-if="current" class="workspace-document-status" :data-state="current.status">{{
              t(labels[current.status])
            }}</span>
          </header>
          <div v-if="current" class="workspace-document-toolbar">
            <div class="workspace-versions" :aria-label="t('选择文件')">
              <UiButton
                variant="ghost"
                type="submit"
                :class="{ selected: !showAccepted }"
                :aria-pressed="!showAccepted"
                @click="showAccepted = false"
              >
                {{ t('工作文件') }}</UiButton
              ><UiButton
                variant="ghost"
                type="submit"
                :class="{ selected: showAccepted }"
                :aria-pressed="showAccepted"
                @click="showAccepted = true"
              >
                {{ t('已接受版本') }}</UiButton
              >
            </div>
            <div class="workspace-actions">
              <UiButton
                variant="primary"
                type="submit"
                v-if="canAccept"
                :disabled="locked"
                @click="
                  run(() =>
                    current?.path.startsWith('sources/') ? prepareSourceFile() : prepare('accept'),
                  )
                "
              >
                <Check :size="18" />{{ t('接受修改') }}
              </UiButton>
              <UiButton
                variant="danger"
                type="submit"
                v-if="canRemove"
                :disabled="locked"
                @click="run(() => prepare('remove'))"
              >
                {{ t('移除这条笔记') }}
              </UiButton>
            </div>
          </div>
          <div v-if="current" class="workspace-document-body">
            <p v-if="current?.reason" class="workspace-reason" role="status">
              {{ reasonText(current.reason) }}
            </p>
            <p
              v-if="current?.identity?.kind === 'source' && current.status !== 'unchanged'"
              class="form-note"
            >
              {{ t('接受新版本后，已有摘录继续引用原版。阅读安排保持不变。') }}
            </p>
            <pre
              class="workspace-raw"
              tabindex="0"
              :aria-label="t(showAccepted ? '已接受版本' : '工作文件')"
              >{{ raw }}</pre>
          </div>
          <div v-else class="workspace-empty">
            <FileText :size="28" aria-hidden="true" />
            <p>{{ t('选择左侧文件，查看工作文件与已接受版本。') }}</p>
          </div>
        </div>
      </div>
      <div v-else class="workspace-empty">
        <CheckCircle2 :size="28" aria-hidden="true" />
        <p>{{ t(scan ? '目录中暂无可检查的文件' : '等待检查') }}</p>
      </div>
    </section>
    <UiCollapsible
      v-if="scan?.retiredCount"
      class="workspace-card workspace-retired workspace-management"
      :default-open="true"
      :unmount-on-hide="false"
    >
      <template #default="{ open }">
        <UiButton variant="ghost" class="workspace-management-toggle">
          <ArchiveRestore :size="20" aria-hidden="true" />
          <span>{{ t('已移除的笔记') }}</span>
          <span class="workspace-count">{{ scan.retiredCount }}</span>
          <ChevronDown
            :size="18"
            class="workspace-disclosure"
            :class="{ 'is-open': open }"
            aria-hidden="true"
          />
        </UiButton>
      </template>
      <template #content>
        <div class="workspace-management-content">
          <p class="form-note">{{ t('笔记和学习记录仍保存在目录中，可以恢复后继续学习。') }}</p>
          <form
            class="workspace-actions workspace-archive-search"
            @submit.prevent="run(() => loadArchive())"
          >
            <label for="archive-search">{{ t('查找已移除的笔记') }}</label
            ><UiInput id="archive-search" v-model="archiveQuery" :disabled="locked" /><UiButton
              variant="secondary"
              type="submit"
              :disabled="locked"
            >
              {{ t('查找') }}
            </UiButton>
          </form>
          <p class="form-note">{{ t('共 {count} 条', { count: archived.total }) }}</p>
          <div class="workspace-retired-list">
            <div v-for="entry in archived.notes" :key="entry.id" class="workspace-retired-entry">
              <div>
                <strong>{{ entry.title }}</strong>
                <p>{{ t('{count} 张卡片', { count: entry.cards }) }} · {{ entry.path }}</p>
              </div>
              <UiButton
                variant="secondary"
                type="submit"
                :disabled="locked"
                @click="run(() => prepare('restore', entry.id))"
              >
                {{ t('恢复笔记') }}
              </UiButton>
            </div>
          </div>
          <div v-if="archived.total > 50" class="workspace-actions">
            <UiButton
              variant="secondary"
              type="submit"
              :disabled="locked || archivePage === 1"
              @click="run(() => loadArchive(archivePage - 1))"
            >
              {{ t('上一页') }}</UiButton
            ><span>{{ archivePage }} / {{ Math.ceil(archived.total / 50) }}</span
            ><UiButton
              variant="secondary"
              type="submit"
              :disabled="locked || archivePage * 50 >= archived.total"
              @click="run(() => loadArchive(archivePage + 1))"
            >
              {{ t('下一页') }}
            </UiButton>
          </div>
        </div>
      </template>
    </UiCollapsible>
    <AppModal
      v-if="sourceAction"
      :title="t('接受材料修改')"
      :busy="locked"
      :error="error ? t(error) : undefined"
      @close="sourceAction = undefined"
    >
      <label class="workspace-field"
        >{{ t('材料标题') }}<UiInput v-model="sourceForm.title" :disabled="locked" maxlength="160"
      /></label>
      <label class="workspace-field"
        >{{ t('来源链接（选填）')
        }}<UiInput v-model="sourceForm.url" :disabled="locked" maxlength="2048"
      /></label>
      <label class="workspace-field"
        >{{ t('内容格式')
        }}<UiSelect
          :items="[
            { label: t('Markdown / 数学公式'), value: 'markdown' },
            { label: t('纯文本'), value: 'plain' },
          ]"
          v-model="sourceForm.format"
          :disabled="locked"
        ></UiSelect
      ></label>
      <p v-if="sourceProposal && 'error' in sourceProposal" role="alert" class="import-warning">
        {{ t(sourceProposal.error!) }}
      </p>
      <p>
        {{
          t(
            '正文或附件变更后，从新版开头阅读；只改标题或文件名会保留当前位置。阅读安排、摘录和卡片进度不变。',
          )
        }}
      </p>
      <div class="workspace-actions workspace-confirm">
        <UiButton
          variant="secondary"
          type="submit"
          :disabled="locked"
          @click="sourceAction = undefined"
        >
          {{ t('取消') }}</UiButton
        ><UiButton
          variant="primary"
          type="submit"
          :disabled="locked || !sourceProposal || 'error' in sourceProposal"
          @click="run(confirmSource)"
        >
          {{ t('确认接受') }}
        </UiButton>
      </div>
    </AppModal>
    <AppModal
      v-if="action"
      :title="
        t(
          action.mode === 'remove'
            ? '确认移除笔记'
            : action.mode === 'restore'
              ? '恢复笔记'
              : '接受文件修改',
        )
      "
      :busy="busy || workspace.busy.value"
      :error="error ? t(error) : undefined"
      @close="action = undefined"
    >
      <p v-if="action.mode === 'remove'">
        {{
          t('磁盘文件已不存在。确认后，{count} 张卡片将退出学习队列，笔记和历史记录仍可恢复。', {
            count: removeCount,
          })
        }}
      </p>
      <template v-else>
        <label class="workspace-field"
          >{{ t('所属卡组')
          }}<UiSelect
            :items="[
              ...workspace.library.value.decks.map((deck) => ({
                label: deck.name,
                value: deck.id,
              })),
            ]"
            v-model="form.deckId"
            :disabled="locked"
          ></UiSelect
        ></label>
        <label class="workspace-field"
          >{{ t('笔记类型')
          }}<UiSelect
            :items="[
              { label: t('正反面'), value: 'basic' },
              { label: t('双向卡'), value: 'reversed' },
              { label: t('挖空卡'), value: 'cloze' },
              ...(form.type === 'plugin' ? [{ label: t('插件题目'), value: 'plugin' }] : []),
            ]"
            v-model="form.type"
            :disabled="locked"
          ></UiSelect
        ></label>
        <label class="workspace-field"
          >{{ t('内容格式')
          }}<UiSelect
            :items="[
              { label: t('Markdown / 数学公式'), value: 'markdown' },
              { label: t('纯文本'), value: 'plain' },
            ]"
            v-model="form.format"
            :disabled="locked"
          ></UiSelect
        ></label>
        <label v-if="action.mode === 'restore'" class="workspace-field"
          >{{ t('文件路径') }}<UiInput v-model="form.path" :disabled="locked"
        /></label>
        <p v-if="proposal && 'error' in proposal" class="import-warning" role="alert">
          {{ t(proposal.error!) }}
        </p>
        <p v-else-if="proposal?.plan" class="workspace-plan">
          {{
            t('保留 {keep} 张，恢复 {restore} 张，新增 {create} 张，退役 {retire} 张。', {
              keep: proposal.plan.keep,
              restore: proposal.plan.restore,
              create: proposal.plan.create,
              retire: proposal.plan.retire,
            })
          }}
        </p>
        <p>{{ t('退役卡片不再进入复习，历史记录保留；重新添加相同方向或挖空编号时恢复。') }}</p>
      </template>
      <div class="workspace-actions workspace-confirm">
        <UiButton variant="secondary" type="submit" :disabled="locked" @click="action = undefined">
          {{ t('取消') }}</UiButton
        ><UiButton
          variant="primary"
          type="submit"
          :disabled="locked || (action.mode !== 'remove' && (!proposal || 'error' in proposal))"
          @click="run(confirmAction)"
        >
          {{
            t(
              action.mode === 'remove'
                ? '确认移除'
                : action.mode === 'restore'
                  ? '确认恢复'
                  : '确认接受',
            )
          }}
        </UiButton>
      </div>
    </AppModal>
    <section v-if="status?.recent.length" class="workspace-recent">
      <h2 class="workspace-recent-heading">
        <History :size="20" aria-hidden="true" />
        <span>{{ t('最近打开') }}</span>
        <span class="workspace-count">{{ status.recent.length }}</span>
      </h2>
      <ul class="workspace-recent-list">
        <li v-for="entry in status.recent" :key="entry.path">
          <UiButton
            variant="ghost"
            class="workspace-recent-entry rounded-none"
            :disabled="locked"
            @click="run(() => recentWorkspace(entry.path, entry.id))"
          >
            <FolderOpen :size="18" /><span>{{ displayFilesystemPath(entry.path) }}</span>
          </UiButton>
        </li>
      </ul>
    </section>
  </div>
</template>
<style scoped src="../styles/workspace.css"></style>
