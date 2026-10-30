<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { Folder, ChevronRight, MoreHorizontal, FolderPlus, ArrowUp, ArrowDown } from '@lucide/vue'
import type { Library } from '../core/model'
import type { MaterialDestination } from '../core/material-organization-data'
import type { MaterialWorkbenchActions } from './material-workbench-actions'
import { UiButton, UiInput, UiSelect } from './ui'
import AppModal from './AppModal.vue'
import StudyPriorityField from './StudyPriorityField.vue'
import { studySettings } from '../core/study-settings'
import { t } from '../i18n'
import { appearance } from '../appearance'
import MaterialStateIcon from './MaterialStateIcon.vue'

const props = defineProps<{
  library: Library
  selectedId: string
  scope: string
  busy: boolean
  actions: MaterialWorkbenchActions
  visibleSourceIds?: ReadonlySet<string>
}>()
const emit = defineEmits<{ open: [id: string] }>()
type Row = {
  kind: 'folder' | 'source'
  id: string
  name: string
  depth: number
  destination: MaterialDestination
  order: number
  hasChildren: boolean
}
const closed = ref(new Set<string>())
const editing = ref<Row>()
const mode = ref<'create' | 'rename' | 'move' | 'delete' | 'priority'>()
const priority = ref<number>()
const inheritedPriority = computed(() => {
  const folders = new Map(props.library.materialFolders.map((entry) => [entry.id, entry]))
  let parent = folders.get(editing.value?.id ?? '')?.parentId
  const seen = new Set<string>()
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const folder = folders.get(parent)
    if (folder?.studyPriority !== undefined)
      return { value: folder.studyPriority, from: folder.name }
    parent = folder?.parentId
  }
  return { value: studySettings(props.library).defaultPriority, from: t('默认学习优先级') }
})
const name = ref(''),
  destination = ref('root'),
  pending = ref(false)
const error = ref('')
const openMenu = ref('')
const rowLimit = ref(200)
let generation = 0,
  alive = true
let dragged: Row | undefined
watch(
  () => props.scope,
  () => {
    generation++
    mode.value = undefined
    editing.value = undefined
    dragged = undefined
    closed.value = new Set()
    pending.value = false
    error.value = ''
    openMenu.value = ''
    rowLimit.value = 200
  },
  { flush: 'sync' },
)
onUnmounted(() => {
  alive = false
  generation++
  dragged = undefined
})
const key = (row: Pick<Row, 'kind' | 'id'>) => `${row.kind}:${row.id}`
const iconStates = computed(
  () =>
    new Map(
      props.library.sources.map(
        (source) =>
          [
            source.id,
            source.queue?.state === 'archived'
              ? 'archived'
              : source.queue
                ? 'scheduled'
                : 'pending',
          ] as const,
      ),
    ),
)
const destinationKey = (target: MaterialDestination) =>
  target.parentSourceId
    ? `source:${target.parentSourceId}`
    : target.folderId
      ? `folder:${target.folderId}`
      : 'root'
// Build and sort once per library change. Expanding a node never rescans the library.
const treeIndex = computed(() => {
  const groups = new Map<
    string,
    { folders: Library['materialFolders']; sources: Library['sources'] }
  >()
  const folderIds = new Set(props.library.materialFolders.map((item) => item.id))
  const sourceIds = new Set(props.library.sources.map((item) => item.id))
  const included = props.visibleSourceIds && new Set(props.visibleSourceIds)
  if (included) {
    const parents = new Map(props.library.sources.map((item) => [item.id, item.parentSourceId]))
    for (const id of props.visibleSourceIds!) {
      let parent = parents.get(id)
      let depth = 0
      while (parent && !included.has(parent) && depth++ < 32) {
        included.add(parent)
        parent = parents.get(parent)
      }
    }
  }
  const group = (key: string) => {
    let value = groups.get(key)
    if (!value) {
      value = { folders: [], sources: [] }
      groups.set(key, value)
    }
    return value
  }
  for (const item of [...props.library.materialFolders].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  ))
    group(
      destinationKey({
        folderId: item.parentId && folderIds.has(item.parentId) ? item.parentId : undefined,
      }),
    ).folders.push(item)
  for (const item of props.library.sources
    .filter((item) => !included || included.has(item.id))
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    ))
    group(
      destinationKey({
        folderId: item.folderId && folderIds.has(item.folderId) ? item.folderId : undefined,
        parentSourceId:
          item.parentSourceId && sourceIds.has(item.parentSourceId)
            ? item.parentSourceId
            : undefined,
      }),
    ).sources.push(item)
  return groups
})
const rows = computed(() => {
  const result: Row[] = [],
    seen = new Set<string>()
  function children(target: MaterialDestination, depth: number) {
    if (depth > 64) return
    const group = treeIndex.value.get(destinationKey(target))
    if (!group) return
    for (const item of group.folders) {
      const row: Row = {
        kind: 'folder',
        id: item.id,
        name: item.name,
        depth,
        destination: target,
        order: item.order,
        hasChildren: treeIndex.value.has(`folder:${item.id}`),
      }
      if (seen.has(key(row))) continue
      seen.add(key(row))
      result.push(row)
      if (!closed.value.has(key(row))) children({ folderId: item.id }, depth + 1)
    }
    for (const item of group.sources) {
      const row: Row = {
        kind: 'source',
        id: item.id,
        name: item.title,
        depth,
        destination: target,
        order: item.order ?? 0,
        hasChildren: treeIndex.value.has(`source:${item.id}`),
      }
      if (seen.has(key(row))) continue
      seen.add(key(row))
      result.push(row)
      if (!closed.value.has(key(row))) children({ parentSourceId: item.id }, depth + 1)
    }
  }
  children({}, 0)
  return result
})
const visibleRows = computed(() => rows.value.slice(0, rowLimit.value))
watch(rows, (value) => {
  rowLimit.value = Math.max(200, Math.min(rowLimit.value, Math.ceil(value.length / 200) * 200))
})
const targets = computed(() => [
  { label: t('未归类'), value: 'root' },
  ...props.library.materialFolders.map((item) => ({
    label: `${t('文件夹')} · ${item.name}`,
    value: `folder:${item.id}`,
  })),
  ...(editing.value?.kind === 'source'
    ? props.library.sources
        .filter((item) => item.id !== editing.value?.id)
        .map((item) => ({ label: item.title, value: `source:${item.id}` }))
    : []),
])
function toggle(row: Row) {
  const next = new Set(closed.value)
  if (next.has(key(row))) next.delete(key(row))
  else next.add(key(row))
  closed.value = next
}
function begin(action: NonNullable<typeof mode.value>, row?: Row) {
  if (pending.value || props.busy) return
  openMenu.value = ''
  error.value = ''
  editing.value = row
  mode.value = action
  priority.value = props.library.materialFolders.find(
    (folder) => folder.id === row?.id,
  )?.studyPriority
  name.value = action === 'rename' ? (row?.name ?? '') : ''
  destination.value = row?.destination.folderId
    ? `folder:${row.destination.folderId}`
    : row?.destination.parentSourceId
      ? `source:${row.destination.parentSourceId}`
      : 'root'
}
function chosen(): MaterialDestination {
  return destination.value.startsWith('folder:')
    ? { folderId: destination.value.slice(7) }
    : destination.value.startsWith('source:')
      ? { parentSourceId: destination.value.slice(7) }
      : {}
}
async function submit() {
  if (pending.value || props.busy) return
  const current = generation
  pending.value = true
  try {
    const row = editing.value
    const result =
      mode.value === 'priority' && row && props.actions.setPriority
        ? await props.actions.setPriority('folder', row.id, priority.value)
        : mode.value === 'create'
          ? await props.actions.createFolder(
              name.value,
              row?.kind === 'folder' ? row.id : undefined,
            )
          : mode.value === 'rename' && row
            ? await props.actions.renameFolder(row.id, name.value)
            : mode.value === 'delete' && row
              ? await props.actions.removeFolder(row.id)
              : mode.value === 'move' && row
                ? await props.actions.move({ kind: row.kind, id: row.id, destination: chosen() })
                : false
    if (result && alive && current === generation) mode.value = undefined
  } catch (issue) {
    if (alive && current === generation) error.value = t(issue as Error)
  } finally {
    if (alive && current === generation) pending.value = false
  }
}
async function reorder(row: Row, direction: -1 | 1) {
  if (pending.value || props.busy) return
  openMenu.value = ''
  const siblings = rows.value.filter(
    (item) =>
      item.kind === row.kind &&
      item.destination.folderId === row.destination.folderId &&
      item.destination.parentSourceId === row.destination.parentSourceId,
  )
  const index = siblings.findIndex((item) => item.id === row.id),
    neighbor = siblings[index + direction]
  if (!neighbor) return
  await performMove({
    kind: row.kind,
    id: row.id,
    destination: row.destination,
    beforeId: direction < 0 ? neighbor.id : siblings[index + 2]?.id,
  })
}
async function performMove(move: Parameters<MaterialWorkbenchActions['move']>[0]) {
  const current = generation
  pending.value = true
  error.value = ''
  try {
    await props.actions.move(move)
  } catch (issue) {
    if (alive && current === generation) error.value = t(issue as Error)
  } finally {
    if (alive && current === generation) pending.value = false
  }
}
async function drop(row?: Row) {
  openMenu.value = ''
  const item = dragged
  dragged = undefined
  if (!item || props.busy || pending.value || row?.id === item.id) return
  if (item.kind === 'folder' && row?.kind === 'source') return
  await performMove({
    kind: item.kind,
    id: item.id,
    destination: !row
      ? {}
      : row.kind === 'folder'
        ? { folderId: row.id }
        : { parentSourceId: row.id },
  })
}
</script>
<template>
  <div
    class="material-tree"
    :aria-label="t('材料组织')"
    @dragover.prevent
    @drop.prevent.stop="drop()"
  >
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    <UiButton variant="ghost" :disabled="busy" @click="begin('create')"
      ><FolderPlus :size="16" />{{ t('新建文件夹') }}</UiButton
    >
    <ul>
      <li
        v-for="row in visibleRows"
        :key="key(row)"
        :style="{ '--tree-depth': Math.min(row.depth, 8) }"
        :class="{ current: row.kind === 'source' && row.id === selectedId }"
        :draggable="!busy"
        @dragstart="dragged = row"
        @dragend="dragged = undefined"
        @dragover.prevent.stop
        @drop.prevent.stop="drop(row)"
      >
        <UiButton
          v-if="row.hasChildren"
          variant="ghost"
          class="tree-toggle"
          :aria-label="t(closed.has(key(row)) ? '展开' : '收起')"
          :aria-expanded="!closed.has(key(row))"
          @click="toggle(row)"
          ><ChevronRight :size="14" :class="{ expanded: !closed.has(key(row)) }"
        /></UiButton>
        <span v-else class="tree-spacer" />
        <UiButton
          variant="ghost"
          :class="row.kind === 'source' ? 'source-list-title' : 'folder-title'"
          :disabled="busy"
          @click="row.kind === 'source' ? emit('open', row.id) : toggle(row)"
        >
          <Folder v-if="row.kind === 'folder'" :size="16" /><MaterialStateIcon
            v-else
            :state="iconStates.get(row.id)"
          /><span
            :style="
              row.kind === 'source'
                ? {
                    opacity: appearance.strongContrast
                      ? 1
                      : appearance.materialIcons[iconStates.get(row.id) ?? 'pending'].textOpacity,
                  }
                : undefined
            "
            >{{ row.name }}</span
          >
        </UiButton>
        <details class="tree-menu" :open="openMenu === key(row)">
          <summary
            :aria-label="t('更多操作')"
            @click.prevent="openMenu = openMenu === key(row) ? '' : key(row)"
          >
            <MoreHorizontal :size="16" />
          </summary>
          <div>
            <UiButton
              v-if="row.kind === 'folder' && actions.setPriority"
              variant="ghost"
              :disabled="busy"
              @click="begin('priority', row)"
              >{{ t('学习优先级') }}</UiButton
            >
            <UiButton
              v-if="row.kind === 'folder'"
              variant="ghost"
              :disabled="busy"
              @click="begin('create', row)"
              >{{ t('新建文件夹') }}</UiButton
            >
            <UiButton
              v-if="row.kind === 'folder'"
              variant="ghost"
              :disabled="busy"
              @click="begin('rename', row)"
              >{{ t('重命名') }}</UiButton
            >
            <UiButton variant="ghost" :disabled="busy" @click="begin('move', row)">{{
              t('移动')
            }}</UiButton>
            <UiButton variant="ghost" :disabled="busy" @click="reorder(row, -1)"
              ><ArrowUp :size="14" />{{ t('上移') }}</UiButton
            >
            <UiButton variant="ghost" :disabled="busy" @click="reorder(row, 1)"
              ><ArrowDown :size="14" />{{ t('下移') }}</UiButton
            >
            <UiButton
              v-if="row.kind === 'folder'"
              variant="ghost"
              :disabled="busy"
              @click="begin('delete', row)"
              >{{ t('删除文件夹') }}</UiButton
            >
          </div>
        </details>
      </li>
    </ul>
    <UiButton v-if="visibleRows.length < rows.length" variant="ghost" @click="rowLimit += 200">{{
      t('加载更多')
    }}</UiButton>
    <AppModal
      v-if="mode"
      :title="
        t(
          mode === 'create'
            ? '新建文件夹'
            : mode === 'rename'
              ? '重命名'
              : mode === 'priority'
                ? '学习优先级'
                : mode === 'delete'
                  ? '删除文件夹'
                  : '移动',
        )
      "
      :busy="pending"
      @close="mode = undefined"
    >
      <form @submit.prevent="submit">
        <StudyPriorityField
          v-if="mode === 'priority'"
          id="folder-study-priority"
          v-model="priority"
          :inherited-value="inheritedPriority.value"
          :inherited-from="inheritedPriority.from"
          :disabled="pending"
        />
        <UiInput
          v-if="mode === 'create' || mode === 'rename'"
          v-model="name"
          :aria-label="t('文件夹名称')"
          :placeholder="t('文件夹名称')"
          maxlength="160"
          autofocus
        />
        <UiSelect
          v-if="mode === 'move'"
          v-model="destination"
          :items="targets"
          :aria-label="t('移动到')"
        />
        <p v-if="mode === 'delete'">{{ t('删除文件夹会将内容移到上一级，保留全部学习数据。') }}</p>
        <div class="form-actions">
          <UiButton variant="secondary" :disabled="pending" @click="mode = undefined">{{
            t('取消')
          }}</UiButton
          ><UiButton
            type="submit"
            variant="primary"
            :disabled="pending || ((mode === 'create' || mode === 'rename') && !name.trim())"
            >{{ t('确认') }}</UiButton
          >
        </div>
      </form>
    </AppModal>
  </div>
</template>
<style scoped>
.material-tree ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.material-tree li {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.3rem 0.3rem 0.3rem calc(var(--tree-depth) * 0.8rem);
  border-radius: 8px;
  transition: background-color 160ms;
}
.material-tree li.current {
  background: var(--sage);
}
.tree-toggle,
.tree-spacer {
  width: 1.25rem;
  flex: 0 0 1.25rem;
}
.tree-toggle {
  padding: 0;
}
.tree-toggle svg {
  transition: transform 160ms;
}
.tree-toggle svg.expanded {
  transform: rotate(90deg);
}
.source-list-title,
.folder-title {
  min-width: 0;
  flex: 1;
  justify-content: flex-start;
  text-align: left;
  padding: 0.4rem;
}
.source-list-title span,
.folder-title span {
  overflow-wrap: anywhere;
  white-space: normal;
}
.tree-menu {
  position: relative;
  margin-left: auto;
}
.tree-menu summary {
  display: flex;
  padding: 0.35rem;
  cursor: pointer;
  list-style: none;
}
.tree-menu[open] > div {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 12;
  min-width: 9rem;
  padding: 0.4rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 6px 24px #0002;
  display: grid;
}
.tree-menu[open] > div button {
  justify-content: flex-start;
}
.form-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
}
@media (prefers-reduced-motion: reduce) {
  .material-tree li,
  .tree-toggle svg {
    transition: none;
  }
}
</style>
