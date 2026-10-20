<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t, type DisplayMessage } from '../i18n'
import { remoteWorkspace } from '../edition'
import type { SourceExcerpt } from '../core/source-data'
import type { MediaUpload, NoteInput } from '../core/model'
import type { CardDraft } from '../core/draft-proposals'
import { draftSession, type DraftWorkspace } from './drafts'
import { mcpStatus } from './mcp'
import McpSettings from './McpSettings.vue'
import AppModal from '../components/AppModal.vue'
import NoteEditor from '../components/NoteEditor.vue'

const props = defineProps<{ workspace: DraftWorkspace; selection?: SourceExcerpt }>()
const emit = defineEmits<{ closeSelection: [] }>()
const queueOpen = ref(false),
  editing = ref<CardDraft>(),
  deckId = ref(''),
  sharing = ref(false),
  error = ref<DisplayMessage>(''),
  shareError = ref<DisplayMessage>('')
const library = computed(() => props.workspace.library.value)
const source = computed(() =>
  library.value.sources.find((source) => source.id === props.selection?.sourceId),
)
const count = computed(() => draftSession.drafts.length)
const context = () => ({ library: library.value, scope: props.workspace.scope.value, revision: 0 })
const typeLabel = (type: string) =>
  t(type === 'basic' ? '正反面' : type === 'reversed' ? '双向卡' : '挖空卡')

watch(
  () => props.selection,
  (selection) => {
    shareError.value = ''
    if (!selection) return
    queueOpen.value = false
    editing.value = undefined
    deckId.value = library.value.decks[0]?.id ?? ''
  },
)
watch(
  () => props.workspace.scope.value,
  () => {
    queueOpen.value = false
    editing.value = undefined
    emit('closeSelection')
  },
)
watch(
  library,
  () => {
    if (draftSession.selection && !draftSession.valid(context(), draftSession.selection))
      draftSession.revoke()
  },
  { flush: 'sync' },
)
function displayError(issue: unknown): DisplayMessage {
  return issue instanceof Error &&
    !['selection-unavailable', 'library-unavailable'].includes(issue.message)
    ? issue
    : '材料或学习库已变化，请重新选取摘录。'
}
function openQueue() {
  queueOpen.value = true
  error.value = ''
}
function closeEditor() {
  editing.value = undefined
  error.value = ''
}
async function share() {
  if (!props.selection || !source.value || !mcpStatus.value.enabled || sharing.value) return
  const selected = props.selection,
    mediaId = source.value.mediaId,
    scope = props.workspace.scope.value
  sharing.value = true
  shareError.value = ''
  try {
    const text = await props.workspace.getSource(selected.sourceId)
    draftSession.share(
      props.workspace.localLearningSnapshot(scope),
      selected,
      deckId.value,
      mediaId,
      text,
    )
    emit('closeSelection')
    queueOpen.value = true
  } catch (issue) {
    shareError.value = displayError(issue)
  } finally {
    sharing.value = false
  }
}
function openDraft(id: string) {
  error.value = ''
  try {
    editing.value = draftSession.getDraft(
      props.workspace.localLearningSnapshot(props.workspace.scope.value),
      id,
    )
  } catch (issue) {
    error.value = displayError(issue)
  }
}
async function save(input: NoteInput, uploads: MediaUpload[], allowRemove: boolean) {
  if (!editing.value) return false
  error.value = ''
  try {
    const draft = draftSession.getDraft(
      props.workspace.localLearningSnapshot(editing.value.scope),
      editing.value.id,
    )
    await props.workspace.saveExcerptNote(input, draft.excerpt, draft.scope, uploads, allowRemove)
    draftSession.discard(draft.id)
    return true
  } catch (issue) {
    error.value = displayError(issue)
    return false
  }
}
</script>

<template>
  <button
    v-if="!remoteWorkspace && (count || draftSession.selection)"
    class="text-button"
    @click="openQueue"
  >
    {{ t('制卡草稿（{count}）', { count }) }}
  </button>
  <AppModal
    v-if="selection && !remoteWorkspace"
    wide
    :title="t('通过 MCP 制卡')"
    :busy="sharing"
    :error="shareError ? t(shareError) : undefined"
    @close="emit('closeSelection')"
  >
    <form class="draft-share" @submit.prevent="share">
      <p class="form-note">
        {{ t('将这段摘录分享给已连接的客户端，供它生成制卡草稿。草稿保存前由你确认。') }}
      </p>
      <p class="form-note">{{ source?.title }}</p>
      <blockquote class="draft-quote">{{ selection.quote }}</blockquote>
      <label class="form-field" for="draft-deck"
        >{{ t('草稿默认卡组') }}
        <select id="draft-deck" v-model="deckId" :disabled="sharing">
          <option v-for="deck in library.decks" :key="deck.id" :value="deck.id">
            {{ deck.name }}
          </option>
        </select>
      </label>
      <p class="form-note">
        {{ t('客户端可能将摘录发送给它使用的模型服务。请确认选区中包含的内容。') }}
      </p>
      <McpSettings />
      <div class="form-actions">
        <button
          class="button secondary"
          type="button"
          :disabled="sharing"
          @click="emit('closeSelection')"
        >
          {{ t('取消') }}
        </button>
        <button
          class="button primary"
          :disabled="sharing || !deckId || !mcpStatus.enabled || !mcpStatus.available"
        >
          {{ t(sharing ? '正在分享…' : '分享这段摘录') }}
        </button>
      </div>
    </form>
  </AppModal>
  <AppModal
    v-if="queueOpen && !editing && !selection && !remoteWorkspace"
    wide
    :title="t('制卡草稿')"
    :busy="workspace.busy.value"
    :error="error ? t(error) : undefined"
    @close="queueOpen = false"
  >
    <section class="draft-queue">
      <template v-if="draftSession.selection">
        <div class="draft-sharing">
          <strong>{{ t('当前分享的摘录') }}</strong>
          <button class="text-button" @click="draftSession.revoke()">{{ t('停止分享') }}</button>
        </div>
        <p>{{ draftSession.selection.title }}</p>
        <blockquote class="draft-quote">{{ draftSession.selection.excerpt.quote }}</blockquote>
        <p class="form-note">{{ t('在 MCP 客户端请求生成卡片草稿。收到后会显示在这里。') }}</p>
      </template>
      <p class="form-note">
        {{ t('草稿在关闭、重载应用或切换学习库后清空。确认保存后，卡片才会进入学习库和备份。') }}
      </p>
      <p v-if="!count" role="status">{{ t('还没有待确认的草稿。') }}</p>
      <ol v-else class="draft-list" :aria-label="t('待确认草稿')">
        <li v-for="draft in draftSession.drafts" :key="draft.id">
          <div class="draft-meta">
            <strong>{{ typeLabel(draft.input.type) }}</strong
            ><span>{{ draft.title }}</span>
          </div>
          <p class="draft-question">{{ draft.input.front.slice(0, 180) }}</p>
          <p v-if="!draftSession.valid(context(), draft)" class="import-warning">
            {{ t('材料或卡组已不存在，请丢弃草稿后重新选取。') }}
          </p>
          <div class="connection-actions">
            <button
              class="button secondary"
              :disabled="workspace.busy.value || !draftSession.valid(context(), draft)"
              @click="openDraft(draft.id)"
            >
              {{ t('检查并编辑') }}
            </button>
            <button
              class="text-button"
              :disabled="workspace.busy.value"
              @click="draftSession.discard(draft.id)"
            >
              {{ t('丢弃草稿') }}
            </button>
          </div>
        </li>
      </ol>
    </section>
  </AppModal>
  <AppModal
    v-if="editing && !remoteWorkspace"
    wide
    :title="t('确认制卡草稿')"
    :busy="workspace.busy.value"
    :error="error ? t(error) : undefined"
    @close="closeEditor"
  >
    <NoteEditor
      :key="editing.id"
      draft
      :library="library"
      :initial="{ ...editing.input, deckId: editing.deckId, excerpt: editing.excerpt }"
      :busy="workspace.busy.value"
      :get-media="workspace.getMedia"
      :submit="save"
      @close="closeEditor"
    />
  </AppModal>
</template>

<style scoped>
.draft-share,
.draft-queue {
  padding: 1.5rem 1.75rem;
  font-size: 1rem;
  line-height: 1.65;
}
.draft-quote {
  margin: 1rem 0;
  padding: 1rem;
  border-left: 3px solid var(--green);
  background: #f8f9f6;
  max-height: 14rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.draft-sharing,
.draft-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.draft-meta span {
  color: var(--muted);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.draft-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0;
}
.draft-list li {
  padding: 1.25rem 0;
  border-top: 1px solid var(--line);
}
.draft-question {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
select {
  width: 100%;
}
.form-actions {
  margin-top: 1.5rem;
  padding-top: 1rem;
  position: sticky;
  bottom: -1px;
  background: var(--paper);
}
</style>
