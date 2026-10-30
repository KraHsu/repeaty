<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { ArchiveRestore, Archive, FolderOpen, Search, Settings2, RefreshCw } from '@lucide/vue'
import AppModal from '../components/AppModal.vue'
import { UiButton, UiInput, UiCheckbox, SettingField } from '../components/ui'
import { locale, t } from '../i18n'
import { currentWorkspace, nativeError, recentWorkspace, workspaceStatus } from './workspaces'
import { displayFilesystemPath } from './display-path'
import {
  createWorkspaceBackups,
  automaticBackupReport,
  type BackupEntry,
  type BackupHit,
  type BackupReport,
  type BackupPolicy,
} from './workspace-backups'
import WorkspaceAttachments from './WorkspaceAttachments.vue'

const props = withDefaults(defineProps<{ standalone?: boolean }>(), { standalone: false })
let client: ReturnType<typeof createWorkspaceBackups> | undefined
let alive = true
let initialEpoch: string | undefined
const token = ref(''),
  busy = ref(false),
  error = ref(''),
  message = ref(''),
  job = ref<string>()
const config =
  shallowRef<Awaited<ReturnType<ReturnType<typeof createWorkspaceBackups>['configuration']>>>()
const policy = ref<BackupPolicy>(),
  entries = shallowRef<BackupEntry[]>([]),
  reports = shallowRef<BackupReport[]>([])
const policyDirty = computed(
  () => !!policy.value && JSON.stringify(policy.value) !== JSON.stringify(config.value?.policy),
)
const searched = ref(false)
const preview = shallowRef<BackupEntry>(),
  hits = shallowRef<BackupHit[]>([]),
  query = ref(''),
  selected = ref<string[]>([])
const restored = shallowRef<{ path: string; id?: string }>(),
  page = ref(1)
const diagnostics =
  shallowRef<Awaited<ReturnType<ReturnType<typeof createWorkspaceBackups>['maintenance']>>>()
const auto = computed(() =>
  automaticBackupReport.value?.token === token.value ? automaticBackupReport.value : undefined,
)
const errors = computed(() =>
  [...reports.value, ...(auto.value?.reports ?? [])].filter((report) => report.error),
)
const visible = computed(() => entries.value.slice(0, page.value * 12))
const date = (value: string) => new Date(value).toLocaleString(locale.value)
const bytes = (value: number) =>
  new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value / 1024 / 1024) +
  ' MB'
async function act(action: () => Promise<void>) {
  if (!alive || busy.value || !client) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await action()
  } catch (issue) {
    if (alive) error.value = t(issue instanceof Error ? issue : String(issue))
  } finally {
    if (alive) busy.value = false
  }
}
async function refresh() {
  const keepDraft = policyDirty.value
  const [configuration, list] = await Promise.all([client!.configuration(), client!.list()])
  if (!alive) return
  config.value = configuration
  if (!keepDraft) policy.value = { ...configuration.policy }
  entries.value = list.entries
  reports.value = list.errors
}
onMounted(async () => {
  try {
    if (props.standalone) {
      initialEpoch = workspaceStatus.value?.epoch
      client = createWorkspaceBackups('')
      return
    }
    const active = await currentWorkspace()
    if (!alive) return
    initialEpoch = workspaceStatus.value?.epoch
    token.value = active.token
    client = createWorkspaceBackups(active.token)
    await act(refresh)
  } catch (issue) {
    if (alive) error.value = t(issue instanceof Error ? issue : String(issue))
  }
})
onScopeDispose(() => {
  alive = false
  if (job.value) void client?.cancel(job.value).catch(() => {})
})
watch(
  () => [workspaceStatus.value?.active?.token, workspaceStatus.value?.epoch] as const,
  ([current, epoch]) => {
    if (
      client &&
      (props.standalone ? !!current || epoch !== initialEpoch : current !== token.value)
    ) {
      alive = false
      if (job.value) void client?.cancel(job.value).catch(() => {})
      preview.value = undefined
      entries.value = []
      config.value = undefined
      busy.value = false
      error.value = t(nativeError('stale-workspace-session'))
    }
  },
  { flush: 'sync' },
)
async function chooseTarget(slot: number, clear = false) {
  await act(async () => {
    const value = await client!.target(slot, clear)
    if (value && alive) {
      config.value = value
      await refresh()
    }
  })
}
async function backup() {
  await act(async () => {
    job.value = crypto.randomUUID()
    try {
      const result = await client!.run(job.value)
      await refresh()
      if (alive) {
        reports.value = result
        if (automaticBackupReport.value?.token === token.value)
          automaticBackupReport.value = undefined
        if (result.some((report) => report.backup)) message.value = t('完整备份已写入并通过校验。')
      }
    } finally {
      job.value = undefined
    }
  })
}
async function inspect(key?: string) {
  await act(async () => {
    job.value = crypto.randomUUID()
    try {
      const value = await client!.inspect(key, job.value)
      if (value && alive) {
        if (!value.summary.verified) throw new Error(t('备份损坏或校验不一致，未恢复任何内容。'))
        preview.value = value
        query.value = ''
        selected.value = []
        hits.value = []
        searched.value = false
        restored.value = undefined
      }
    } finally {
      job.value = undefined
    }
  })
}
async function search() {
  await act(async () => {
    job.value = crypto.randomUUID()
    try {
      const value = await client!.search(preview.value!.key, query.value, job.value)
      if (alive) {
        hits.value = value
        searched.value = true
        selected.value = []
      }
    } finally {
      job.value = undefined
    }
  })
}
async function restore(onlySelected: boolean) {
  await act(async () => {
    job.value = crypto.randomUUID()
    try {
      const result = await client!.restore(
        preview.value!.key,
        job.value,
        onlySelected ? selected.value : undefined,
      )
      if (result && alive) {
        const value = result.result as { newWorkspaceId?: string; restoredPath?: string }
        restored.value = { path: value?.restoredPath ?? result.path, id: value?.newWorkspaceId }
        message.value = t(
          onlySelected
            ? '所选内容已恢复为文件副本，可重新导入；当前学习库保持不变。'
            : '已恢复到新工作目录，当前学习库保持不变。',
        )
      }
    } finally {
      job.value = undefined
    }
  })
}
function toggle(path: string, checked: boolean | 'indeterminate') {
  selected.value =
    checked === true
      ? [...new Set([...selected.value, path])]
      : selected.value.filter((item) => item !== path)
}
const countLabels: Record<string, string> = {
  decks: '卡组',
  notes: '笔记',
  cards: '卡片',
  reviews: '复习记录',
  sources: '学习材料',
  attempts: '练习记录',
  card_drafts: '制卡草稿',
  source_drafts: '材料草稿',
  materialFolders: '材料文件夹',
  materialCollections: '材料集合',
  retired_notes: '退役笔记',
  retired_cards: '退役卡片',
  retired_records: '退役记录',
  media: '学习附件',
  assets: '附件对象',
  savedSearches: '常用筛选',
  practices: '练习记录',
  materialReceipts: '材料导入记录',
  automationReceipts: '自动化操作记录',
  studySettings: '学习设置',
  studyEvents: '学习活动',
  studyActivity: '活跃使用时间',
  fsrsModels: '个人记忆参数',
  values_store: '设置与插件数据',
}
const previewCounts = computed(() => {
  const counts = preview.value?.summary.counts ?? {}
  return Object.fromEntries(
    ['notes', 'cards', 'sources', 'reviews', 'retired_notes', 'card_drafts'].map((key) => [
      key,
      counts[key] ?? 0,
    ]),
  )
})
const savePolicy = () =>
  act(async () => {
    const value = await client!.policy(policy.value!)
    if (alive) {
      config.value = value
      message.value = t('备份规则已保存。')
    }
  })
const maintain = (vacuum = false) =>
  act(async () => {
    const value = await client!.maintenance(vacuum)
    if (alive) diagnostics.value = value
  })
</script>
<template>
  <section class="recovery-section" :aria-label="t('完整工作目录备份')" :aria-busy="busy">
    <div class="section-heading recovery-heading">
      <div>
        <h2><Archive :size="21" />{{ t(standalone ? '恢复为新工作目录' : '完整工作目录备份') }}</h2>
        <p class="form-note">
          {{ t('包含退役内容、草稿、材料版本、附件和插件。设备凭据与代码信任留在本机。') }}
        </p>
      </div>
      <div class="backup-actions">
        <UiButton
          :variant="standalone ? 'primary' : 'secondary'"
          :disabled="busy || !alive"
          @click="inspect()"
          ><ArchiveRestore :size="16" />{{ t('打开完整备份') }}</UiButton
        ><UiButton
          v-if="!standalone"
          variant="primary"
          :disabled="busy || !config?.targets.length"
          @click="backup"
          ><Archive :size="16" />{{ t('立即备份') }}</UiButton
        >
      </div>
    </div>
    <p v-if="error" role="alert" class="import-warning">{{ error }}</p>
    <p v-if="message && !preview" role="status">{{ message }}</p>
    <div v-if="busy" class="recovery-progress" role="status">
      <span>{{ t('正在读取或校验备份…') }}</span
      ><UiButton v-if="job" variant="secondary" @click="client?.cancel(job)">{{
        t('取消')
      }}</UiButton>
    </div>
    <template v-if="!standalone">
      <p v-if="auto?.error" role="alert" class="import-warning">{{ t(auto.error) }}</p>
      <p v-for="(report, index) in errors" :key="index" class="import-warning" role="alert">
        {{ displayFilesystemPath(report.target) }} · {{ t(nativeError(report.error)) }}
      </p>
      <div v-if="config && !config.targets.length" class="recovery-empty">
        <p>{{ t('选择独立目录保存完整备份。使用另一块磁盘可减少设备故障造成的损失。') }}</p>
        <UiButton variant="secondary" :disabled="busy" @click="chooseTarget(0)"
          ><FolderOpen :size="16" />{{ t('选择备份目录') }}</UiButton
        >
      </div>
      <details v-if="config" class="recovery-policy" :open="!config.targets.length">
        <summary>
          <Settings2 :size="17" />{{ t('备份位置与保留规则')
          }}<span>{{ t(config.policy.enabled ? '自动备份已开启' : '自动备份未开启') }}</span>
        </summary>
        <div class="recovery-policy-content">
          <ul class="recovery-targets">
            <li v-for="(target, index) in config.targets" :key="target">
              <div>
                <strong>{{ t(index === 0 ? '备份目录' : '额外副本') }}</strong
                ><span class="recovery-path">{{ displayFilesystemPath(target) }}</span>
              </div>
              <UiButton variant="ghost" :disabled="busy" @click="chooseTarget(index)">{{
                t('更换')
              }}</UiButton
              ><UiButton variant="ghost" :disabled="busy" @click="chooseTarget(index, true)">{{
                t('移除位置')
              }}</UiButton>
            </li>
          </ul>
          <UiButton
            v-if="config.targets.length === 1"
            variant="secondary"
            :disabled="busy"
            @click="chooseTarget(1)"
            >{{ t('添加额外副本位置') }}</UiButton
          >
          <template v-if="policy">
            <SettingField
              v-model="policy.enabled"
              type="switch"
              :label="t('应用运行时自动备份')"
              :disabled="busy || !config.targets.length"
            />
            <div class="recovery-policy-fields">
              <SettingField
                v-model="policy.intervalMinutes"
                type="number"
                :min="15"
                :max="10080"
                :label="t('间隔（分钟）')"
                layout="stack"
                :disabled="busy"
              /><SettingField
                v-for="[key, label] in [
                  ['hourly', '小时'],
                  ['daily', '天'],
                  ['weekly', '周'],
                  ['monthly', '月'],
                ] as const"
                :key="key"
                v-model="policy[key]"
                type="number"
                :min="0"
                :max="1000"
                :label="t('保留最近 {unit}数', { unit: t(label) })"
                layout="stack"
                :disabled="busy"
              />
            </div>
            <p class="form-note">
              {{
                t(
                  '每个时间段保留最新一份，按 UTC 分组，始终保留最新备份。新备份校验成功后才清理旧备份；移除位置不会删除文件。',
                )
              }}
            </p>
            <p v-if="policyDirty" class="form-note">
              {{ t('规则有未保存的更改；立即备份仍使用已保存的规则。') }}
            </p>
            <UiButton variant="secondary" :disabled="busy || !policyDirty" @click="savePolicy">{{
              t('保存规则')
            }}</UiButton>
          </template>
        </div>
      </details>
      <div class="recovery-list-heading">
        <h3>{{ t('可恢复的备份') }}</h3>
        <UiButton variant="ghost" :disabled="busy" @click="act(refresh)"
          ><RefreshCw :size="15" />{{ t('刷新') }}</UiButton
        >
      </div>
      <ul v-if="entries.length" class="snapshot-list recovery-list">
        <li v-for="entry in visible" :key="entry.key">
          <div>
            <strong>{{ date(entry.summary.createdAt) }}</strong
            ><span
              >{{ entry.summary.fileCount }} {{ t('个文件') }} ·
              {{ bytes(entry.summary.totalBytes) }}</span
            ><span class="recovery-path">{{
              displayFilesystemPath(entry.summary.archivePath)
            }}</span>
          </div>
          <UiButton variant="secondary" :disabled="busy" @click="inspect(entry.key)">{{
            t('预览与恢复')
          }}</UiButton>
        </li>
      </ul>
      <p v-else class="form-note">
        {{ t('此位置还没有完整备份。也可打开其他设备保存的 .repeaty-workspace 文件。') }}
      </p>
      <UiButton v-if="visible.length < entries.length" variant="ghost" @click="page++">{{
        t('显示更多')
      }}</UiButton>
      <details class="recovery-maintenance">
        <summary>{{ t('数据库检查与空间整理') }}</summary>
        <p class="form-note">
          {{ t('检查数据库完整性；整理只回收数据库空闲页，不删除学习内容。操作期间写入会等待。') }}
        </p>
        <div class="backup-actions">
          <UiButton variant="secondary" :disabled="busy" @click="maintain()">{{
            t('检查数据库')
          }}</UiButton
          ><UiButton
            variant="ghost"
            :disabled="busy || diagnostics?.integrity !== 'ok'"
            @click="maintain(true)"
            >{{ t('整理空间') }}</UiButton
          >
        </div>
        <p v-if="diagnostics" role="status">
          {{ diagnostics.integrity }} · {{ t('数据库') }} {{ bytes(diagnostics.databaseBytes) }} ·
          {{ t('可回收') }} {{ bytes(diagnostics.reclaimableBytes) }}
        </p>
      </details>
    </template>
  </section>
  <WorkspaceAttachments v-if="!standalone" />
  <AppModal
    v-if="preview"
    :title="t('预览完整备份')"
    wide
    :busy="busy"
    :error="error"
    @close="preview = undefined"
  >
    <div class="recovery-preview">
      <p>
        <strong>{{ date(preview.summary.createdAt) }}</strong> · {{ t('校验通过') }} ·
        {{ bytes(preview.summary.totalBytes) }}
      </p>
      <p class="form-note recovery-path">
        {{ displayFilesystemPath(preview.summary.archivePath) }}
      </p>
      <dl class="recovery-counts">
        <div v-for="(count, key) in previewCounts" :key="key">
          <dt>{{ t(countLabels[key] ?? key) }}</dt>
          <dd>{{ count }}</dd>
        </div>
      </dl>
      <p class="form-note">
        {{
          t(
            '恢复会在所选位置创建新目录，不覆盖当前库。完整恢复保留记录与调度，插件需在本设备重新信任。',
          )
        }}
      </p>
      <form class="recovery-search" @submit.prevent="search">
        <UiInput
          v-model="query"
          icon="i-lucide-search"
          :placeholder="t('搜索备份中的标题或正文')"
          :aria-label="t('搜索备份中的标题或正文')"
          maxlength="200"
          :disabled="busy"
        /><UiButton type="submit" variant="secondary" :disabled="busy"
          ><Search :size="16" />{{ t('搜索') }}</UiButton
        >
      </form>
      <ul v-if="hits.length" class="recovery-hits">
        <li v-for="(hit, index) in hits" :key="hit.restoreKey ?? `${hit.store}:${hit.id}:${index}`">
          <UiCheckbox
            v-if="hit.restoreKey"
            :model-value="selected.includes(hit.restoreKey)"
            :aria-label="t('选择 {title}', { title: hit.title })"
            :disabled="busy"
            @update:model-value="toggle(hit.restoreKey!, $event)"
          />
          <div>
            <strong>{{ hit.title }}</strong
            ><span v-if="hit.retired" class="pill">{{ t('已退役') }}</span>
            <span v-if="hit.store.startsWith('history.')" class="pill">{{
              t('快照中的历史版本')
            }}</span>
            <p>{{ hit.excerpt }}</p>
          </div>
        </li>
      </ul>
      <p v-if="searched && !hits.length" class="form-note" role="status">
        {{ t('此备份中没有匹配的内容。') }}
      </p>
      <p v-if="hits.length === 100" class="form-note">{{ t('显示前 100 项，请缩小搜索范围。') }}</p>
      <p v-if="selected.length" class="form-note">
        {{ t('所选内容恢复为可导入的文件副本及附件，不合并当前库的调度或历史。') }}
      </p>
      <div v-if="restored" class="recovery-result" role="status">
        <p>{{ message }}</p>
        <p class="recovery-path">{{ displayFilesystemPath(restored.path) }}</p>
        <UiButton
          v-if="restored.id"
          variant="secondary"
          :disabled="busy"
          @click="act(() => recentWorkspace(restored!.path, restored!.id!))"
          >{{ t('打开恢复的工作目录') }}</UiButton
        >
      </div>
    </div>
    <template #footer>
      <div class="recovery-footer">
        <UiButton variant="secondary" :disabled="busy || !selected.length" @click="restore(true)">{{
          t('恢复所选文件副本')
        }}</UiButton
        ><UiButton variant="primary" :disabled="busy" @click="restore(false)">{{
          t('恢复为新工作目录')
        }}</UiButton
        ><UiButton v-if="job" variant="ghost" @click="client?.cancel(job)">{{
          t('取消')
        }}</UiButton>
      </div>
    </template>
  </AppModal>
</template>
<style scoped>
.recovery-section {
  padding-block: 24px 28px;
  border-bottom: 1px solid var(--line);
}
.recovery-heading {
  align-items: flex-start;
  gap: 24px;
}
.recovery-heading h2 {
  display: flex;
  align-items: center;
  gap: 10px;
}
.recovery-heading .form-note {
  margin-top: 8px;
  max-width: 65ch;
}
.recovery-empty {
  padding: 24px 0;
}
.recovery-empty p {
  margin-bottom: 14px;
  max-width: 65ch;
}
.recovery-policy {
  margin-block: 20px;
  border-block: 1px solid var(--line);
}
summary {
  cursor: pointer;
  min-height: 48px;
  align-items: center;
  padding-block: 14px;
}
.recovery-policy summary {
  display: flex;
  gap: 10px;
}
.recovery-policy summary span {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.recovery-policy-content {
  padding: 4px 0 24px;
}
.recovery-targets {
  list-style: none;
  padding: 0;
}
.recovery-targets li {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-block: 12px;
}
.recovery-targets li > div {
  flex: 1;
  min-width: 0;
}
.recovery-path {
  display: block;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.recovery-policy-fields {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 18px;
  margin-block: 12px;
}
.recovery-list-heading,
.recovery-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.recovery-list-heading {
  margin-top: 20px;
}
.recovery-list li > div {
  min-width: 0;
}
.recovery-list li > button,
.recovery-targets li > button {
  flex-shrink: 0;
  white-space: nowrap;
}
.recovery-maintenance {
  margin-top: 24px;
}
.recovery-maintenance p {
  margin-block: 12px;
}
.recovery-preview {
  display: grid;
  gap: 20px;
}
.recovery-preview p {
  margin: 0;
}
.recovery-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 30px;
  margin: 0;
}
.recovery-counts dt {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.recovery-counts dd {
  margin: 4px 0 0;
  font-variant-numeric: tabular-nums;
}
.recovery-search {
  display: flex;
  gap: 12px;
}
.recovery-search > :first-child {
  flex: 1;
  min-width: 0;
}
.recovery-hits {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 38vh;
  overflow: auto;
}
.recovery-hits li {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.recovery-hits li > div {
  min-width: 0;
}
.recovery-hits p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--muted);
  margin-top: 6px;
}
.recovery-hits .pill {
  margin-left: 8px;
}
.recovery-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}
.recovery-result {
  border-left: 3px solid var(--ui-primary);
  padding-left: 16px;
  display: grid;
  gap: 12px;
}
@media (max-width: 850px) {
  .recovery-heading {
    flex-direction: column;
  }
  .recovery-policy-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .recovery-targets li {
    flex-wrap: wrap;
  }
  .recovery-targets li > div {
    flex-basis: 100%;
  }
  .recovery-policy summary {
    flex-wrap: wrap;
  }
  .recovery-policy summary span {
    margin-left: 0;
  }
  .recovery-search {
    flex-wrap: wrap;
  }
}
</style>
