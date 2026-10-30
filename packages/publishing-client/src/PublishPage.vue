<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  AppPage,
  UiButton,
  UiInput,
  UiCheckbox,
  UiNotice,
  UiStatus,
  UiCollapsible,
  SettingField,
  pluginData,
  publishing,
  type PublishingSnapshot,
} from '@repeaty/plugin-api'
import type { Adapter, Binding, Catalog, Connection, Native, Preview, Provider } from './types'
import { createPublisher } from './engine'
import {
  authorize,
  currentScope,
  errorText,
  ledgerStore,
  loadConnection,
  native,
  t,
} from './ui-state'
import { publicMarkdown, renderMarkdown } from './render'

const props = defineProps<{
  workspaceScope: string
  provider: Provider
  createAdapter: (native: Native, connection: Connection) => Adapter
}>()
const providerLabel = props.provider === 'wordpress' ? 'WordPress' : 'Discourse'
const initial = publishing.list()
const sources = ref(initial.sources)
const storedSources = ref<{ id: string; title: string }[]>([])
const sourceId = ref('')
const title = ref('')
const category = ref('')
const tagText = ref('')
const tagFilter = ref('')
const status = ref<'draft' | 'publish' | 'private'>(
  props.provider === 'wordpress' ? 'draft' : 'publish',
)
const connection = shallowRef<Connection>()
const catalog = ref<Catalog>({ categories: [], tags: [] })
const snapshot = shallowRef<PublishingSnapshot>()
const plan = shallowRef<Preview>()
const confirmed = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const binding = ref<Binding>()
const remoteId = ref('')
let active = true
let task: AbortController | undefined
const store = ledgerStore(props.workspaceScope)
let publisher: ReturnType<typeof createPublisher> | undefined
const available = () => active && currentScope(props.workspaceScope)
const sourceItems = computed(() =>
  [
    ...sources.value,
    ...storedSources.value.filter((item) => !sources.value.some((source) => source.id === item.id)),
  ].map((item) => ({ value: item.id, label: item.title })),
)
const categories = computed(() => [
  { value: '', label: t('默认分类', 'Default category') },
  ...catalog.value.categories.map((item) => ({ value: item.id, label: item.name })),
  ...(category.value && !catalog.value.categories.some((item) => item.id === category.value)
    ? [{ value: category.value, label: `${t('分类', 'Category')} #${category.value}` }]
    : []),
])
const tags = computed(() =>
  tagText.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const tagOptions = computed(() => [
  ...catalog.value.tags.map((item) => ({ value: item.id, label: item.name })),
  ...tags.value
    .filter((id) => !catalog.value.tags.some((item) => item.id === id))
    .map((id) => ({ value: id, label: `${t('标签', 'Tag')} #${id}` })),
])
const visibleTags = computed(() =>
  tagOptions.value
    .filter(
      (item) =>
        tags.value.includes(item.value) ||
        item.label.toLocaleLowerCase().includes(tagFilter.value.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => Number(tags.value.includes(b.value)) - Number(tags.value.includes(a.value)))
    .slice(0, 80),
)
const statuses = computed(() => [
  { value: 'draft', label: t('草稿', 'Draft') },
  { value: 'publish', label: t('公开发布', 'Publish') },
  { value: 'private', label: t('仅站点作者可见', 'Private') },
])
const previewHtml = computed(() =>
  plan.value
    ? props.provider === 'wordpress'
      ? plan.value.draft.content
      : renderMarkdown(plan.value.draft.content)
    : '',
)
const stateLabel = computed(() =>
  !binding.value
    ? t('尚未发布', 'Not published')
    : binding.value.state === 'ready'
      ? t('已关联远端文章', 'Linked to remote post')
      : binding.value.state === 'deleted'
        ? t('远端已删除', 'Remote post deleted')
        : t('结果待核对', 'Needs reconciliation'),
)
const mutationLabel = computed(() =>
  plan.value?.action === 'delete'
    ? t('确认删除远端文章', 'Confirm remote deletion')
    : plan.value?.action === 'update'
      ? t('确认更新文章', 'Confirm update')
      : t('确认发送到站点', 'Confirm publishing'),
)

function release() {
  if (snapshot.value) {
    try {
      publishing.release(snapshot.value.id)
    } catch {
      /* scope already disposed */
    }
  }
  snapshot.value = undefined
  plan.value = undefined
  confirmed.value = false
}
watch([sourceId, title, category, tagText, status], release, { flush: 'sync' })
let selectionEpoch = 0
watch(
  sourceId,
  async () => {
    const epoch = ++selectionEpoch
    title.value = sources.value.find((item) => item.id === sourceId.value)?.title ?? ''
    binding.value = undefined
    try {
      if (connection.value) {
        const entry = (await store.load()).bindings[`${connection.value.site}\n${sourceId.value}`]
        if (available() && epoch === selectionEpoch) binding.value = entry
      }
    } catch (value) {
      if (available() && epoch === selectionEpoch) error.value = errorText(value)
    }
  },
  { flush: 'sync' },
)
async function run(action: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  task = new AbortController()
  try {
    await action(task.signal)
  } catch (value) {
    if (available()) error.value = errorText(value)
  } finally {
    if (available()) {
      busy.value = false
      task = undefined
    }
  }
}
async function ensureConnection() {
  const value = await loadConnection(props.workspaceScope)
  if (!value) throw new Error('credential-unavailable')
  if (!available()) throw new Error('workspace-changed')
  connection.value = value
  publisher = createPublisher(props.createAdapter(native, value), store, available)
  await authorize(value)
  if (!available()) throw new Error('workspace-changed')
  return value
}
async function prepare(remove = false) {
  await run(async (signal) => {
    if (!sourceId.value) throw new Error('no-selection')
    release()
    const value = await ensureConnection()
    const current = publishing.list()
    const ledger = await store.load()
    if (remove) {
      const prior = ledger.bindings[publisher!.key(sourceId.value)]
      if (!prior?.remote) throw new Error('remote-missing')
      plan.value = await publisher!.preview(
        {
          sourceId: sourceId.value,
          versionId: prior.sourceVersion ?? '',
          title: prior.remote.title,
          content: '',
          status: 'publish',
          category: prior.remote.category,
          tags: prior.remote.tags,
        },
        signal,
        true,
      )
      binding.value = prior
      return
    }
    const prepared = await publishing.prepare(
      { sourceIds: [sourceId.value], expectedRevision: current.revision },
      signal,
    )
    snapshot.value = prepared
    const source = prepared.sources[0]!
    const body = publicMarkdown(source, ledger, value.site)
    const draft = {
      sourceId: source.id,
      versionId: source.versionId,
      title: title.value.trim() || source.title,
      content:
        props.provider === 'wordpress' ? renderMarkdown(body, source.format === 'plain') : body,
      status: status.value,
      category: category.value,
      tags: tagText.value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }
    if (draft.title.length > 200 || draft.tags.length > 20) throw new Error('invalid-input')
    plan.value = await publisher!.preview(draft, signal, remove)
    binding.value = ledger.bindings[publisher!.key(sourceId.value)]
    await pluginData.set(
      'draft',
      {
        sourceId: sourceId.value,
        title: title.value,
        category: category.value,
        tags: tagText.value,
        status: status.value,
      },
      props.workspaceScope,
    )
    signal.throwIfAborted()
  })
}
async function apply() {
  if (
    !plan.value ||
    !confirmed.value ||
    (!snapshot.value && plan.value.action !== 'delete') ||
    !publisher
  )
    return
  const prepared = plan.value
  const snapshotId = snapshot.value?.id
  await run(async (signal) => {
    binding.value = await publisher!.apply(prepared, signal, async () => {
      if (prepared.action === 'delete') {
        if (!available()) throw new Error('workspace-changed')
      } else publishing.validate(snapshotId!)
    })
    message.value =
      prepared.action === 'delete'
        ? t(
            '远端删除已确认，本地材料保留。',
            'Remote deletion confirmed. The local material is kept.',
          )
        : t('远端文章已保存并核对。', 'The remote post was saved and verified.')
    release()
  })
  try {
    if (connection.value && available()) {
      const latest = await store.load()
      if (available())
        binding.value = latest.bindings[`${connection.value.site}\n${sourceId.value}`]
    }
  } catch (value) {
    if (available()) error.value = errorText(value)
  }
}
async function reconcile() {
  await run(async (signal) => {
    await ensureConnection()
    binding.value = await publisher!.reconcile(
      sourceId.value,
      signal,
      remoteId.value.trim() || undefined,
    )
    release()
    message.value = t(
      '已读回远端状态。重新预览可继续编辑。',
      'Remote state read back. Prepare a new preview to continue.',
    )
  })
}
async function loadCatalog() {
  await run(async (signal) => {
    const value = await ensureConnection()
    const loaded = await props.createAdapter(native, value).catalog(signal)
    await pluginData.set('catalog', { site: value.site, ...loaded }, props.workspaceScope)
    if (!available()) throw new Error('workspace-changed')
    catalog.value = loaded
    message.value = t('分类与标签已更新。', 'Categories and tags refreshed.')
  })
}
onMounted(async () => {
  try {
    const [saved, draft, cached] = await Promise.all([
      loadConnection(props.workspaceScope),
      pluginData.get('draft', props.workspaceScope),
      pluginData.get('catalog', props.workspaceScope),
    ])
    if (!available()) return
    connection.value = saved
    if (
      cached &&
      typeof cached === 'object' &&
      'site' in cached &&
      cached.site === saved?.site &&
      'categories' in cached &&
      'tags' in cached
    ) {
      const value = cached as Catalog
      if (
        [value.categories, value.tags].every(
          (items) =>
            Array.isArray(items) &&
            items.length <= 1000 &&
            items.every(
              (item) => item && typeof item.id === 'string' && typeof item.name === 'string',
            ),
        )
      )
        catalog.value = { categories: value.categories, tags: value.tags }
    }
    if (saved) {
      const ledger = await store.load()
      if (!available()) return
      storedSources.value = Object.values(ledger.bindings)
        .filter((entry) => entry.site === saved.site && entry.remote)
        .map((entry) => ({
          id: entry.sourceId,
          title: `${entry.remote!.title} · ${t('本地材料已移除', 'local material removed')}`,
        }))
    }
    if (draft && typeof draft === 'object') {
      const value = draft as Record<string, unknown>
      if (
        typeof value.sourceId === 'string' &&
        [...sources.value, ...storedSources.value].some((source) => source.id === value.sourceId)
      )
        sourceId.value = value.sourceId
      if (typeof value.title === 'string') title.value = value.title
      if (typeof value.category === 'string') category.value = value.category
      if (typeof value.tags === 'string') tagText.value = value.tags
      if (['draft', 'publish', 'private'].includes(String(value.status)))
        status.value = value.status as typeof status.value
    }
  } catch (value) {
    if (available()) error.value = errorText(value)
  }
})
onBeforeUnmount(() => {
  active = false
  task?.abort()
  release()
})
</script>

<template>
  <AppPage
    :title="`${providerLabel} ${t('发布', 'publishing')}`"
    :description="
      t(
        '选择材料，核对正文与目标后发送。已有文章会更新原文。',
        'Choose a material and review the content and destination. Existing posts update in place.',
      )
    "
  >
    <template #actions
      ><UiButton variant="secondary" :disabled="busy || !sourceId" @click="prepare()">{{
        t('准备预览', 'Prepare preview')
      }}</UiButton></template
    >
    <UiNotice v-if="!connection" tone="info">{{
      t(
        `先在设置 → 连接 → ${providerLabel} 中连接站点。`,
        `Connect a site in Settings → Connections → ${providerLabel}.`,
      )
    }}</UiNotice>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice
    ><UiNotice v-if="message" tone="success">{{ message }}</UiNotice>
    <div class="publication-layout">
      <section class="publication-form" :aria-label="t('发布选项', 'Publishing options')">
        <SettingField
          layout="stack"
          :model-value="sourceId"
          type="select"
          :options="sourceItems"
          :label="t('学习材料', 'Material')"
          :disabled="busy"
          @update:model-value="sourceId = String($event)"
        />
        <SettingField
          layout="stack"
          v-model="title"
          :label="t('文章标题', 'Post title')"
          :disabled="busy"
          :maxlength="200"
        />
        <SettingField
          layout="stack"
          v-if="provider === 'wordpress'"
          v-model="status"
          type="select"
          :label="t('发布状态', 'Post status')"
          :options="statuses"
          :disabled="busy"
        />
        <SettingField
          layout="stack"
          v-model="category"
          type="select"
          :label="t('分类', 'Category')"
          :options="categories"
          :disabled="busy"
        />
        <UiInput
          v-if="provider === 'wordpress' && tagOptions.length > 8"
          v-model="tagFilter"
          :aria-label="t('搜索站点标签', 'Search site tags')"
          :placeholder="t('按名称搜索标签', 'Search tags by name')"
          :disabled="busy"
        />
        <SettingField
          v-if="provider === 'wordpress'"
          layout="stack"
          type="multiselect"
          :model-value="tags"
          :options="visibleTags"
          :label="t('标签', 'Tags')"
          :disabled="busy || !tagOptions.length"
          :placeholder="t('选择站点标签', 'Choose site tags')"
          @update:model-value="tagText = Array.isArray($event) ? $event.join(',') : ''"
        />
        <SettingField
          v-else
          layout="stack"
          v-model="tagText"
          :label="t('标签', 'Tags')"
          :placeholder="t('标签名称，以逗号分隔', 'Tag names, separated by commas')"
          :disabled="busy"
        />
        <UiButton variant="ghost" :disabled="busy || !connection" @click="loadCatalog">{{
          t('读取站点分类与标签', 'Load site categories and tags')
        }}</UiButton>
        <div class="publication-target">
          <span class="publication-meta">{{ t('发布到', 'Destination') }}</span
          ><strong>{{ connection?.site || '—' }}</strong
          ><UiStatus
            :tone="
              binding?.state === 'unknown' || binding?.state === 'pending' ? 'warning' : 'neutral'
            "
            >{{ stateLabel }}</UiStatus
          >
        </div>
        <div v-if="binding" class="publication-management">
          <UiButton
            v-if="binding.remote"
            variant="ghost"
            :href="binding.remote.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t('在站点查看', 'View on site') }}</UiButton
          >
          <UiButton variant="secondary" :disabled="busy" @click="reconcile">{{
            t('核对远端状态', 'Reconcile remote state')
          }}</UiButton>
          <UiCollapsible>
            <UiButton variant="ghost">{{ t('通过文章 ID 核对', 'Reconcile by post ID') }}</UiButton>
            <template #content
              ><UiInput
                v-model="remoteId"
                :placeholder="t('文章或首帖 ID', 'Post or first-post ID')"
                :disabled="busy"
              /><UiButton variant="secondary" :disabled="busy || !remoteId" @click="reconcile">{{
                t('读取并验证关联', 'Read and verify link')
              }}</UiButton></template
            >
          </UiCollapsible>
          <UiButton
            variant="ghost"
            tone="again"
            :disabled="busy || binding.state !== 'ready'"
            @click="prepare(true)"
            >{{ t('删除远端文章…', 'Delete remote post…') }}</UiButton
          >
        </div>
      </section>
      <section class="publication-preview" :aria-label="t('发布预览', 'Publishing preview')">
        <template v-if="plan">
          <div class="preview-heading">
            <UiStatus>{{
              plan.action === 'delete'
                ? t('删除远端文章', 'Delete remote post')
                : plan.action === 'create'
                  ? t('新建文章', 'Create post')
                  : t('更新原文章', 'Update existing post')
            }}</UiStatus
            ><span class="publication-meta">{{ providerLabel }}</span>
          </div>
          <h2>{{ plan.draft.title }}</h2>
          <article
            v-if="plan.action !== 'delete'"
            class="publication-body markdown-content"
            v-html="previewHtml"
          />
          <UiNotice v-else tone="warning">{{
            t(
              '将删除下方已读回的远端文章。本地内容不会被发送或删除。',
              'Delete the remote post read back below. No local content is sent or deleted.',
            )
          }}</UiNotice>
          <UiCollapsible v-if="plan.previous">
            <UiButton variant="ghost">{{
              t('查看远端当前正文', 'View current remote content')
            }}</UiButton>
            <template #content>
              <pre class="remote-content">{{ plan.previous.content }}</pre>
            </template>
          </UiCollapsible>
          <footer class="publication-confirm">
            <UiCheckbox
              v-model="confirmed"
              :disabled="busy"
              :label="
                plan.action === 'delete'
                  ? t(
                      '我确认删除此远端文章及其讨论内容',
                      'I confirm deletion of this remote post and its discussion',
                    )
                  : t(
                      '已核对内容、可见范围和发布站点',
                      'I reviewed the content, visibility and destination',
                    )
              "
            />
            <div class="publication-buttons">
              <UiButton
                variant="primary"
                :tone="plan.action === 'delete' ? 'again' : undefined"
                :disabled="busy || !confirmed"
                :busy="busy"
                @click="apply"
                >{{ mutationLabel }}</UiButton
              ><UiButton v-if="busy" variant="secondary" @click="task?.abort()">{{
                t('停止等待', 'Stop waiting')
              }}</UiButton>
            </div>
          </footer>
        </template>
        <div v-else class="publication-empty">
          <h2>{{ t('发送前，先看一遍', 'Review before sending') }}</h2>
          <p>
            {{
              t(
                '这里会显示实际发送的正文、站点和新建或更新操作。发布需要再次确认。',
                'Review the exact content, destination and create/update action here, then confirm publishing.',
              )
            }}
          </p>
          <UiButton
            v-if="sourceId"
            variant="primary"
            :disabled="busy"
            :busy="busy"
            @click="prepare()"
            >{{ t('准备预览', 'Prepare preview') }}</UiButton
          ><UiButton v-if="busy" variant="secondary" @click="task?.abort()">{{
            t('停止等待', 'Stop waiting')
          }}</UiButton>
        </div>
      </section>
    </div>
  </AppPage>
</template>

<style scoped>
.publication-layout {
  display: grid;
  grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
  gap: 2rem;
  margin-top: 1.5rem;
  align-items: start;
}
.publication-form {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.publication-meta {
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
  overflow-wrap: anywhere;
}
.publication-target {
  display: grid;
  gap: 0.5rem;
  padding-block: 1.25rem;
  border-block: 1px solid var(--ui-border);
}
.publication-target strong {
  overflow-wrap: anywhere;
  font-weight: 600;
}
.publication-target > :last-child {
  justify-self: start;
}
.publication-body :deep(ol) {
  list-style: decimal;
  margin-block: 1em;
}
.publication-body :deep(ul) {
  list-style: disc;
  margin-block: 1em;
}
.publication-body :deep(li + li) {
  margin-top: 0.3em;
}
.publication-management {
  display: grid;
  gap: 0.65rem;
  justify-items: start;
}
.publication-preview {
  min-width: 0;
  min-height: 27rem;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: var(--app-radius);
  padding: 2rem;
}
.preview-heading {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.publication-preview h2 {
  font-size: var(--font-size-page);
  line-height: var(--line-height-heading);
  margin: 1.5rem 0;
  overflow-wrap: anywhere;
}
.publication-body {
  font-size: var(--font-size-reading);
  line-height: var(--line-height-reading);
  overflow-wrap: anywhere;
}
.publication-body :deep(img) {
  max-width: 100%;
  height: auto;
}
.publication-body :deep(pre) {
  overflow: auto;
  background: var(--app-code-bg);
  padding: 1rem;
  border-radius: 0.5rem;
  font-size: var(--font-size-meta);
}
.publication-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
}
.publication-body :deep(th),
.publication-body :deep(td) {
  padding: 0.5rem;
  border: 1px solid var(--ui-border);
}
.publication-confirm {
  display: grid;
  gap: 1rem;
  border-top: 1px solid var(--ui-border);
  padding-top: 1.5rem;
  margin-top: 2rem;
}
.publication-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.publication-empty {
  min-height: 22rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  max-width: 32rem;
  margin: auto;
  gap: 1rem;
}
.publication-empty h2,
.publication-empty p {
  margin: 0;
}
.publication-empty p {
  color: var(--ui-text-muted);
  line-height: 1.7;
}
.remote-content {
  max-height: 24rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--font-size-meta);
}
@media (max-width: 900px) {
  .publication-layout {
    grid-template-columns: 1fr;
  }
  .publication-preview {
    padding: 1.25rem;
    min-height: 20rem;
  }
  .publication-empty {
    min-height: 16rem;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .publication-preview article {
    animation: publication-content-in 160ms ease-out;
  }
  @keyframes publication-content-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
</style>
