<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { ArchiveRestore, RefreshCw, Trash2, Paperclip } from '@lucide/vue'
import { UiButton, UiCheckbox, UiInput, UiSelect } from '../components/ui'
import AppModal from '../components/AppModal.vue'
import { locale, t } from '../i18n'
import { workspaceStatus } from './workspaces'
import {
  canManageAttachment,
  createAttachmentClient,
  filterAttachments,
  type AttachmentAction,
  type AttachmentInventory,
} from './attachments'

const client = createAttachmentClient()
const inventory = shallowRef<AttachmentInventory>()
const busy = ref(false),
  error = ref(''),
  query = ref(''),
  state = ref(''),
  page = ref(1)
const selected = ref<string[]>([]),
  pending = ref<AttachmentAction>()
const states = computed(() => [
  { value: '', label: t('全部附件') },
  { value: 'unused', label: t('未引用') },
  { value: 'referenced', label: t('使用中') },
  { value: 'trash', label: t('回收站') },
  { value: 'external', label: t('外部文件') },
])
const filtered = computed(() =>
  filterAttachments(inventory.value?.entries ?? [], query.value, state.value),
)
const visible = computed(() => filtered.value.slice((page.value - 1) * 25, page.value * 25))
const actions = computed(() => ({
  trash: t('移入回收站'),
  restore: t('恢复附件'),
  purge: t('永久删除'),
}))
const selectedEntries = computed(
  () => inventory.value?.entries.filter((entry) => selected.value.includes(entry.id)) ?? [],
)
const can = (action: AttachmentAction) =>
  !!selectedEntries.value.length &&
  selectedEntries.value.every((entry) => canManageAttachment(entry, action))
function bytes(value: number) {
  return (
    new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value / 1024 / 1024) +
    ' MB'
  )
}
function refLabel(key: string) {
  return (
    (
      {
        active: t('当前内容'),
        history: t('历史快照'),
        retired: t('退役内容'),
        drafts: t('草稿'),
        undo: t('撤销历史'),
        plugins: t('插件和设置'),
        working: t('目录文件'),
        unknownPlugin: t('插件保留'),
      } as Record<string, string>
    )[key] ?? key
  )
}
let operation = 0
async function load() {
  const ticket = ++operation
  busy.value = true
  error.value = ''
  pending.value = undefined
  try {
    const result = await client.load()
    if (ticket === operation) {
      inventory.value = result
      selected.value = []
      page.value = 1
    }
  } catch (issue) {
    if (ticket === operation && !(issue instanceof DOMException && issue.name === 'AbortError'))
      error.value = t(issue instanceof Error ? issue : String(issue))
  } finally {
    if (ticket === operation) busy.value = false
  }
}
function cancel() {
  operation++
  client.cancel()
  busy.value = false
}
function toggle(id: string, checked: boolean | 'indeterminate') {
  selected.value =
    checked === true
      ? [...selected.value.filter((v) => v !== id), id]
      : selected.value.filter((v) => v !== id)
}
async function apply() {
  const view = inventory.value,
    action = pending.value
  if (!view || !action || !can(action)) return
  const ticket = ++operation
  busy.value = true
  error.value = ''
  try {
    const result = await client.mutate(view, action, [...selected.value])
    if (ticket === operation) {
      inventory.value = result
      pending.value = undefined
      selected.value = []
    }
  } catch (issue) {
    if (ticket === operation) {
      pending.value = undefined
      error.value = t(issue instanceof Error ? issue : String(issue))
      inventory.value = undefined
      selected.value = []
    }
  } finally {
    if (ticket === operation) busy.value = false
  }
}
watch([query, state], () => {
  page.value = 1
  selected.value = []
})
watch(
  () => workspaceStatus.value?.active?.token,
  () => {
    cancel()
    inventory.value = undefined
    selected.value = []
    pending.value = undefined
  },
)
onUnmounted(cancel)
</script>
<template>
  <section class="workspace-attachments" aria-labelledby="attachment-heading">
    <header class="attachment-heading">
      <div>
        <h2 id="attachment-heading"><Paperclip :size="20" />{{ t('附件与空间') }}</h2>
        <p>
          {{
            t('检查图片、音频、原始材料与目录文件。只有未被任何内容引用的受管附件可以移入回收站。')
          }}
        </p>
      </div>
      <UiButton :disabled="busy" @click="load"
        ><RefreshCw :size="16" />{{ inventory ? t('重新检查') : t('检查附件') }}</UiButton
      >
      <UiButton v-if="busy && !pending" @click="cancel">{{ t('取消') }}</UiButton>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="busy && !inventory" role="status">
      {{ t('正在核对附件及其引用…') }}
    </p>
    <template v-if="inventory">
      <div class="attachment-totals" role="status">
        <span
          >{{ t('实际文件') }} <strong>{{ bytes(inventory.totals.physicalBytes) }}</strong></span
        >
        <span
          >{{ t('去重内容') }} <strong>{{ bytes(inventory.totals.uniqueBytes) }}</strong></span
        >
        <span
          >{{ t('相同内容的副本') }}
          <strong>{{ bytes(inventory.totals.duplicateBytes) }}</strong></span
        >
        <span
          >{{ t('可整理') }} <strong>{{ inventory.totals.unused }}</strong></span
        >
      </div>
      <p class="attachment-hint">
        {{
          t(
            '空间按实际文件统计，同一对象的多个 ID 不重复计数。相同内容的副本可能是必要的目录副本，不会自动合并。外部文件只供查看。',
          )
        }}
      </p>
      <p v-if="inventory.pluginProtection" role="status">
        {{ t('存在无法解释引用的插件私有文件，已保守保留所有受管附件。') }}
      </p>
      <div class="attachment-toolbar">
        <UiInput
          v-model="query"
          icon="i-lucide-search"
          class="attachment-search"
          :placeholder="t('搜索名称、路径或类型')"
          :aria-label="t('搜索附件')"
        />
        <UiSelect v-model="state" :items="states" :aria-label="t('附件状态')" />
      </div>
      <div class="attachment-actions">
        <span>{{ t('已选') }} {{ selected.length }}</span>
        <UiButton :disabled="busy || !can('trash')" @click="pending = 'trash'"
          ><Trash2 :size="16" />{{ actions.trash }}</UiButton
        >
        <UiButton :disabled="busy || !can('restore')" @click="pending = 'restore'"
          ><ArchiveRestore :size="16" />{{ actions.restore }}</UiButton
        >
        <UiButton variant="danger" :disabled="busy || !can('purge')" @click="pending = 'purge'">{{
          actions.purge
        }}</UiButton>
      </div>
      <div class="attachment-table-wrap">
        <table class="attachment-table">
          <thead>
            <tr>
              <th>{{ t('选择') }}</th>
              <th>{{ t('附件') }}</th>
              <th>{{ t('大小') }}</th>
              <th>{{ t('状态与引用') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in visible" :key="entry.id">
              <td>
                <UiCheckbox
                  :model-value="selected.includes(entry.id)"
                  :disabled="
                    busy ||
                    !(['trash', 'restore', 'purge'] as const).some((action) =>
                      canManageAttachment(entry, action),
                    )
                  "
                  :aria-label="t('选择附件 ') + entry.name"
                  @update:model-value="toggle(entry.id, $event)"
                />
              </td>
              <td>
                <strong>{{ entry.name }}</strong
                ><code>{{ entry.path }}</code
                ><small>{{ entry.mime }}</small>
              </td>
              <td>{{ bytes(entry.size) }}</td>
              <td>
                <span>{{ states.find((item) => item.value === entry.state)?.label }}</span
                ><small v-if="!entry.available">{{ t('文件缺失或校验失败') }}</small
                ><small v-for="(count, key) in entry.refs" :key="key"
                  >{{ refLabel(key) }} · {{ count }}</small
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!filtered.length">{{ t('没有符合条件的附件。') }}</p>
      <footer class="attachment-pagination">
        <span>{{ filtered.length }} {{ t('项') }}</span
        ><UiButton :disabled="page <= 1" @click="page--">{{ t('上一页') }}</UiButton
        ><span>{{ page }} / {{ Math.max(1, Math.ceil(filtered.length / 25)) }}</span
        ><UiButton :disabled="page * 25 >= filtered.length" @click="page++">{{
          t('下一页')
        }}</UiButton>
      </footer>
    </template>
    <AppModal v-if="pending" :title="actions[pending]" :busy="busy" @close="pending = undefined">
      <p>
        {{
          pending === 'purge'
            ? t('将永久删除以下附件。无法恢复；提交前会重新核对所有引用。')
            : pending === 'trash'
              ? t('以下附件没有已知引用。移入回收站后仍保留文件，可恢复原 ID；清空前不会释放空间。')
              : t('恢复以下附件的原 ID 与原始文件。不会改变学习记录。')
        }}
      </p>
      <ul class="attachment-preview">
        <li v-for="entry in selectedEntries" :key="entry.id">
          <code>{{ entry.path }}</code> · {{ bytes(entry.size) }}
        </li>
      </ul>
      <div class="dialog-actions">
        <UiButton :disabled="busy" @click="pending = undefined">{{ t('取消') }}</UiButton
        ><UiButton
          :variant="pending === 'purge' ? 'danger' : 'primary'"
          :busy="busy"
          @click="apply"
          >{{ actions[pending] }}</UiButton
        >
      </div>
    </AppModal>
  </section>
</template>
<style scoped>
.workspace-attachments {
  display: grid;
  gap: 1rem;
}
.attachment-heading,
.attachment-toolbar,
.attachment-actions,
.attachment-pagination,
.attachment-totals {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.attachment-heading > div {
  flex: 1;
  min-width: min(100%, 20rem);
}
.attachment-heading h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.attachment-heading p,
.attachment-hint,
.attachment-table small {
  color: var(--muted);
}
.attachment-totals {
  gap: 1.5rem;
}
.attachment-totals strong {
  margin-inline-start: 0.4rem;
}
.attachment-search {
  flex: 1;
  min-width: 14rem;
}
.attachment-table-wrap {
  overflow-x: auto;
}
.attachment-table {
  width: 100%;
  text-align: left;
  border-collapse: collapse;
}
.attachment-table th,
.attachment-table td {
  padding: 0.8rem 0.6rem;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.attachment-table th {
  font-weight: 500;
  color: var(--muted);
}
.attachment-table td:first-child {
  width: 3rem;
}
.attachment-table td:nth-child(2) {
  max-width: 24rem;
}
.attachment-table code,
.attachment-table small {
  display: block;
  overflow-wrap: anywhere;
}
.attachment-table strong {
  display: block;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.attachment-table small {
  margin-top: 0.25rem;
}
.attachment-pagination {
  justify-content: flex-end;
}
.attachment-pagination > span:first-child {
  margin-right: auto;
}
.attachment-preview {
  max-height: 18rem;
  overflow: auto;
  padding-left: 1.3rem;
  overflow-wrap: anywhere;
}
</style>
