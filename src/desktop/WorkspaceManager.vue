<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { FolderOpen, FolderPlus, RefreshCw, X, Check } from '@lucide/vue'
import { t, type DisplayMessage } from '../i18n'
import type { useLibrary } from '../composables/useLibrary'
import type { ChangeStatus, FileChange } from '../workspace/changes'
import { previewScanSchema } from '../workspace/preview'
import { createInspector } from './workspace-inspector'
import { z } from 'zod'
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
const inspector = createInspector()
const busy = ref(false),
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
})
const scan = ref<z.infer<typeof scanSchema>>()
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
  const active = status.value?.active
  if (!active) return
  const value = scanSchema.parse(
    await workspaceApi('workspace_read', { token: active.token, request: { type: 'scan' } }),
  )
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
  files.value = changes
  workspaceAttention.value = value.attention
  if (!changes.some((file) => file.path === selected.value)) selected.value = changes[0]?.path ?? ''
  page.value = 1
}
const canAccept = computed(
  () =>
    current.value?.identity?.kind === 'note' &&
    ['modified', 'renamed', 'renamed-modified'].includes(current.value.status) &&
    !!accepted.value &&
    !!current.value.document,
)
async function accept() {
  const file = current.value,
    doc = file?.document,
    previous = accepted.value,
    working = observed.value
  if (!file || !doc || !previous || !working || doc.content.kind !== 'note') return
  const before = props.workspace.library.value.notes.find((note) => note.id === doc.identity.id)
  if (!before) throw nativeError('not-found')
  const variants = props.workspace.library.value.cards
    .filter((card) => card.noteId === before.id)
    .map((card) => card.variant)
    .sort()
  if (JSON.stringify(variants) !== JSON.stringify([...doc.variants].sort()))
    throw new Error(t('卡片方向或挖空编号已变化，请在应用内编辑确认。'))
  await props.workspace.acceptExternalNote(
    before.id,
    {
      ...before,
      deckId: doc.header.deckId!,
      type: doc.header.type!,
      format: doc.header.format,
      plugin: doc.header.plugin,
      front: doc.content.front,
      back: doc.content.back,
      tags: Array.isArray(doc.properties.tags) ? (doc.properties.tags as string[]) : before.tags,
      frontMedia: doc.header.frontMedia?.map((media) => media.id) ?? [],
      backMedia: doc.header.backMedia?.map((media) => media.id) ?? [],
    },
    {
      kind: 'note',
      id: before.id,
      path: file.path,
      raw: working.raw,
      expectedHash: previous.hash,
      workingHash: working.hash,
    },
  )
  await refresh()
}
onMounted(async () => {
  try {
    await initializeWorkspaces()
    await loadWorkspaceStatus()
    await run(refresh)
  } catch (issue) {
    error.value = issue as Error
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
          ><button v-if="canAccept" class="button primary" :disabled="locked" @click="run(accept)">
            <Check :size="18" />{{ t('接受修改') }}
          </button>
        </div>
        <p v-if="current?.reason" class="form-note">{{ current.reason }}</p>
        <p
          v-if="current?.identity?.kind === 'source' && current.status !== 'unchanged'"
          class="form-note"
        >
          {{ t('材料快照的外部修改暂不自动接受，原有摘录与出处保持不变。') }}
        </p>
        <pre class="workspace-raw">{{ raw }}</pre>
      </div>
    </section>
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
