<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { FolderOpen, FolderPlus, RefreshCw, X } from '@lucide/vue'
import { t } from '../i18n'
import { createWorkspacePreview, workspacePreviewMessage } from './workspace-preview'
import type { ChangeStatus } from '../workspace/changes'
const preview = createWorkspacePreview()
const { status, scan, files, busy, error } = preview
const selected = ref(''),
  query = ref(''),
  showAccepted = ref(false)
const filtered = computed(() =>
  files.value.filter((file) =>
    file.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()),
  ),
)
const current = computed(() => files.value.find((file) => file.path === selected.value))
const page = ref(1)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 50)))
const visibleFiles = computed(() => filtered.value.slice((page.value - 1) * 50, page.value * 50))
watch(query, () => {
  page.value = 1
})
watch(files, () => {
  page.value = 1
})
const accepted = computed(
  () =>
    scan.value?.accepted.find(
      (file) => current.value?.identity?.kind === 'note' && file.id === current.value.identity.id,
    ) ?? scan.value?.accepted.find((file) => file.path === current.value?.path),
)
const observed = computed(() =>
  scan.value?.observations.find((file) => file.path === selected.value),
)
const raw = computed(() => (showAccepted.value ? accepted.value?.raw : observed.value?.raw) ?? '')
const label: Record<ChangeStatus, string> = {
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
watch(files, () => {
  if (!files.value.some((file) => file.path === selected.value))
    selected.value = files.value[0]?.path ?? ''
})
watch(selected, () => {
  showAccepted.value = !observed.value?.raw && Boolean(accepted.value)
})
watch(
  () => status.value?.active?.token,
  () => {
    selected.value = ''
    query.value = ''
    showAccepted.value = false
  },
)
function reason(reason?: string) {
  if (!reason) return ''
  if (reason === 'duplicate-id') return '多个文件使用了同一个身份。请保留各份内容，检查后再处理。'
  if (reason === 'duplicate-path') return '文件名存在大小写或 Unicode 冲突。请分别保留并检查。'
  if (reason === 'registered-identity-changed' || reason === 'registered-identity-removed')
    return '这个位置的笔记身份已变化。原已接受版本仍保留。'
  if (reason === 'confirm-stable-deletion') return '工作文件暂时缺失，已接受的正文仍保留。'
  if (reason === 'unreadable-file') return workspacePreviewMessage(observed.value?.error ?? '')
  return '文件内容尚未通过校验。请检查元数据、题面与答案分隔，再重新扫描。'
}
onMounted(() => {
  void preview.refresh()
})
onUnmounted(preview.dispose)
</script>
<template>
  <div class="page workspace-preview" :aria-busy="busy">
    <header class="page-heading">
      <div>
        <h1>
          {{ t('工作目录') }} <span class="pill">{{ t('预览') }}</span>
        </h1>
        <p>{{ t('浏览目录中的 Markdown 与已接受版本。') }}</p>
      </div>
      <div class="workspace-actions">
        <button class="button" :disabled="busy || !status" @click="preview.choose('open')">
          <FolderOpen :size="18" />{{ t('打开目录') }}
        </button>
        <button
          class="button primary"
          :disabled="busy || !status"
          @click="preview.choose('create')"
        >
          <FolderPlus :size="18" />{{ t('创建预览目录') }}
        </button>
      </div>
    </header>
    <p class="workspace-scope-note">
      {{ t('预览目录独立于当前学习库，暂不用于复习或旧库迁移。') }}
    </p>
    <div v-if="error || status?.restore_error" class="workspace-error" role="alert">
      <p>{{ t(workspacePreviewMessage(error || status?.restore_error || '')) }}</p>
      <button class="button" :disabled="busy" @click="preview.refresh()">{{ t('重试') }}</button>
    </div>
    <div v-if="busy" role="status" class="form-note">{{ t('正在读取工作目录…') }}</div>
    <section v-if="status?.active" class="workspace-current" :aria-label="t('当前预览目录')">
      <div>
        <strong>{{ t('当前预览目录') }}</strong>
        <p class="workspace-path">{{ status.active.path }}</p>
      </div>
      <div class="workspace-actions">
        <button class="button" :disabled="busy" @click="preview.refresh()">
          <RefreshCw :size="17" />{{ t('重新扫描') }}
        </button>
        <button class="button" :disabled="busy" @click="preview.close()">
          <X :size="17" />{{ t('关闭目录') }}
        </button>
      </div>
    </section>
    <p v-if="scan && !scan.complete" class="workspace-error" role="alert">
      {{ t('扫描未完成。缺失文件不会据此认定为已删除。') }}
    </p>
    <section v-if="scan" class="workspace-files" :aria-label="t('目录文件')">
      <div class="workspace-list">
        <label class="form-field"
          >{{ t('查找文件') }}<input v-model="query" type="search" :placeholder="t('文件路径')"
        /></label>
        <p class="form-note">{{ t('文件：{p0}', { p0: filtered.length }) }}</p>
        <nav :aria-label="t('目录文件')">
          <button
            v-for="file in visibleFiles"
            :key="file.path"
            class="workspace-file"
            :class="{ selected: selected === file.path }"
            :aria-current="selected === file.path ? 'true' : undefined"
            @click="selected = file.path"
          >
            <span>{{ file.path }}</span
            ><span class="workspace-file-status" :data-status="file.status">{{
              t(label[file.status])
            }}</span>
          </button>
        </nav>
        <div v-if="pages > 1" class="workspace-pagination" :aria-label="t('文件分页')">
          <button class="button" :disabled="page === 1" @click="page--">{{ t('上一页') }}</button>
          <span>{{ t('第 {page} 页，共 {pages} 页', { page, pages }) }}</span>
          <button class="button" :disabled="page === pages" @click="page++">
            {{ t('下一页') }}
          </button>
        </div>
        <p v-if="!filtered.length" class="form-note">
          {{ t(query ? '没有匹配的文件。' : '目录中还没有 Markdown 文件。') }}
        </p>
      </div>
      <div class="workspace-document">
        <template v-if="current">
          <h2>{{ current.path }}</h2>
          <p v-if="current.reason" class="workspace-diagnostic">{{ t(reason(current.reason)) }}</p>
          <div class="workspace-actions" :aria-label="t('文件版本')">
            <button
              class="button"
              :aria-pressed="!showAccepted"
              :disabled="observed?.raw === undefined"
              @click="showAccepted = false"
            >
              {{ t('文件原文') }}
            </button>
            <button
              v-if="accepted"
              class="button"
              :aria-pressed="showAccepted"
              @click="showAccepted = true"
            >
              {{ t('已接受版本') }}
            </button>
          </div>
          <pre v-if="raw" class="workspace-raw" tabindex="0">{{ raw }}</pre>
          <p v-else class="form-note">
            {{ t(observed?.raw === '' ? '文件内容为空。' : '没有可预览的正文。') }}
          </p>
        </template>
        <p v-else class="form-note">{{ t('选择文件查看原文。预览不会执行 HTML 或插件。') }}</p>
      </div>
    </section>
    <section v-if="status?.recent.length" class="workspace-recent" :aria-label="t('最近打开')">
      <h2>{{ t('最近打开') }}</h2>
      <button
        v-for="entry in status.recent"
        :key="entry.path"
        class="workspace-recent-entry"
        :disabled="busy || status.active?.path === entry.path"
        @click="preview.recent(entry.path, entry.id)"
      >
        <FolderOpen :size="18" /><span>{{ entry.path }}</span>
      </button>
    </section>
  </div>
</template>
<style scoped>
.workspace-preview {
  max-width: 1400px;
}
.workspace-preview > .page-heading {
  flex-direction: column;
  align-items: flex-start;
  gap: 1.25rem;
}
.workspace-preview h1 .pill {
  vertical-align: middle;
  font-size: 0.85rem;
}
.workspace-preview h2 {
  font-size: 1.1rem;
  overflow-wrap: anywhere;
}
.workspace-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}
.workspace-scope-note {
  color: var(--muted);
  line-height: 1.65;
  font-size: 1rem;
}
.workspace-current {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  margin: 1.5rem 0;
}
.workspace-path {
  overflow-wrap: anywhere;
  margin: 0.5rem 0 0;
}
.workspace-error {
  padding: 1rem 1.25rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  line-height: 1.65;
}
.workspace-error p {
  margin-top: 0;
}
.workspace-files {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 2fr);
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  overflow: hidden;
}
.workspace-list {
  padding: 1.25rem;
  border-right: 1px solid var(--line);
  min-width: 0;
}
.workspace-list nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 65vh;
  overflow: auto;
}
.workspace-file {
  display: flex;
  flex-direction: column;
  text-align: left;
  gap: 0.4rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0.8rem;
  color: #293d33;
  font: inherit;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.workspace-file:hover,
.workspace-file.selected {
  background: #f7f9f5;
  border-color: var(--line);
}
.workspace-file-status {
  font-size: 0.9rem;
  color: var(--muted);
}
.workspace-file-status[data-status='conflict'],
.workspace-file-status[data-status='pending'],
.workspace-file-status[data-status='missing'] {
  color: #9b4938;
}
.workspace-document {
  padding: 1.5rem;
  min-width: 0;
}
.workspace-document h2 {
  margin-top: 0;
}
.workspace-document .workspace-actions {
  display: inline-flex;
  gap: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.25rem;
  background: #f5f7f2;
}
.workspace-document .workspace-actions .button {
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
}
.workspace-document .workspace-actions [aria-pressed='true'] {
  background: var(--paper);
  border-color: var(--line);
  color: var(--green);
  box-shadow: 0 1px 2px #293d3310;
}
.workspace-pagination {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-top: 1rem;
  font-size: var(--text-sm);
}
.workspace-diagnostic {
  line-height: 1.65;
}
.workspace-raw {
  font:
    1rem/1.7 ui-monospace,
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 65vh;
  overflow: auto;
  margin: 1.25rem 0 0;
}
.workspace-actions [aria-pressed='true'] {
  border-color: var(--green);
}
.workspace-recent {
  margin-top: 2rem;
}
.workspace-recent-entry {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  background: var(--paper);
  color: #293d33;
  border: 1px solid var(--line);
  border-radius: 8px;
  font: inherit;
  padding: 1rem;
  text-align: left;
  width: 100%;
  margin: 0.5rem 0;
  cursor: pointer;
}
.workspace-recent-entry span {
  overflow-wrap: anywhere;
}
.workspace-recent-entry:disabled {
  cursor: default;
  opacity: 0.65;
}
@media (max-width: 900px) {
  .workspace-files {
    grid-template-columns: 1fr;
  }
  .workspace-list {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .workspace-list nav {
    max-height: 30vh;
  }
  .workspace-current {
    flex-direction: column;
  }
}
</style>
