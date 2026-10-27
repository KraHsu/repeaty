<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, reactive } from 'vue'
import { FolderOpen, FolderPlus, RefreshCw, X, Check } from '@lucide/vue'
import { t, type DisplayMessage } from '../i18n'
import type { useLibrary } from '../composables/useLibrary'
import type { ChangeStatus, FileChange } from '../workspace/changes'
import { previewScanSchema } from '../workspace/preview'
import { createInspector } from './workspace-inspector'
import { z } from 'zod'
import AppModal from '../components/AppModal.vue'
import { noteLifecycle, retiredSummarySchema, type RetiredNote } from './retirement'
import {
  readWorkspaceMarkdown,
  registerWorkspaceNote,
  WorkspaceFormatError,
} from '../workspace/markdown'
import { workspacePathKey } from '../workspace/changes'
import type { NoteInput } from '../core/model'
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
const scanSchema = z.object({
  accepted: z.array(
    z.object({
      kind: z.enum(['note', 'source']),
      id: z.string(),
      path: z.string(),
      hash: z.string(),
      raw: z.string(),
    }),
  ),
  working: z.array(z.object({ path: z.string(), hash: z.string(), raw: z.string() })),
  attention: z.array(z.object({ path: z.string(), status: z.string() })),
  scanHash: z.string(),
  retired: z.array(retiredSummarySchema),
  retiredCount: z.number().int().nonnegative().default(0),
})
const scan = ref<z.infer<typeof scanSchema>>()
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
const labels: Record<ChangeStatus, string> = {
  unchanged: '未变化',
  modified: '文件已修改',
  renamed: '文件已改名',
  'renamed-modified': '改名并修改',
  new: '尚未接受',
  unmanaged: '普通 Markdown',
  unregistered: '缺少身份',
  pending: '需要检查',
  conflict: '存在冲突',
  missing: '文件缺失',
}
function selectFile(path: string) {
  selected.value = path
  showAccepted.value = false
}
function reasonText(reason: string) {
  const labels: Record<string, string> = {
    'registered-identity-removed': '文件中的笔记身份已被移除，请恢复后再接受修改。',
    'registered-identity-changed': '文件身份与原笔记不同，请检查文件头。',
    'duplicate-id': '多个文件使用了同一个身份，请保留一份后重新扫描。',
    'duplicate-path': '文件路径重复，请改名后重新扫描。',
    'confirm-stable-deletion': '磁盘上缺少文件，已接受的内容和学习记录仍保留。',
  }
  return t(labels[reason] ?? '文件格式或引用无效，请检查后重新扫描。')
}
let alive = true
async function run(action: () => Promise<unknown>) {
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
  scan.value = value
  if (archiveQuery.value || archivePage.value > 1) await loadArchive(archivePage.value)
  else archived.value = { notes: value.retired, total: value.retiredCount }
  files.value = changes
  workspaceAttention.value = value.attention
  if (!changes.some((file) => file.path === selected.value)) selected.value = changes[0]?.path ?? ''
  page.value = 1
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
      current.value.identity?.kind === 'note') ||
      ['unmanaged', 'unregistered'].includes(current.value.status)) &&
    current.value.path.startsWith('notes/'),
)
const answerHint = computed(() => t('题面和答案之间请单独放一行 <!-- repeaty:answer -->。'))
const canRemove = computed(
  () =>
    current.value?.status === 'missing' &&
    current.value.identity?.kind === 'note' &&
    props.workspace.library.value.notes.some((note) => note.id === current.value?.identity?.id),
)
function actionError(issue: unknown): DisplayMessage {
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
        <button
          class="button"
          :disabled="locked || !status"
          @click="run(() => chooseWorkspace('open'))"
        >
          <FolderOpen :size="18" />{{ t('打开目录') }}
        </button>
        <button
          class="button primary"
          :disabled="locked || !status"
          @click="run(() => chooseWorkspace('create'))"
        >
          <FolderPlus :size="18" />{{ t('创建学习库') }}
        </button>
      </div>
    </header>
    <p v-if="workspaceLoading" role="status">{{ t('正在读取工作目录…') }}</p>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <div v-if="status?.error" class="workspace-card" role="alert">
      <p>{{ t(nativeError(status.error)) }}</p>
      <button class="button" :disabled="locked" @click="run(restoreWorkspace)">
        {{ t('重试') }}
      </button>
    </div>
    <section v-if="status?.active" class="workspace-card workspace-active">
      <div>
        <h2>{{ t('当前学习库') }}</h2>
        <p class="workspace-path">{{ status.active.path }}</p>
      </div>
      <div class="workspace-actions">
        <button class="button" :disabled="locked" @click="run(refresh)">
          <RefreshCw :size="18" />{{ t('重新扫描') }}</button
        ><button class="button" :disabled="locked" @click="run(closeWorkspace)">
          <X :size="18" />{{ t('关闭目录') }}
        </button>
      </div>
    </section>
    <section v-else-if="!workspaceLoading" class="workspace-card workspace-welcome">
      <h2>{{ t('打开文件夹，开始学习') }}</h2>
      <p>{{ t('首次使用请选择空文件夹创建学习库，入门卡组会自动添加。') }}</p>
      <p>{{ t('已有学习库请选择包含 workspace.json 的文件夹。') }}</p>
    </section>
    <p v-if="workspaceAttention.length" class="import-warning" role="status">
      {{ t('部分正文文件需要检查。已保存的学习进度仍保留在当前目录。') }}
    </p>
    <section v-if="scan" class="workspace-inspector">
      <div class="workspace-files">
        <label for="workspace-file-search">{{ t('查找文件') }}</label
        ><input
          id="workspace-file-search"
          v-model="query"
          :placeholder="t('文件路径')"
          @input="page = 1"
        />
        <p class="form-note">{{ t('文件数：{count}', { count: filtered.length }) }}</p>
        <button
          v-for="file in visible"
          :key="file.path"
          class="workspace-file"
          :class="{ selected: selected === file.path }"
          @click="selectFile(file.path)"
        >
          <strong>{{ file.path }}</strong
          ><span class="workspace-file-status">{{ t(labels[file.status]) }}</span>
        </button>
        <div v-if="pages > 1" class="workspace-actions">
          <button class="button" :disabled="page === 1" @click="page--">{{ t('上一页') }}</button
          ><span>{{ page }} / {{ pages }}</span
          ><button class="button" :disabled="page === pages" @click="page++">
            {{ t('下一页') }}
          </button>
        </div>
      </div>
      <div class="workspace-document">
        <h2>{{ current?.path ?? t('选择文件') }}</h2>
        <div v-if="current" class="workspace-actions workspace-versions">
          <button
            class="button"
            :class="{ selected: !showAccepted }"
            :aria-pressed="!showAccepted"
            @click="showAccepted = false"
          >
            {{ t('工作文件') }}</button
          ><button
            class="button"
            :class="{ selected: showAccepted }"
            :aria-pressed="showAccepted"
            @click="showAccepted = true"
          >
            {{ t('已接受版本') }}</button
          ><button
            v-if="canAccept"
            class="button primary"
            :disabled="locked"
            @click="run(() => prepare('accept'))"
          >
            <Check :size="18" />{{ t('接受修改') }}
          </button>
          <button
            v-if="canRemove"
            class="button danger"
            :disabled="locked"
            @click="run(() => prepare('remove'))"
          >
            {{ t('移除这条笔记') }}
          </button>
        </div>
        <p
          v-if="canAccept && ['unmanaged', 'unregistered'].includes(current!.status)"
          class="form-note"
        >
          {{ answerHint }}
        </p>
        <p v-if="current?.reason" class="form-note">{{ reasonText(current.reason) }}</p>
        <p
          v-if="current?.identity?.kind === 'source' && current.status !== 'unchanged'"
          class="form-note"
        >
          {{ t('材料快照的外部修改暂不自动接受，原有摘录与出处保持不变。') }}
        </p>
        <pre class="workspace-raw">{{ raw }}</pre>
      </div>
    </section>
    <section v-if="scan?.retiredCount" class="workspace-card workspace-retired">
      <h2>{{ t('已移除的笔记') }}</h2>
      <p>{{ t('笔记和学习记录仍保存在目录中，可以恢复后继续学习。') }}</p>
      <form
        class="workspace-actions workspace-archive-search"
        @submit.prevent="run(() => loadArchive())"
      >
        <label for="archive-search">{{ t('查找已移除的笔记') }}</label
        ><input id="archive-search" v-model="archiveQuery" :disabled="locked" /><button
          class="button"
          :disabled="locked"
        >
          {{ t('查找') }}
        </button>
      </form>
      <p>{{ t('共 {count} 条', { count: archived.total }) }}</p>
      <div v-for="entry in archived.notes" :key="entry.id" class="workspace-retired-entry">
        <div>
          <strong>{{ entry.title }}</strong>
          <p>{{ t('{count} 张卡片', { count: entry.cards }) }} · {{ entry.path }}</p>
        </div>
        <button class="button" :disabled="locked" @click="run(() => prepare('restore', entry.id))">
          {{ t('恢复笔记') }}
        </button>
      </div>
      <div v-if="archived.total > 50" class="workspace-actions">
        <button
          class="button"
          :disabled="locked || archivePage === 1"
          @click="run(() => loadArchive(archivePage - 1))"
        >
          {{ t('上一页') }}</button
        ><span>{{ archivePage }} / {{ Math.ceil(archived.total / 50) }}</span
        ><button
          class="button"
          :disabled="locked || archivePage * 50 >= archived.total"
          @click="run(() => loadArchive(archivePage + 1))"
        >
          {{ t('下一页') }}
        </button>
      </div>
    </section>
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
          }}<select v-model="form.deckId" :disabled="locked">
            <option v-for="deck in workspace.library.value.decks" :key="deck.id" :value="deck.id">
              {{ deck.name }}
            </option>
          </select></label
        >
        <label class="workspace-field"
          >{{ t('笔记类型')
          }}<select v-model="form.type" :disabled="locked">
            <option value="basic">{{ t('正反面') }}</option>
            <option value="reversed">{{ t('双向卡') }}</option>
            <option value="cloze">{{ t('挖空卡') }}</option>
            <option v-if="form.type === 'plugin'" value="plugin">{{ t('插件题目') }}</option>
          </select></label
        >
        <label class="workspace-field"
          >{{ t('内容格式')
          }}<select v-model="form.format" :disabled="locked">
            <option value="markdown">{{ t('Markdown / 数学公式') }}</option>
            <option value="plain">{{ t('纯文本') }}</option>
          </select></label
        >
        <label v-if="action.mode === 'restore'" class="workspace-field"
          >{{ t('文件路径') }}<input v-model="form.path" :disabled="locked"
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
        <button class="button" :disabled="locked" @click="action = undefined">
          {{ t('取消') }}</button
        ><button
          class="button primary"
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
        </button>
      </div>
    </AppModal>
    <section v-if="status?.recent.length" class="workspace-card">
      <h2>{{ t('最近打开') }}</h2>
      <button
        v-for="entry in status.recent"
        :key="entry.path"
        class="workspace-recent-entry"
        :disabled="locked"
        @click="run(() => recentWorkspace(entry.path, entry.id))"
      >
        <FolderOpen :size="18" /><span>{{ entry.path }}</span>
      </button>
    </section>
  </div>
</template>
<style scoped>
.workspace-manager {
  display: grid;
  gap: 1.5rem;
  max-width: 1500px;
}
.workspace-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.workspace-card {
  padding: 1.3rem;
  border: 1px solid #dfe5d8;
  border-radius: 13px;
  background: white;
}
.workspace-card h2,
.workspace-document h2 {
  font-size: 1.1rem;
  margin: 0 0 0.6rem;
}
.workspace-active {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.workspace-path {
  overflow-wrap: anywhere;
  margin: 0.3rem 0;
}
.workspace-welcome p {
  line-height: 1.8;
}
.workspace-inspector {
  display: grid;
  grid-template-columns: minmax(210px, 280px) minmax(0, 1fr);
  background: #fff;
  border: 1px solid #dfe5d8;
  border-radius: 13px;
  overflow: hidden;
}
.workspace-files,
.workspace-document {
  padding: 1.3rem;
  min-width: 0;
}
.workspace-files {
  border-right: 1px solid #dfe5d8;
}
.workspace-field {
  display: grid;
  gap: 0.6rem;
  margin: 1rem 0;
  font-size: 1rem;
}
.workspace-field input,
.workspace-field select {
  width: 100%;
  font: inherit;
  min-height: 44px;
}
.workspace-plan {
  line-height: 1.8;
}
.workspace-confirm {
  justify-content: flex-end;
  margin-top: 1.5rem;
}
.workspace-retired-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid #dfe5d8;
  padding: 1rem 0;
  overflow-wrap: anywhere;
}
.workspace-retired-entry > div {
  min-width: 0;
}
.workspace-retired-entry strong {
  white-space: pre-wrap;
}
.workspace-retired-entry p {
  font-size: 0.94rem;
}
.workspace-files input {
  width: 100%;
  margin: 0.6rem 0;
}
.workspace-file {
  display: grid;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
  overflow-wrap: anywhere;
  padding: 0.9rem;
  margin: 0.4rem 0;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.workspace-file.selected {
  background: #f3f6ef;
  border-color: #dfe5d8;
}
.workspace-file strong {
  font-weight: 500;
}
.workspace-file-status,
.form-note {
  font-size: 0.94rem;
  color: #67765e;
}
.workspace-versions {
  margin: 0.8rem 0 1.2rem;
}
.workspace-versions .selected {
  background: #edf2e7;
  border-color: #9aad8b;
}
.workspace-raw {
  font: 1rem/1.75 monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-align: left;
  margin: 0;
  min-width: 0;
  tab-size: 2;
}
.workspace-recent-entry {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  border: 0;
  background: none;
  padding: 0.8rem 0;
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  width: 100%;
  cursor: pointer;
}
@media (max-width: 1000px) {
  .workspace-inspector {
    grid-template-columns: 1fr;
  }
  .workspace-files {
    border-right: 0;
    border-bottom: 1px solid #dfe5d8;
  }
  .workspace-active {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
