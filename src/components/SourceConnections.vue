<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { AlertTriangle, Check, FolderOpen, Link, Plus, RefreshCw, Unplug, X } from '@lucide/vue'
import type { useSourceConnections } from '../app/useSourceConnections'
import type { SourceConnection, SourceCandidate } from '../core/collection-data'
import type { Source } from '../core/source-data'
import type { CollectionHostApi } from '@repeaty/plugin-api'
import { t, locale } from '../i18n'
import { UiButton, UiInput, UiSelect, UiNotice } from './ui'
import AppModal from './AppModal.vue'

const props = defineProps<{
  controller: ReturnType<typeof useSourceConnections>
  sources: Source[]
  getSource: (id: string, signal?: AbortSignal, mediaId?: string) => Promise<string>
  collection?: CollectionHostApi
}>()
const emit = defineEmits<{ settings: [] }>()
const connections = computed(() => props.controller.connections.value)
const candidates = computed(() => props.controller.candidates.value)
const providers = computed(() => props.controller.connectors.value)
const selectedId = ref(''),
  candidateId = ref(''),
  targetId = ref(''),
  busy = ref(false),
  reading = ref(false),
  choosing = ref(false),
  error = ref('')
const selected = computed(() => connections.value.find((entry) => entry.id === selectedId.value))
const pending = computed(() =>
  candidates.value.filter((entry) => entry.connectionId === selectedId.value),
)
const candidate = computed(() => pending.value.find((entry) => entry.id === candidateId.value))
const running = computed(() => props.controller.running.value.includes(selectedId.value))
const unavailable = computed(
  () =>
    !!selected.value &&
    !providers.value.some(
      (provider) =>
        provider.pluginId === selected.value!.pluginId &&
        provider.id === selected.value!.connectorId,
    ),
)
const needsAuthorization = computed(() =>
  props.controller.needsAuthorization.value.includes(selectedId.value),
)
const candidateLabels = { add: '新增材料', update: '来源有更新', missing: '来源已移除' } as const
const intervals = [
  { value: '0', label: '仅手动检查' },
  { value: '1', label: '每小时' },
  { value: '12', label: '每 12 小时' },
  { value: '24', label: '每天' },
  { value: '168', label: '每周' },
] as const
const currentScope = computed(() => props.controller.api.value?.snapshot().workspaceScope)
const draft = ref<{
  id?: string
  title: string
  provider: string
  mode: 'import' | 'index'
  input: 'remote' | 'directory'
  directoryId?: string
  directoryName?: string
  files?: File[]
  settings: Record<string, unknown>
  interval: string
}>()
const disconnecting = shallowRef<SourceConnection>()
const directoryInput = ref<HTMLInputElement>()
const provider = computed(() =>
  providers.value.find((entry) => `${entry.pluginId}:${entry.id}` === draft.value?.provider),
)
const needsDirectory = computed(
  () =>
    provider.value?.kind === 'directory' ||
    (provider.value?.kind === 'hybrid' && draft.value?.input === 'directory'),
)
const relinkTargets = computed(() =>
  props.sources.filter((source) => source.binding?.connectionId === selectedId.value),
)
const review = shallowRef<{
  candidate: SourceCandidate
  revision: number
  text: string
  localText: string
  baseText?: string
  source?: { id: string; title: string; mediaId: string; acceptedMediaId?: string }
}>()
const conflict = computed(
  () =>
    !!review.value?.source && review.value.source.mediaId !== review.value.source.acceptedMediaId,
)
type IndexResult = Awaited<ReturnType<ReturnType<typeof useSourceConnections>['searchIndex']>>
const indexQuery = ref(''),
  indexSearching = ref(false),
  indexReading = ref(false),
  indexNotice = ref('')
const indexResult = shallowRef<IndexResult>()
const indexPreview = shallowRef<{ entry: IndexResult['hits'][number]; text: string }>()
const originalMaterials = computed(() =>
  props.sources.filter(
    (source) =>
      source.binding?.connectionId === selectedId.value && hasOriginal(source.binding.key),
  ),
)
let indexGeneration = 0
function hasOriginal(key: string) {
  return props.controller.originals.value.has(JSON.stringify([selectedId.value, key]))
}
watch([selectedId, () => props.controller.api.value], () => {
  indexGeneration++
  indexResult.value = undefined
  indexPreview.value = undefined
  indexQuery.value = indexNotice.value = ''
  indexSearching.value = indexReading.value = false
})
let alive = true,
  generation = 0,
  readController: AbortController | undefined
watch(
  connections,
  (entries) => {
    if (!entries.some((entry) => entry.id === selectedId.value))
      selectedId.value = entries[0]?.id ?? ''
  },
  { immediate: true },
)
watch(
  pending,
  (entries) => {
    if (!entries.some((entry) => entry.id === candidateId.value))
      candidateId.value = entries[0]?.id ?? ''
  },
  { immediate: true },
)
watch(candidateId, () => {
  targetId.value = ''
})
watch(currentScope, () => {
  draft.value = undefined
  disconnecting.value = undefined
  targetId.value = ''
  review.value = undefined
  error.value = ''
})
watch(
  [() => candidate.value?.id, () => candidate.value?.fingerprint, targetId, currentScope],
  () => void loadReview(),
  { immediate: true },
)
onUnmounted(() => {
  alive = false
  generation++
  indexGeneration++
  readController?.abort()
})

async function searchIndex() {
  if (!indexQuery.value.trim() || indexSearching.value) return
  const id = selectedId.value,
    scope = currentScope.value,
    current = ++indexGeneration
  indexSearching.value = true
  error.value = indexNotice.value = ''
  indexPreview.value = undefined
  indexResult.value = undefined
  try {
    const result = await props.controller.searchIndex(id, indexQuery.value.trim())
    if (alive && current === indexGeneration && scope === currentScope.value)
      indexResult.value = result
  } catch (issue) {
    if (alive && current === indexGeneration && scope === currentScope.value)
      error.value = t(issue as Error)
  } finally {
    if (alive && current === indexGeneration) indexSearching.value = false
  }
}
async function readIndexed(entry: IndexResult['hits'][number]) {
  const id = selectedId.value,
    scope = currentScope.value,
    current = ++indexGeneration
  indexReading.value = true
  error.value = indexNotice.value = ''
  indexPreview.value = undefined
  try {
    const text = await props.controller.readIndexed(id, entry)
    if (alive && current === indexGeneration && scope === currentScope.value)
      indexPreview.value = { entry, text }
  } catch (issue) {
    if (alive && current === indexGeneration && scope === currentScope.value)
      error.value = t(issue as Error)
  } finally {
    if (alive && current === indexGeneration) indexReading.value = false
  }
}
async function collectIndexed() {
  const preview = indexPreview.value,
    api = props.collection,
    id = selectedId.value,
    scope = currentScope.value
  if (!preview || !api || busy.value) return
  busy.value = true
  error.value = indexNotice.value = ''
  let planId: string | undefined
  try {
    const text = await props.controller.readIndexed(id, preview.entry)
    if (!alive || scope !== currentScope.value || indexPreview.value !== preview) return
    if (text !== preview.text) throw new Error('文件内容已变化，请更新索引后重新预览。')
    const path = preview.entry.path
    const file = new File([text], path.split('/').at(-1)!, {
      type: /\.txt$/i.test(path) ? 'text/plain' : 'text/markdown',
    })
    Object.defineProperty(file, 'webkitRelativePath', { value: path })
    const plan = await api.prepareCollection({ files: [file], destination: 'inbox', kind: 'file' })
    planId = plan.id
    if (!alive || scope !== currentScope.value || indexPreview.value !== preview) return
    await api.commitCollection({
      planId: plan.id,
      expectedRevision: plan.revision,
      operationId: crypto.randomUUID(),
    })
    if (alive && scope === currentScope.value) indexNotice.value = t('已收集到收件箱。')
  } catch (issue) {
    if (alive && scope === currentScope.value) error.value = t(issue as Error)
  } finally {
    if (planId) api.discardCollection(planId)
    if (alive) busy.value = false
  }
}
async function exportOriginal(key: string) {
  const id = selectedId.value,
    scope = currentScope.value
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await props.controller.exportOriginal(id, key)
  } catch (issue) {
    if (alive && scope === currentScope.value) error.value = t(issue as Error)
  } finally {
    if (alive) busy.value = false
  }
}

async function loadReview() {
  readController?.abort()
  readController = new AbortController()
  const current = ++generation,
    owner = props.controller.api.value,
    entry = candidate.value,
    scope = currentScope.value,
    signal = readController.signal
  review.value = undefined
  reading.value = !!entry
  error.value = ''
  if (!entry || !owner) return
  const snapshot = owner.snapshot(),
    source = props.sources.find((source) => source.id === (targetId.value || entry.sourceId))
  const before = source
    ? {
        id: source.id,
        title: source.title,
        mediaId: source.mediaId,
        acceptedMediaId: source.binding?.acceptedMediaId,
      }
    : undefined
  try {
    const [text, localText, baseText] = await Promise.all([
      owner.readCandidate(entry.id),
      before ? props.getSource(before.id, signal, before.mediaId) : Promise.resolve(''),
      before?.acceptedMediaId && before.acceptedMediaId !== before.mediaId
        ? props.getSource(before.id, signal, before.acceptedMediaId)
        : Promise.resolve(undefined),
    ])
    if (!alive || current !== generation || scope !== currentScope.value || signal.aborted) return
    if (owner.snapshot().revision !== snapshot.revision)
      throw new Error('学习库已变化，请重新查看对比。')
    review.value = {
      candidate: { ...entry },
      revision: snapshot.revision,
      text,
      localText,
      baseText,
      source: before,
    }
  } catch (issue) {
    if (alive && current === generation && !signal.aborted) error.value = t(issue as Error)
  } finally {
    if (alive && current === generation) reading.value = false
  }
}
function initializeFields() {
  if (!draft.value) return
  draft.value.settings = Object.fromEntries(
    (provider.value?.fields ?? []).map((field) => [field.key, field.default ?? '']),
  )
  draft.value.mode = 'import'
  draft.value.input = provider.value?.kind === 'directory' ? 'directory' : 'remote'
  draft.value.directoryId = draft.value.directoryName = undefined
  draft.value.files = undefined
}
function create() {
  error.value = ''
  const first = providers.value[0]
  if (!first) return
  draft.value = {
    title: '',
    provider: `${first.pluginId}:${first.id}`,
    mode: 'import',
    input: 'directory',
    settings: {},
    interval: '0',
  }
  initializeFields()
}
function configure(connection: SourceConnection) {
  error.value = ''
  draft.value = {
    id: connection.id,
    title: connection.title,
    provider: `${connection.pluginId}:${connection.connectorId}`,
    mode: connection.mode,
    input: connection.settings.input === 'directory' ? 'directory' : 'remote',
    directoryId:
      typeof connection.settings.directoryId === 'string'
        ? connection.settings.directoryId
        : undefined,
    settings: { ...connection.settings },
    interval: String(connection.intervalHours),
  }
}
async function chooseDirectory() {
  const pending = draft.value,
    scope = currentScope.value
  if (!pending || choosing.value) return
  choosing.value = true
  error.value = ''
  try {
    const choice = await props.controller.chooseDirectory(pending.directoryId)
    if (!alive || draft.value !== pending || scope !== currentScope.value || !choice) return
    pending.directoryId = choice.id
    pending.directoryName = choice.name
    if (!pending.title.trim()) pending.title = choice.name
  } catch (issue) {
    if (alive && scope === currentScope.value) error.value = t(issue as Error)
  } finally {
    if (alive) choosing.value = false
  }
}
function chooseBrowserDirectory(event: Event) {
  if (!draft.value) return
  const input = event.target as HTMLInputElement,
    files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  draft.value.files = files
  draft.value.directoryName = files[0]?.webkitRelativePath.split('/')[0] || t('所选目录')
  if (!draft.value.title.trim()) draft.value.title = draft.value.directoryName
}
async function save() {
  const pending = draft.value,
    entry = provider.value,
    scope = currentScope.value
  if (!pending || !entry || busy.value || !pending.title.trim()) return
  if (needsDirectory.value && !pending.directoryId && !pending.files?.length) {
    error.value = t('请先选择要读取的目录。')
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await props.controller.save({
      id: pending.id,
      pluginId: entry.pluginId,
      connectorId: entry.id,
      title: pending.title,
      mode: pending.mode,
      directoryId: pending.directoryId,
      files: pending.files,
      settings: { ...pending.settings, input: needsDirectory.value ? 'directory' : 'remote' },
      intervalHours: Number(pending.interval) as SourceConnection['intervalHours'],
      status: 'connected',
    })
    if (!alive || scope !== currentScope.value) return
    draft.value = undefined
    selectedId.value = result.id
  } catch (issue) {
    if (alive && scope === currentScope.value) error.value = t(issue as Error)
  } finally {
    if (alive) busy.value = false
  }
}
async function scan() {
  const scope = currentScope.value,
    id = selectedId.value
  error.value = ''
  try {
    await props.controller.scan(id)
  } catch (issue) {
    if (
      alive &&
      scope === currentScope.value &&
      !(issue instanceof DOMException && issue.name === 'AbortError')
    )
      error.value = t(issue as Error)
  }
}
async function disconnect() {
  const pending = disconnecting.value,
    scope = currentScope.value
  if (!pending || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await props.controller.disconnect(pending.id)
    if (alive && scope === currentScope.value) disconnecting.value = undefined
  } catch (issue) {
    if (alive && scope === currentScope.value) error.value = t(issue as Error)
  } finally {
    if (alive) busy.value = false
  }
}
async function resolve(action: 'accept' | 'keep') {
  const pending = review.value,
    api = props.controller.api.value,
    scope = currentScope.value
  if (!pending || !api || busy.value || reading.value) return
  busy.value = true
  error.value = ''
  try {
    await api.resolve({
      candidateId: pending.candidate.id,
      action,
      expectedRevision: pending.revision,
      expectedMediaId: pending.source?.mediaId,
      targetSourceId:
        pending.candidate.kind === 'add' && pending.source ? pending.source.id : undefined,
    })
    if (alive && scope === currentScope.value && review.value === pending) review.value = undefined
  } catch (issue) {
    if (alive && scope === currentScope.value) error.value = t(issue as Error)
  } finally {
    if (alive) busy.value = false
  }
}
function setField(key: string, value: string) {
  if (draft.value) draft.value.settings[key] = value
}
function date(value?: string) {
  return value ? new Date(value).toLocaleString(locale.value) : t('尚未检查')
}
</script>

<template>
  <section class="source-connections" :aria-label="t('连接来源')">
    <header class="connections-heading">
      <div>
        <h2>{{ t('把材料来源连接到学习库') }}</h2>
        <p>{{ t('检查只发现变化，确认后才更新已保存的材料。') }}</p>
      </div>
      <UiButton variant="secondary" :disabled="busy" @click="create"
        ><Plus :size="16" />{{ t('新建连接') }}</UiButton
      >
    </header>
    <p v-if="error && !draft && !disconnecting" role="alert" class="import-warning">
      {{ error }}
      <UiButton v-if="candidate" variant="ghost" :disabled="reading" @click="loadReview">{{
        t('重新查看对比')
      }}</UiButton>
    </p>
    <div v-if="!connections.length" class="connections-empty">
      <Link :size="30" />
      <p>{{ t('连接文件目录，或安装来源插件接入其他阅读工具。') }}</p>
      <p class="muted">{{ t('导入保留副本；只读索引让文件留在原来的位置。') }}</p>
    </div>
    <div v-else class="connections-layout">
      <nav class="connections-list" :aria-label="t('已连接的来源')">
        <UiButton
          v-for="connection in connections"
          :key="connection.id"
          variant="ghost"
          :aria-pressed="selectedId === connection.id"
          :disabled="busy"
          @click="selectedId = connection.id"
        >
          <strong>{{ connection.title }}</strong
          ><span
            >{{ t(connection.mode === 'index' ? '只读索引' : '导入副本') }} ·
            {{
              t(
                connection.status !== 'connected'
                  ? '已断开'
                  : controller.needsAuthorization.value.includes(connection.id)
                    ? '需要重新关联'
                    : '已连接',
              )
            }}</span
          ><span
            v-if="candidates.filter((candidate) => candidate.connectionId === connection.id).length"
            >{{
              t('{count} 项待确认', {
                count: candidates.filter((candidate) => candidate.connectionId === connection.id)
                  .length,
              })
            }}</span
          >
        </UiButton>
      </nav>
      <section v-if="selected" class="connection-detail">
        <header class="connection-detail-heading">
          <div>
            <h3>{{ selected.title }}</h3>
            <p>{{ t('上次检查：{time}', { time: date(selected.checkedAt) }) }}</p>
          </div>
          <div class="connection-actions">
            <UiButton variant="ghost" :disabled="busy || running" @click="configure(selected)">{{
              t(
                needsAuthorization
                  ? '重新关联目录'
                  : selected.status === 'disconnected'
                    ? '重新连接'
                    : '连接设置',
              )
            }}</UiButton>
            <UiButton
              v-if="selected.status === 'connected'"
              variant="ghost"
              :disabled="busy"
              @click="disconnecting = selected"
              ><Unplug :size="16" />{{ t('断开') }}</UiButton
            >
            <UiButton v-if="running" variant="secondary" @click="controller.cancel(selected.id)"
              ><X :size="16" />{{ t('取消检查') }}</UiButton
            >
            <UiButton
              v-else-if="selected.status === 'connected'"
              variant="primary"
              :disabled="busy || unavailable || needsAuthorization"
              @click="scan"
              ><RefreshCw :size="16" />{{
                t(selected.mode === 'index' ? '更新索引' : '检查更新')
              }}</UiButton
            >
          </div>
        </header>
        <UiNotice v-if="unavailable">{{
          t('此连接的插件尚未启用。请在插件页面安装或启用后再检查。')
        }}</UiNotice>
        <UiNotice v-else-if="selected.status === 'disconnected'">{{
          t('连接已断开。已保存的材料、卡片和学习记录仍然保留。')
        }}</UiNotice>
        <UiNotice v-else-if="needsAuthorization" tone="warning"
          >{{ t('此设备需要重新授权读取来源目录。已保存的材料和待确认的变化仍然保留。') }}
          <UiButton variant="secondary" :disabled="busy || running" @click="configure(selected)">{{
            t('选择目录并重新关联')
          }}</UiButton>
        </UiNotice>
        <p v-if="running" role="status" class="connection-progress">
          {{ controller.progress.value || t('正在检查来源…') }}
        </p>
        <template v-if="selected.mode === 'index'">
          <p class="form-note">
            {{ t('只读索引不复制或改写原目录。更新后可以搜索目录中的 Markdown 和文本。') }}
          </p>
          <form class="connection-index-search" @submit.prevent="searchIndex">
            <UiInput
              v-model="indexQuery"
              type="search"
              icon="i-lucide-search"
              :placeholder="t('搜索这个目录中的内容…')"
              :aria-label="t('搜索只读目录')"
              :disabled="indexSearching || selected.status !== 'connected'"
            /><UiButton
              type="submit"
              variant="secondary"
              :busy="indexSearching"
              :disabled="!indexQuery.trim() || selected.status !== 'connected'"
              >{{ t('搜索') }}</UiButton
            >
          </form>
          <p v-if="indexResult && !indexResult.hits.length" class="form-note">
            {{ t('没有找到匹配的文件。') }}
          </p>
          <ul v-if="indexResult?.hits.length" class="connection-index-results">
            <li v-for="entry in indexResult.hits" :key="entry.path">
              <UiButton
                variant="ghost"
                :disabled="busy || indexReading"
                :aria-pressed="indexPreview?.entry.path === entry.path"
                @click="readIndexed(entry)"
                ><strong>{{ entry.path }}</strong
                ><span>{{ entry.snippet }}</span></UiButton
              >
            </li>
          </ul>
          <p v-if="indexResult?.more" class="form-note">
            {{ t('仅显示前 50 个结果，请缩小搜索范围。') }}
          </p>
          <p v-if="indexReading" role="status">{{ t('正在读取原文…') }}</p>
          <article v-if="indexPreview" class="connection-index-preview">
            <header>
              <h3>{{ indexPreview.entry.path }}</h3>
              <UiButton v-if="collection" variant="primary" :busy="busy" @click="collectIndexed">{{
                t('收集到收件箱')
              }}</UiButton>
            </header>
            <pre>{{ indexPreview.text }}</pre>
            <p class="form-note">
              {{ t('这是原目录的只读预览。收集后才会在学习库保存一份副本。') }}
            </p>
          </article>
          <p v-if="indexNotice" role="status">{{ indexNotice }}</p>
        </template>
        <template v-else>
          <div v-if="!pending.length && !running" class="connection-current">
            <Check :size="24" />
            <h3>{{ t('没有待确认的变化') }}</h3>
            <p>{{ t('新内容、修改和移除都会先出现在这里。') }}</p>
          </div>
          <div v-else class="connection-changes">
            <div class="connection-pending" :aria-label="t('待确认的变化')">
              <UiButton
                v-for="entry in pending"
                :key="entry.id"
                variant="ghost"
                :aria-pressed="candidateId === entry.id"
                :disabled="busy"
                @click="candidateId = entry.id"
                ><span>{{ t(candidateLabels[entry.kind]) }}</span
                ><strong>{{ entry.title }}</strong
                ><span v-if="entry.path">{{ entry.path }}</span></UiButton
              >
            </div>
            <article v-if="candidate" class="connection-review">
              <header>
                <span class="connection-change-kind">{{ t(candidateLabels[candidate.kind]) }}</span>
                <h3>{{ candidate.title }}</h3>
                <UiButton
                  v-if="hasOriginal(candidate.key)"
                  variant="ghost"
                  :disabled="busy || selected.status !== 'connected'"
                  @click="exportOriginal(candidate.key)"
                  >{{ t('导出原件') }}</UiButton
                >
              </header>
              <label
                v-if="candidate.kind === 'add' && relinkTargets.length"
                class="connection-relink"
                >{{ t('保存方式')
                }}<UiSelect
                  v-model="targetId"
                  :disabled="busy"
                  :items="[
                    { value: '', label: t('作为新材料收集') },
                    ...relinkTargets.map((source) => ({
                      value: source.id,
                      label: t('重新关联：{title}', { title: source.title }),
                    })),
                  ]"
                /><span>{{ t('文件改名或移动时，可关联原材料以保留卡片和历史。') }}</span></label
              >
              <UiNotice v-if="conflict"
                ><AlertTriangle :size="18" />{{
                  t(
                    '本地正文也有修改。采用来源更新会保存当前正文为历史版本；已有卡片仍指向原来的版本。',
                  )
                }}</UiNotice
              >
              <p v-if="reading" role="status">{{ t('正在读取对比内容…') }}</p>
              <template v-else-if="review">
                <UiNotice v-if="candidate.kind === 'missing'">{{
                  t('来源中已找不到这份材料。确认后标记为来源缺失，本地正文、卡片和历史不会删除。')
                }}</UiNotice>
                <div class="connection-diff" :class="{ 'has-local': !!review.source }">
                  <section v-if="review.source">
                    <h4>{{ t('当前本地版本') }}</h4>
                    <pre>{{ review.localText }}</pre>
                  </section>
                  <section v-if="candidate.kind !== 'missing'">
                    <h4>{{ t('来源中的新内容') }}</h4>
                    <pre>{{ review.text }}</pre>
                  </section>
                </div>
                <details v-if="review.baseText" class="connection-base">
                  <summary>{{ t('查看上次接收的版本') }}</summary>
                  <pre>{{ review.baseText }}</pre>
                </details>
                <footer class="connection-review-actions">
                  <UiButton
                    variant="secondary"
                    :disabled="busy || running"
                    @click="resolve('keep')"
                    >{{ t('忽略这次变化') }}</UiButton
                  ><UiButton
                    variant="primary"
                    :busy="busy"
                    :disabled="running || selected.status !== 'connected'"
                    @click="resolve('accept')"
                    >{{
                      t(
                        candidate.kind === 'missing'
                          ? '确认来源已移除'
                          : candidate.kind === 'add' && !targetId
                            ? '收集到收件箱'
                            : '采用来源更新',
                      )
                    }}</UiButton
                  >
                </footer>
              </template>
            </article>
          </div>
        </template>
        <details v-if="originalMaterials.length" class="connection-originals">
          <summary>{{ t('已关联材料的原件') }}</summary>
          <ul>
            <li v-for="source in originalMaterials" :key="source.id">
              <span>{{ source.title }}</span
              ><UiButton
                variant="ghost"
                :disabled="busy || selected.status !== 'connected'"
                @click="exportOriginal(source.binding!.key)"
                >{{ t('导出原件') }}</UiButton
              >
            </li>
          </ul>
        </details>
      </section>
    </div>
    <AppModal
      v-if="draft"
      :title="t(draft.id ? '连接设置' : '新建连接')"
      :busy="busy || choosing"
      :error="error"
      @close="draft = undefined"
    >
      <form class="connection-form" @submit.prevent="save">
        <label
          >{{ t('来源类型')
          }}<UiSelect
            :model-value="draft?.provider ?? ''"
            :disabled="!!draft?.id || busy || choosing"
            :items="
              providers.map((provider) => ({
                value: `${provider.pluginId}:${provider.id}`,
                label: t(provider.title),
              }))
            "
            @update:model-value="
              (value: string) => {
                if (draft) {
                  draft.provider = value
                  initializeFields()
                }
              }
            "
        /></label>
        <label
          >{{ t('连接名称')
          }}<UiInput
            :model-value="draft?.title ?? ''"
            maxlength="160"
            required
            :disabled="busy || choosing"
            :placeholder="t('例如：我的阅读笔记')"
            @update:model-value="
              (value: string) => {
                if (draft) draft.title = value
              }
            "
        /></label>
        <label v-if="provider?.kind === 'hybrid'"
          >{{ t('读取方式')
          }}<UiSelect
            :model-value="draft?.input ?? 'remote'"
            :disabled="busy || choosing"
            :items="[
              { value: 'remote', label: t('在线来源') },
              { value: 'directory', label: t('导出目录') },
            ]"
            @update:model-value="
              (value: string) => {
                if (draft) draft.input = value as 'remote' | 'directory'
              }
            "
        /></label>
        <label v-if="controller.native && provider?.pluginId === 'repeaty-directory'"
          >{{ t('使用方式')
          }}<UiSelect
            :model-value="draft?.mode ?? 'import'"
            :disabled="!!draft?.id || busy || choosing"
            :items="[
              { value: 'import', label: t('导入副本，加入学习库') },
              { value: 'index', label: t('原地只读索引，不复制正文') },
            ]"
            @update:model-value="
              (value: string) => {
                if (draft) draft.mode = value as 'import' | 'index'
              }
            "
        /></label>
        <div v-if="needsDirectory" class="connection-directory">
          <UiButton v-if="controller.native" :disabled="busy || choosing" @click="chooseDirectory"
            ><FolderOpen :size="16" />{{
              t(draft?.directoryId ? '重新授权目录' : '选择目录')
            }}</UiButton
          >
          <template v-else>
            <UiButton :disabled="busy" @click="directoryInput?.click()"
              ><FolderOpen :size="16" />{{
                t(draft?.files?.length ? '重新选择目录' : '选择目录')
              }}</UiButton
            >
            <input
              ref="directoryInput"
              class="sr-only"
              tabindex="-1"
              type="file"
              webkitdirectory
              multiple
              :disabled="busy"
              data-testid="connection-directory"
              :aria-label="t('选择目录')"
              @change="chooseBrowserDirectory"
            />
          </template>
          <span v-if="draft?.directoryName">{{ draft.directoryName }}</span
          ><span v-else-if="draft?.directoryId">{{ t('已关联此设备的授权目录') }}</span>
          <p v-if="!controller.native" class="form-note">
            {{ t('浏览器重启后需重新选择目录。读取不会修改原始文件。') }}
          </p>
        </div>
        <template v-if="!needsDirectory">
          <label v-for="field in provider?.fields ?? []" :key="field.key"
            >{{ t(field.title)
            }}<UiSelect
              v-if="field.type === 'select'"
              :model-value="String(draft?.settings[field.key] ?? field.default ?? '')"
              :items="
                field.options?.map((option) => ({ value: option.value, label: t(option.label) })) ??
                []
              "
              :disabled="busy"
              @update:model-value="(value: string) => setField(field.key, value)" /><UiInput
              v-else
              :model-value="String(draft?.settings[field.key] ?? field.default ?? '')"
              :disabled="busy"
              @update:model-value="(value: string) => setField(field.key, value)"
          /></label>
          <p v-if="provider?.credentialHint" class="form-note">
            {{ t(provider.credentialHint) }}
            <UiButton variant="ghost" @click="emit('settings')">{{ t('打开设置') }}</UiButton>
          </p>
        </template>
        <label
          >{{ t('自动检查')
          }}<UiSelect
            :model-value="draft?.interval ?? '0'"
            :disabled="busy"
            :items="intervals.map((item) => ({ value: item.value, label: t(item.label) }))"
            @update:model-value="
              (value: string) => {
                if (draft) draft.interval = value
              }
            "
        /></label>
        <p class="form-note">{{ t('自动检查仅在软件运行时进行，发现的变化仍需你确认。') }}</p>
        <div class="form-actions">
          <UiButton :disabled="busy || choosing" @click="draft = undefined">{{
            t('取消')
          }}</UiButton
          ><UiButton
            variant="primary"
            type="submit"
            :busy="busy"
            :disabled="choosing || !draft?.title.trim()"
            >{{ t('保存连接') }}</UiButton
          >
        </div>
      </form>
    </AppModal>
    <AppModal
      v-if="disconnecting"
      :title="t('断开这个来源？')"
      :busy="busy"
      :error="error"
      @close="disconnecting = undefined"
      ><p>
        {{
          t('停止检查并释放此设备的目录授权。已导入的材料、卡片和学习记录保留，之后可以重新连接。')
        }}
      </p>
      <div class="form-actions">
        <UiButton :disabled="busy" @click="disconnecting = undefined">{{ t('取消') }}</UiButton
        ><UiButton variant="primary" :busy="busy" @click="disconnect">{{ t('确认断开') }}</UiButton>
      </div></AppModal
    >
  </section>
</template>

<style scoped>
.source-connections {
  display: grid;
  gap: 1.5rem;
}
.connections-heading,
.connection-detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}
.connections-heading h2,
.connection-detail h3 {
  margin: 0;
  font-size: var(--font-size-section);
}
.connections-heading p,
.connection-detail-heading p {
  margin: 0.4rem 0 0;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.connections-layout {
  display: grid;
  grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.connections-list,
.connection-pending {
  display: grid;
  align-content: start;
  min-width: 0;
}
.connections-list > button,
.connection-pending > button {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
  white-space: normal;
  border-radius: 0;
  padding: 0.85rem 0.75rem;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.connections-list > button[aria-pressed='true'],
.connection-pending > button[aria-pressed='true'] {
  background: var(--app-selected);
}
.connections-list span,
.connection-pending span {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.connection-detail {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.connection-detail-heading {
  flex-wrap: wrap;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--line);
}
.connection-actions,
.connection-review-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}
.connections-empty,
.connection-current {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--muted);
}
.connections-empty p,
.connection-current h3,
.connection-current p {
  margin: 0;
}
.connection-current h3 {
  color: var(--ui-text);
  font-size: var(--font-size-body);
}
.connection-changes {
  display: grid;
  gap: 1.5rem;
}
.connection-pending {
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  max-height: 13rem;
  overflow: auto;
}
.connection-review {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.connection-change-kind {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.connection-review h3 {
  margin-top: 0.3rem;
  overflow-wrap: anywhere;
}
.connection-relink {
  display: grid;
  gap: 0.5rem;
}
.connection-relink > span {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.connection-diff {
  display: grid;
  gap: 1rem;
}
.connection-diff.has-local {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.connection-diff section {
  min-width: 0;
}
.connection-diff h4 {
  margin: 0 0 0.5rem;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}
.connection-diff pre,
.connection-base pre {
  margin: 0;
  padding: 1rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-height: 24rem;
  overflow: auto;
  background: var(--app-surface-subtle);
  border: 1px solid var(--line);
  border-radius: var(--app-radius);
  font-family: var(--font-ui);
  line-height: var(--line-height-reading);
}
.connection-base summary {
  cursor: pointer;
  color: var(--muted);
  margin-bottom: 0.75rem;
}
.connection-review-actions {
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.connection-form,
.connection-form label {
  display: grid;
  gap: 0.5rem;
}
.connection-form {
  gap: 1rem;
}
.connection-directory {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
}
.connection-directory > span {
  overflow-wrap: anywhere;
}
.connection-progress {
  margin: 0;
  color: var(--muted);
}
.connection-index-search {
  display: flex;
  gap: 0.5rem;
}
.connection-index-search > :first-child {
  flex: 1;
  min-width: 0;
}
.connection-index-results,
.connection-originals ul {
  padding: 0;
  margin: 0;
  list-style: none;
}
.connection-index-results {
  max-height: 18rem;
  overflow: auto;
}
.connection-index-results button {
  width: 100%;
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 0.3rem;
  white-space: normal;
  text-align: left;
  border-radius: 0;
  padding: 0.75rem;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.connection-index-results button[aria-pressed='true'] {
  background: var(--app-selected);
}
.connection-index-results span {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.connection-index-preview > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.connection-index-preview h3 {
  overflow-wrap: anywhere;
  min-width: 0;
}
.connection-index-preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-ui);
  line-height: var(--line-height-reading);
  max-height: 30rem;
  overflow: auto;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: var(--app-radius);
  background: var(--app-surface-subtle);
}
.connection-originals summary {
  cursor: pointer;
  color: var(--muted);
}
.connection-originals li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--line);
}
.connection-originals li > span {
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .connections-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .connections-list {
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }
}
@media (max-width: 600px) {
  .connection-index-preview > header {
    align-items: flex-start;
    flex-direction: column;
  }
  .connection-diff.has-local {
    grid-template-columns: minmax(0, 1fr);
  }
  .connections-heading {
    flex-direction: column;
  }
  .connection-actions {
    justify-content: flex-start;
  }
}
</style>
