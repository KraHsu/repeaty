<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AppPage,
  UiButton,
  UiCheckbox,
  UiInput,
  UiNotice,
  UiSelect,
  UiStatus,
  UiTextarea,
  SettingField,
  automation,
  pluginData,
  pluginFiles,
  readSetting,
} from '@repeaty/plugin-api'
import type { AutomationPreview, AutomationScope } from '@repeaty/plugin-api/automation'
import { profiles, provider } from './bridge'
import { ConversationController } from './controller'
import {
  emptyContext,
  safeError,
  type Message,
  type ProviderProfile,
  type Thread,
  type ThreadSummary,
} from './model'
import { SessionStore } from './store'
import { createAssistantTools } from './tools'
import { errorText, t } from './text'

const props = defineProps<{ workspaceScope: string }>()
const store = new SessionStore(
  {
    get: (id) => pluginData.get(id, props.workspaceScope),
    set: (id, value) => pluginData.set(id, value, props.workspaceScope),
  },
  pluginFiles,
)
const version = ref(0)
const sessions = ref<ThreadSummary[]>([])
const current = ref<Thread>()
const connections = ref<ProviderProfile[]>([])
const filter = ref('active')
const search = ref('')
const error = ref('')
const loading = ref(true)
const attaching = ref(false)
const providerUnavailable = ref(false)
const scopeOpen = ref(false)
const scopeKind = ref('sources')
const scopeSources = ref<string[]>([])
const scopeFolders = ref<string[]>([])
const scopeWrite = ref(false)
const scopeSelection = ref('')
const scopeBusy = ref(false)
const authorized = ref(false)
const metadata = ref<{
  sources: { id: string; title: string; folderId?: string }[]
  folders: { id: string; name: string }[]
  selection?: { sourceId: string; text: string }
}>({ sources: [], folders: [] })
const composer = ref('')
const messagesElement = ref<HTMLElement>()
const imageInput = ref<HTMLInputElement>()
let alive = true
let saveTimer: ReturnType<typeof setTimeout> | undefined
let openSequence = 0
const controller = new ConversationController(
  store,
  provider,
  createAssistantTools(automation),
  () => {
    version.value++
    if (current.value && !controller.busy) composer.value = current.value.draft
    void scroll()
  },
)
const thread = computed(() => {
  void version.value
  return current.value
})
const busy = computed(() => {
  void version.value
  return controller.busy || attaching.value
})
const visibleSessions = computed(() =>
  sessions.value.filter(
    (item) =>
      item.status === filter.value &&
      item.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
  ),
)
const visibleMessages = computed(
  () => thread.value?.messages.filter((message) => message.role !== 'tool') ?? [],
)
const profileOptions = computed(() =>
  connections.value.map((item) => ({
    value: item.id,
    label: `${item.name}${item.model ? ` · ${item.model}` : ''}`,
  })),
)
const sourceOptions = computed(() =>
  metadata.value.sources.map((item) => ({ value: item.id, label: item.title })),
)
const folderOptions = computed(() =>
  metadata.value.folders.map((item) => ({ value: item.id, label: item.name })),
)
const scopeKinds = computed(() => [
  { value: 'sources', label: t('所选材料', 'Selected materials') },
  { value: 'folders', label: t('所选目录', 'Selected folders') },
  { value: 'all', label: t('整个学习库', 'Entire library') },
])
const filterOptions = computed(() => [
  { value: 'active', label: t('最近对话', 'Recent conversations') },
  { value: 'archived', label: t('已归档', 'Archived') },
  { value: 'deleted', label: t('已删除', 'Deleted') },
])
const canSend = computed(
  () =>
    !!thread.value &&
    thread.value.status === 'active' &&
    !busy.value &&
    !scopeBusy.value &&
    connections.value.some((item) => item.id === thread.value?.providerId) &&
    (!!composer.value.trim() || !!thread.value.draftImages.length) &&
    (!thread.value.context.label || authorized.value),
)
const statusLabel = (status: string) =>
  ({
    pending: t('待确认', 'Awaiting review'),
    applied: t('已应用', 'Applied'),
    rejected: t('已忽略', 'Dismissed'),
    failed: t('未完成', 'Not completed'),
  })[status] ?? status
const commandLabel = (kind: string) =>
  ({
    'source.create': t('新增材料', 'Create material'),
    'source.patch': t('修改材料', 'Edit material'),
    'source.archive': t('归档材料', 'Archive material'),
    'source.restore': t('恢复材料', 'Restore material'),
    'source.move': t('移动材料', 'Move material'),
    'folder.create': t('新建目录', 'Create folder'),
    'folder.patch': t('重命名目录', 'Rename folder'),
    'folder.move': t('移动目录', 'Move folder'),
    'folder.remove': t('移除目录', 'Remove folder'),
    'collection.create': t('新建引用集合', 'Create reference collection'),
    'collection.patch': t('重命名引用集合', 'Rename reference collection'),
    'collection.members': t('调整集合引用', 'Change collection references'),
    'collection.reorder': t('调整引用顺序', 'Reorder references'),
    'collection.archive': t('归档引用集合', 'Archive reference collection'),
    'collection.restore': t('恢复引用集合', 'Restore reference collection'),
    'note.create': t('新增制卡内容', 'Create card content'),
    'note.patch': t('修改制卡内容', 'Edit card content'),
    'note.move': t('移动制卡内容', 'Move card content'),
    'note.tags': t('调整标签', 'Change tags'),
    'note.remove': t('移除制卡内容', 'Remove card content'),
    'deck.create': t('新建卡组', 'Create deck'),
    'deck.patch': t('修改卡组', 'Edit deck'),
    'history.undo': t('撤销上次修改', 'Undo last change'),
    'history.redo': t('重做上次修改', 'Redo last change'),
    'retired.restore': t('恢复已移除制卡内容', 'Restore retired card content'),
    'checkpoint.restore': t('恢复检查点', 'Restore checkpoint'),
  })[kind] ?? t('修改学习内容', 'Change learning content')
const preview = (value: unknown) => value as AutomationPreview
const commandDetails = (command: unknown) => {
  const result: { name: string; text: string }[] = []
  const record = command as Record<string, unknown>
  for (const [name, value] of Object.entries(record)) {
    if (name === 'kind' || name === 'versionId' || value === undefined) continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, item] of Object.entries(value))
        result.push({ name: key, text: typeof item === 'string' ? item : JSON.stringify(item) })
    } else result.push({ name, text: typeof value === 'string' ? value : JSON.stringify(value) })
  }
  return result
}
const detailLabel = (name: string) =>
  ({
    title: t('标题', 'Title'),
    name: t('名称', 'Name'),
    body: t('正文', 'Content'),
    front: t('问题', 'Question'),
    back: t('答案', 'Answer'),
    tags: t('标签', 'Tags'),
    description: t('说明', 'Description'),
    folderId: t('目录', 'Folder'),
    sourceId: t('材料', 'Material'),
    deckId: t('卡组', 'Deck'),
    collectionId: t('引用集合', 'Reference collection'),
    sourceIds: t('引用材料', 'Referenced materials'),
    noteId: t('笔记', 'Note'),
    noteIds: t('所选笔记', 'Selected notes'),
    parentId: t('上级目录', 'Parent folder'),
    parentSourceId: t('所属材料', 'Parent material'),
    beforeId: t('放在此条目之前', 'Place before this item'),
    checkpointId: t('检查点', 'Checkpoint'),
    add: t('添加', 'Add'),
    remove: t('移除', 'Remove'),
    type: t('笔记类型', 'Note type'),
    format: t('内容格式', 'Content format'),
    url: t('来源链接', 'Source URL'),
    color: t('卡组颜色', 'Deck color'),
    studyPriority: t('学习优先级', 'Study priority'),
    desiredRetention: t('目标记忆率', 'Target retention'),
    newLimit: t('新卡上限', 'New card limit'),
    reviewLimit: t('复习上限', 'Review limit'),
    burySiblings: t('当天暂缓同源卡片', 'Bury sibling cards for today'),
    leechThreshold: t('易忘卡阈值', 'Leech threshold'),
    frontMedia: t('问题附件', 'Question attachments'),
    backMedia: t('答案附件', 'Answer attachments'),
    allowRemove: t('允许移除生成变体', 'Allow removing generated variants'),
  })[name] ?? name

const fieldSummary = (command: unknown) =>
  commandDetails(command)
    .filter(
      (detail) =>
        !['sourceId', 'folderId', 'collectionId', 'noteId', 'checkpointId'].includes(detail.name),
    )
    .map((detail) => detailLabel(detail.name))
    .join('、')
const toolActivity = (name: string) =>
  name === 'library_read'
    ? t('请求读取学习内容', 'Requested learning content')
    : t('准备修改建议', 'Prepared a change proposal')
async function scroll() {
  await nextTick()
  const element = messagesElement.value
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 220)
    element.scrollTop = element.scrollHeight
}
async function refresh() {
  const result = await store.list()
  if (alive) sessions.value = result
}
async function persist() {
  if (!current.value) return
  try {
    await store.save(current.value)
    if (alive) await refresh()
  } catch {
    if (alive) error.value = errorText('storage')
  }
}
function revoke() {
  automation.revoke()
  authorized.value = false
}
function editScope() {
  metadata.value = automation.context()
  scopeOpen.value = !scopeOpen.value
  const context = current.value?.context
  scopeSources.value = [...(context?.sourceIds ?? [])]
  scopeFolders.value = [...(context?.folderIds ?? [])]
  scopeKind.value = context?.all ? 'all' : context?.folderIds.length ? 'folders' : 'sources'
  scopeSelection.value = context?.selection ?? ''
}
async function authorize() {
  if (!current.value || scopeBusy.value) return
  scopeBusy.value = true
  error.value = ''
  try {
    const scope: AutomationScope =
      scopeKind.value === 'all'
        ? { kind: 'all' }
        : scopeKind.value === 'folders'
          ? { kind: 'folders', folderIds: [...scopeFolders.value] }
          : { kind: 'sources', sourceIds: [...scopeSources.value] }
    await automation.authorize({ scope, write: scopeWrite.value })
    if (!alive) return
    const label =
      scope.kind === 'all'
        ? t('整个学习库', 'Entire library')
        : scope.kind === 'folders'
          ? scope.folderIds
              .map((id) => metadata.value.folders.find((item) => item.id === id)?.name ?? id)
              .join('、')
          : scope.sourceIds
              .map((id) => metadata.value.sources.find((item) => item.id === id)?.title ?? id)
              .join('、')
    current.value.context = {
      ...emptyContext(),
      all: scope.kind === 'all',
      sourceIds: scope.kind === 'sources' ? scope.sourceIds : [],
      folderIds: scope.kind === 'folders' ? scope.folderIds : [],
      label,
      selection: scopeSelection.value,
    }
    authorized.value = true
    scopeOpen.value = false
    version.value++
    await persist()
  } catch (value) {
    if (alive) error.value = errorText(safeError(value))
  } finally {
    if (alive) scopeBusy.value = false
  }
}
async function clearScope() {
  revoke()
  if (current.value) current.value.context = emptyContext()
  scopeOpen.value = false
  version.value++
  await persist()
}
async function open(id: string) {
  if (busy.value || scopeBusy.value) return
  const sequence = ++openSequence
  await persist()
  try {
    const result = await store.load(id)
    if (!alive || sequence !== openSequence) return
    revoke()
    current.value = result
    composer.value = result.draft
    scopeOpen.value = false
    error.value = ''
  } catch {
    if (alive) error.value = errorText('storage')
  }
}
async function create(continued = false) {
  if (busy.value || scopeBusy.value) return
  await persist()
  revoke()
  const result =
    continued && current.value
      ? store.continue(current.value)
      : store.create(
          connections.value.find((item) => item.id === readSetting('default-profile'))?.id ??
            connections.value[0]?.id ??
            '',
        )
  current.value = result
  composer.value = result.draft
  filter.value = 'active'
  error.value = ''
  scopeOpen.value = false
  await persist()
}
async function changeStatus(status: Thread['status']) {
  if (!current.value || busy.value) return
  current.value.status = status
  version.value++
  await persist()
}
async function send() {
  if (!canSend.value || !current.value) return
  const selected = connections.value.find((item) => item.id === current.value?.providerId)
  if (!selected) return
  current.value.draft = composer.value
  const pending = controller.send(current.value, selected)
  composer.value = ''
  await pending
  if (alive) {
    composer.value = current.value.draft
    await refresh()
  }
}
function submitKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || event.shiftKey || event.key !== 'Enter') return
  event.preventDefault()
  void send()
}
async function attach(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!current.value || busy.value) return
  attaching.value = true
  try {
    if (current.value.draftImages.length + files.length > 3) {
      error.value = t('每条消息最多附加 3 张图片。', 'Attach up to 3 images per message.')
      return
    }
    for (const file of files) current.value.draftImages.push(await store.addImage(file))
    version.value++
    await persist()
  } catch {
    if (alive)
      error.value = t(
        '图片未保存。请选择不超过 3 MB 的 PNG、JPEG 或 WebP。',
        'Image not saved. Choose a PNG, JPEG or WebP up to 3 MB.',
      )
  } finally {
    if (alive) attaching.value = false
  }
}
async function dismiss(message: Message, id: string) {
  const proposal = message.proposals?.find((item) => item.id === id)
  if (proposal) {
    proposal.status = 'rejected'
    version.value++
    await persist()
  }
}
function selectProfile(value: string) {
  if (!current.value || busy.value) return
  current.value.providerId = value
  current.value.providerThreadId = undefined
  version.value++
  void persist()
}
function useReadingSelection() {
  if (!metadata.value.selection) return
  scopeSelection.value = metadata.value.selection.text
  scopeSources.value = [metadata.value.selection.sourceId]
  scopeKind.value = 'sources'
}
function clearImages() {
  if (!current.value || busy.value) return
  current.value.draftImages = []
  version.value++
  void persist()
}
watch(composer, (value) => {
  if (!current.value || busy.value) return
  current.value.draft = value
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persist()
  }, 500)
})
onMounted(async () => {
  try {
    await refresh()
    const latest = sessions.value.find((item) => item.status === 'active')
    if (latest) await open(latest.id)
    try {
      const result = await profiles.list()
      if (alive) connections.value = result
    } catch {
      if (alive) providerUnavailable.value = true
    }
    if (alive && !current.value) await create()
  } catch {
    if (alive) error.value = errorText('storage')
  } finally {
    if (alive) loading.value = false
  }
})
onBeforeUnmount(() => {
  alive = false
  openSequence++
  if (saveTimer) clearTimeout(saveTimer)
  if (current.value && !busy.value) void store.save(current.value).catch(() => {})
  controller.dispose()
  revoke()
})
</script>

<template>
  <AppPage
    class="assistant-page"
    :title="t('学习助手', 'Learning assistant')"
    :description="
      t(
        '围绕学习内容提问，检查建议，再决定要修改什么。',
        'Ask about your learning material, review suggestions and decide what to change.',
      )
    "
  >
    <template #actions
      ><UiButton :disabled="busy || scopeBusy || loading" @click="create()">{{
        t('新建对话', 'New conversation')
      }}</UiButton></template
    >
    <UiNotice v-if="providerUnavailable" tone="info">{{
      t(
        '模型连接需要桌面版。现有对话和草稿仍可查看。',
        'Model connections require the desktop app. Existing conversations and drafts remain available.',
      )
    }}</UiNotice>
    <UiNotice v-else-if="!connections.length && !loading" tone="info">{{
      t(
        '请先在设置 → 连接 → 学习助手中添加模型连接。',
        'Add a model connection in Settings → Connections → Learning assistant.',
      )
    }}</UiNotice>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
    <div v-if="!loading && thread" class="assistant-layout">
      <aside class="assistant-sessions" :aria-label="t('对话记录', 'Conversations')">
        <UiSelect
          v-model="filter"
          :items="filterOptions"
          :aria-label="t('会话分类', 'Conversation category')"
        />
        <UiInput
          v-model="search"
          type="search"
          :placeholder="t('搜索对话', 'Search conversations')"
          :aria-label="t('搜索对话', 'Search conversations')"
        />
        <div class="assistant-session-list">
          <UiButton
            v-for="session in visibleSessions"
            :key="session.id"
            variant="ghost"
            class="assistant-session"
            :class="{ 'is-selected': session.id === thread.id }"
            :aria-current="session.id === thread.id ? 'page' : undefined"
            :disabled="busy || scopeBusy"
            @click="open(session.id)"
            ><span>{{ session.title || t('新对话', 'New conversation') }}</span></UiButton
          >
          <p v-if="!visibleSessions.length" class="assistant-muted">
            {{ t('这里还没有对话。', 'No conversations here yet.') }}
          </p>
        </div>
      </aside>
      <section
        class="assistant-conversation"
        :aria-label="thread.title || t('新对话', 'New conversation')"
      >
        <header class="assistant-toolbar">
          <UiSelect
            :model-value="thread.providerId"
            :items="profileOptions"
            :disabled="busy"
            :placeholder="t('选择模型连接', 'Choose a model connection')"
            :aria-label="t('模型连接', 'Model connection')"
            @update:model-value="selectProfile"
          />
          <div class="assistant-thread-actions">
            <UiButton
              v-if="thread.status === 'active'"
              variant="ghost"
              :disabled="busy"
              @click="changeStatus('archived')"
              >{{ t('归档', 'Archive') }}</UiButton
            >
            <UiButton v-else variant="secondary" :disabled="busy" @click="changeStatus('active')">{{
              t('恢复对话', 'Restore conversation')
            }}</UiButton>
            <UiButton variant="ghost" :disabled="busy" @click="create(true)">{{
              t('另开续聊', 'Continue in new chat')
            }}</UiButton>
            <UiButton
              v-if="thread.status !== 'deleted'"
              variant="ghost"
              :disabled="busy"
              @click="changeStatus('deleted')"
              >{{ t('删除', 'Delete') }}</UiButton
            >
          </div>
        </header>
        <div class="assistant-scope-summary">
          <span
            >{{ t('内容范围', 'Content scope') }}
            <strong>{{
              thread.context.label ||
              t('仅对话，不读取学习库', 'Conversation only; no library access')
            }}</strong></span
          >
          <UiStatus v-if="thread.context.label" :tone="authorized ? 'success' : 'neutral'">{{
            authorized ? t('已授权', 'Authorized') : t('需要授权', 'Authorization required')
          }}</UiStatus>
          <UiButton
            variant="ghost"
            :disabled="busy || scopeBusy"
            :aria-expanded="scopeOpen"
            @click="editScope"
            >{{ t('选择范围', 'Choose scope') }}</UiButton
          >
        </div>
        <div v-if="scopeOpen" class="assistant-scope-editor">
          <SettingField
            v-model="scopeKind"
            type="select"
            :label="t('访问范围', 'Access scope')"
            :options="scopeKinds"
            :disabled="scopeBusy"
          />
          <SettingField
            v-if="scopeKind === 'sources'"
            v-model="scopeSources"
            type="multiselect"
            :label="t('材料', 'Materials')"
            :options="sourceOptions"
            :disabled="scopeBusy"
          />
          <SettingField
            v-if="scopeKind === 'folders'"
            v-model="scopeFolders"
            type="multiselect"
            :label="t('目录', 'Folders')"
            :options="folderOptions"
            :disabled="scopeBusy"
          />
          <SettingField
            v-model="scopeSelection"
            type="textarea"
            :label="t('附带选区', 'Selected passage')"
            :placeholder="
              t('可选：粘贴希望重点讨论的文字', 'Optional: paste the passage you want to discuss')
            "
            :rows="2"
            :maxlength="12000"
            :disabled="scopeBusy"
          />
          <UiButton
            v-if="metadata.selection"
            variant="ghost"
            :disabled="scopeBusy"
            @click="useReadingSelection"
            >{{ t('使用当前阅读选区', 'Use current reading selection') }}</UiButton
          >
          <UiCheckbox
            v-model="scopeWrite"
            :label="
              t(
                '允许提出修改建议（应用前仍需确认）',
                'Allow change proposals (confirmation required before applying)',
              )
            "
            :disabled="scopeBusy"
          />
          <div class="assistant-inline-actions">
            <UiButton
              :busy="scopeBusy"
              :disabled="
                scopeBusy ||
                (scopeKind === 'sources' && !scopeSources.length) ||
                (scopeKind === 'folders' && !scopeFolders.length)
              "
              @click="authorize"
              >{{ t('授权访问', 'Authorize access') }}</UiButton
            ><UiButton variant="ghost" :disabled="scopeBusy" @click="clearScope">{{
              t('清除范围', 'Clear scope')
            }}</UiButton>
          </div>
        </div>
        <div
          ref="messagesElement"
          class="assistant-messages"
          :aria-busy="busy"
          role="log"
          :aria-label="t('消息', 'Messages')"
          aria-live="polite"
          aria-relevant="additions"
        >
          <div v-if="!visibleMessages.length" class="assistant-empty">
            <h2>{{ t('从一个问题开始', 'Start with a question') }}</h2>
            <p>
              {{
                t(
                  '选择材料，让助手解释概念、梳理知识关系或准备复习卡片。',
                  'Select material to explain concepts, connect ideas or prepare flashcards.',
                )
              }}
            </p>
          </div>
          <article
            v-for="message in visibleMessages"
            :key="message.id"
            class="assistant-message"
            :class="`assistant-message-${message.role}`"
          >
            <div class="assistant-message-author">
              {{ message.role === 'user' ? t('你', 'You') : t('学习助手', 'Learning assistant')
              }}<UiStatus v-if="message.status === 'running'">{{
                t('正在回复', 'Responding')
              }}</UiStatus>
            </div>
            <div v-if="message.text" class="assistant-message-text">{{ message.text }}</div>
            <ul v-if="message.images?.length" class="assistant-attachments">
              <li v-for="attachment in message.images" :key="attachment.id">
                {{ attachment.name }}
              </li>
            </ul>
            <div v-if="message.toolCalls?.length" class="assistant-tool-summary">
              <span
                v-for="name in [...new Set(message.toolCalls.map((call) => call.name))]"
                :key="name"
                >{{ toolActivity(name) }}</span
              >
            </div>
            <section
              v-for="proposal in message.proposals"
              :key="proposal.id"
              class="assistant-proposal"
            >
              <header>
                <h3>{{ proposal.title }}</h3>
                <UiStatus :tone="proposal.status === 'applied' ? 'success' : 'neutral'">{{
                  statusLabel(proposal.status)
                }}</UiStatus>
              </header>
              <ul class="assistant-change-list">
                <li
                  v-for="(command, index) in preview(proposal.preview).request.commands"
                  :key="index"
                >
                  {{ commandLabel(command.kind)
                  }}<template v-if="fieldSummary(command)"> · {{ fieldSummary(command) }}</template>
                </li>
              </ul>
              <details class="assistant-change-details">
                <summary>{{ t('查看具体修改', 'Review exact changes') }}</summary>
                <div
                  v-for="(command, index) in preview(proposal.preview).request.commands"
                  :key="index"
                  class="assistant-change"
                >
                  <strong>{{ commandLabel(command.kind) }}</strong>
                  <dl>
                    <template
                      v-for="(detail, detailIndex) in commandDetails(command)"
                      :key="detailIndex"
                      ><dt>{{ detailLabel(detail.name) }}</dt>
                      <dd>{{ detail.text }}</dd></template
                    >
                  </dl>
                </div>
              </details>
              <div
                v-if="proposal.status === 'pending' || proposal.status === 'failed'"
                class="assistant-inline-actions"
              >
                <UiButton
                  variant="primary"
                  :disabled="busy || !authorized"
                  @click="controller.apply(thread, message, proposal.id)"
                  >{{
                    proposal.status === 'failed'
                      ? t('核对结果并重试', 'Check result and retry')
                      : t('确认并应用', 'Confirm and apply')
                  }}</UiButton
                ><UiButton
                  variant="ghost"
                  :disabled="busy"
                  @click="dismiss(message, proposal.id)"
                  >{{ t('忽略建议', 'Dismiss') }}</UiButton
                >
              </div>
              <UiNotice v-if="proposal.error" tone="error">{{
                errorText(proposal.error)
              }}</UiNotice>
            </section>
          </article>
        </div>
        <UiNotice v-if="thread.error" :tone="thread.error === 'interrupted' ? 'info' : 'error'">{{
          errorText(thread.error)
        }}</UiNotice>
        <form v-if="thread.status === 'active'" class="assistant-composer" @submit.prevent="send">
          <p
            v-if="
              thread.contextUsage &&
              (thread.contextUsage.messages < thread.contextUsage.totalMessages ||
                thread.contextUsage.images < thread.contextUsage.totalImages ||
                thread.contextUsage.clippedMessages)
            "
            class="assistant-context-budget"
          >
            {{
              t(
                `本轮发送最近 ${thread.contextUsage.messages}/${thread.contextUsage.totalMessages} 条消息、${thread.contextUsage.images}/${thread.contextUsage.totalImages} 张图片。完整记录仍保存在本地；较早内容或图片可重新发送。`,
                `This request uses ${thread.contextUsage.messages}/${thread.contextUsage.totalMessages} recent messages and ${thread.contextUsage.images}/${thread.contextUsage.totalImages} images. Full history remains stored locally; resend older context when needed.`,
              )
            }}
          </p>
          <UiTextarea
            v-model="composer"
            :rows="3"
            :maxlength="32000"
            :disabled="busy"
            :placeholder="
              t(
                '输入问题，Enter 发送，Shift + Enter 换行',
                'Ask a question. Enter to send, Shift + Enter for a new line',
              )
            "
            :aria-label="t('消息草稿', 'Message draft')"
            @keydown="submitKey"
          />
          <div class="assistant-composer-footer">
            <div class="assistant-inline-actions">
              <UiButton
                type="button"
                variant="ghost"
                :disabled="busy || thread.draftImages.length >= 3"
                @click="imageInput?.click()"
                >{{ t('附加图片', 'Attach images') }}</UiButton
              ><span v-if="thread.draftImages.length" class="assistant-muted">{{
                thread.draftImages.map((image) => image.name).join('、')
              }}</span
              ><UiButton
                v-if="thread.draftImages.length"
                type="button"
                variant="ghost"
                :disabled="busy"
                @click="clearImages"
                >{{ t('移除图片', 'Remove images') }}</UiButton
              >
            </div>
            <UiButton v-if="busy" type="button" variant="secondary" @click="controller.cancel()">{{
              t('停止', 'Stop')
            }}</UiButton
            ><UiButton v-else type="submit" variant="primary" :disabled="!canSend">{{
              t('发送', 'Send')
            }}</UiButton>
          </div>
          <input
            ref="imageInput"
            type="file"
            class="assistant-file-input"
            accept="image/png,image/jpeg,image/webp"
            multiple
            tabindex="-1"
            aria-hidden="true"
            @change="attach"
          />
        </form>
      </section>
    </div>
    <p v-else class="assistant-muted">{{ t('正在读取对话…', 'Loading conversations…') }}</p>
  </AppPage>
</template>

<style scoped>
.assistant-layout {
  display: grid;
  grid-template-columns: 14rem minmax(0, 1fr);
  min-height: 34rem;
  height: max(34rem, calc(100dvh - 15rem));
  gap: 1.5rem;
}
.assistant-sessions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  padding-right: 1.25rem;
  border-right: 1px solid var(--line);
}
.assistant-session-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.assistant-session {
  justify-content: flex-start;
  text-align: left;
  width: 100%;
  min-height: 2.75rem;
  white-space: normal;
}
.assistant-session span {
  overflow-wrap: anywhere;
}
.assistant-session.is-selected {
  background: var(--app-selected);
  color: var(--app-nav-ink);
}
.assistant-conversation {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.assistant-toolbar,
.assistant-thread-actions,
.assistant-scope-summary,
.assistant-inline-actions,
.assistant-composer-footer,
.assistant-proposal header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.assistant-toolbar,
.assistant-composer-footer,
.assistant-proposal header {
  justify-content: space-between;
}
.assistant-toolbar {
  padding-bottom: 0.75rem;
}
.assistant-toolbar > :first-child {
  min-width: 12rem;
  width: 18rem;
  max-width: 26rem;
  flex: 1 1 16rem;
}
.assistant-scope-summary {
  padding: 0.75rem 0;
  border-block: 1px solid var(--line);
  font-size: var(--font-size-meta);
}
.assistant-scope-summary > span:first-child {
  flex: 1;
  min-width: 10rem;
  color: var(--muted);
}
.assistant-scope-summary strong {
  color: var(--ink);
  font-weight: var(--font-weight-medium);
  margin-left: 0.5rem;
  overflow-wrap: anywhere;
}
.assistant-scope-editor {
  padding: 1rem;
  overflow-y: auto;
  max-height: 25rem;
  background: var(--app-surface-subtle);
  display: grid;
  gap: 0.75rem;
  border-bottom: 1px solid var(--line);
}
.assistant-messages {
  flex: 1;
  min-height: 8rem;
  overflow-y: auto;
  padding: 1.5rem 0.75rem 1.5rem 0;
  scroll-behavior: auto;
}
.assistant-empty {
  margin: 4rem auto;
  max-width: 30rem;
  text-align: center;
}
.assistant-empty h2 {
  font-size: var(--font-size-section);
  font-weight: var(--font-weight-semibold);
  margin-bottom: 0.75rem;
}
.assistant-empty p,
.assistant-muted,
.assistant-tool-summary {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.assistant-message {
  max-width: 52rem;
  margin: 0 auto 1.75rem;
  animation: assistant-message-in 180ms ease-out;
}
.assistant-message-user {
  background: var(--app-surface-subtle);
  border-radius: var(--app-radius);
  padding: 1rem 1.25rem;
}
.assistant-message-author {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  font-size: var(--font-size-meta);
  color: var(--muted);
  font-weight: var(--font-weight-semibold);
}
.assistant-message-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-body);
  line-height: var(--line-height-reading);
}
.assistant-tool-summary {
  margin-top: 0.75rem;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.assistant-context-budget {
  color: var(--muted);
  font-size: var(--font-size-meta);
  margin-bottom: 0.5rem;
}
.assistant-proposal {
  border: 1px solid var(--line);
  border-radius: var(--app-radius);
  margin-top: 1rem;
  padding: 1rem;
}
.assistant-proposal h3 {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}
.assistant-change-list,
.assistant-attachments {
  margin: 0.75rem 0;
  padding-left: 1.25rem;
  font-size: var(--font-size-meta);
  overflow-wrap: anywhere;
}
.assistant-change-details {
  margin-bottom: 1rem;
}
.assistant-change-details summary {
  cursor: pointer;
  color: var(--app-nav-ink);
  padding: 0.4rem 0;
}
.assistant-change {
  border-top: 1px solid var(--line);
  padding: 0.75rem 0;
}
.assistant-change dl {
  display: grid;
  grid-template-columns: minmax(4rem, auto) minmax(0, 1fr);
  gap: 0.5rem 1rem;
  margin: 0.75rem 0 0;
}
.assistant-change dt {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.assistant-change dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 18rem;
  overflow-y: auto;
}
.assistant-composer {
  border-top: 1px solid var(--line);
  padding-top: 0.75rem;
}
.assistant-composer > :first-child {
  width: 100%;
}
.assistant-composer-footer {
  margin-top: 0.5rem;
}
.assistant-composer-footer .assistant-inline-actions {
  flex: 1;
  min-width: 0;
}
.assistant-composer-footer .assistant-muted {
  overflow-wrap: anywhere;
}
.assistant-file-input {
  display: none;
}
@keyframes assistant-message-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 900px) {
  .assistant-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    height: auto;
  }
  .assistant-sessions {
    border: 0;
    padding: 0 0 0.75rem;
    border-bottom: 1px solid var(--line);
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .assistant-session-list {
    grid-column: 1 / -1;
    max-height: 7rem;
  }
  .assistant-conversation {
    min-height: 35rem;
  }
  .assistant-messages {
    max-height: 60dvh;
  }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-message {
    animation: none;
  }
}
</style>
