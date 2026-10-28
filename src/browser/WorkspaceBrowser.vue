<script setup lang="ts">
import { vUiControl, vUiButton } from '../components/ui'
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { FolderOpen, BookOpen, FileText, Layers, ShieldCheck, X } from '@lucide/vue'
import { t, type DisplayMessage } from '../i18n'
import type { useLibrary } from '../composables/useLibrary'
import AppModal from '../components/AppModal.vue'
import { createRepository } from '../core/storage'
import { readBrowserWorkspace } from './worker-client'
import { createBrowserRepository, type BrowserWorkspaceSource } from './repository'
import { WorkspaceReadError, workspaceReadCode } from './errors'
import type { ReadDirectoryHandle, WorkspaceSelection } from './workspace-files'
import { storeToRefs } from 'pinia'
import { useBrowserWorkspaceStore } from '../stores/browser-workspace'
const browserState = useBrowserWorkspaceStore()
const { active: browserWorkspace } = storeToRefs(browserState)

const props = defineProps<{ workspace: ReturnType<typeof useLibrary> }>()
const emit = defineEmits<{ changed: [] }>()
const folderInput = ref<HTMLInputElement>()
const loading = ref(false),
  picking = ref(false),
  progress = ref(0)
const error = shallowRef<DisplayMessage>('')
const candidate = shallowRef<BrowserWorkspaceSource>()
const confirm = ref<'replace' | 'close'>()
const active = computed(() =>
  browserWorkspace.value?.scope === props.workspace.scope.value ? browserWorkspace.value : null,
)
const locked = computed(() => loading.value || picking.value || props.workspace.busy.value)
const picker = (
  window as unknown as {
    showDirectoryPicker?: (options: { mode: 'read' }) => Promise<ReadDirectoryHandle>
  }
).showDirectoryPicker
let controller: AbortController | undefined
let generation = 0,
  alive = true

function cancel() {
  ++generation
  controller?.abort()
  controller = undefined
  candidate.value?.close()
  candidate.value = undefined
  loading.value = false
  error.value = ''
}
async function read(selection: WorkspaceSelection) {
  if (!alive) return
  cancel()
  const sequence = generation,
    abort = new AbortController()
  controller = abort
  loading.value = true
  progress.value = 0
  try {
    const source = await readBrowserWorkspace(selection, abort.signal, (percent) => {
      if (alive && generation === sequence) progress.value = percent
    })
    if (!alive || generation !== sequence) {
      source.close()
      return
    }
    candidate.value = source
  } catch (issue) {
    if (alive && generation === sequence && !abort.signal.aborted)
      error.value = new WorkspaceReadError(workspaceReadCode(issue))
  } finally {
    if (alive && generation === sequence) {
      loading.value = false
      controller = undefined
    }
  }
}
async function choose() {
  if (locked.value) return
  if (!picker) {
    folderInput.value?.click()
    return
  }
  picking.value = true
  error.value = ''
  try {
    const handle = await picker.call(window, { mode: 'read' })
    await read({ kind: 'directory', handle })
  } catch (issue) {
    if (alive && !(issue instanceof DOMException && issue.name === 'AbortError'))
      error.value = new WorkspaceReadError(workspaceReadCode(issue))
  } finally {
    if (alive) picking.value = false
  }
}
function selected(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) void read({ kind: 'files', files })
}
async function activate(confirmed = false) {
  if (locked.value || !candidate.value) return
  if (active.value?.changed && !confirmed) {
    confirm.value = 'replace'
    return
  }
  confirm.value = undefined
  const source = candidate.value
  candidate.value = undefined // Ownership transfers to the repository, including on failure.
  const repo = createBrowserRepository(source, () => {
    browserState.markChanged(repo.scope())
  })
  try {
    await props.workspace.replaceRepository(repo)
    browserState.open({
      scope: repo.scope(),
      id: source.snapshot.id,
      name: source.snapshot.name,
      revision: source.snapshot.revision,
      changed: false,
    })
    if (alive) emit('changed')
  } catch (issue) {
    if (alive) error.value = issue as Error
  }
}
async function finish(confirmed = false) {
  if (locked.value || !active.value) return
  if (active.value.changed && !confirmed) {
    confirm.value = 'close'
    return
  }
  confirm.value = undefined
  try {
    await props.workspace.replaceRepository(
      createRepository('repeaty', undefined, { compactHistory: true }),
    )
    browserState.clear()
    if (alive) emit('changed')
  } catch (issue) {
    if (alive) error.value = issue as Error
  }
}
onUnmounted(() => {
  alive = false
  cancel()
})
</script>

<template>
  <section class="browser-workspace">
    <header class="browser-workspace-heading">
      <span class="workspace-symbol"><FolderOpen :size="30" /></span>
      <div>
        <h1>{{ t('在浏览器中打开工作目录') }}</h1>
        <p>{{ t('查看本地卡片、材料和学习记录，无需上传或连接服务器。') }}</p>
      </div>
    </header>
    <div class="workspace-readonly-note">
      <ShieldCheck :size="22" aria-hidden="true" />
      <p>{{ t('原目录只读。可在独立副本中复习和编辑，试用进度只保留在当前页面。') }}</p>
    </div>
    <p class="workspace-folder-help">
      {{ t('先在桌面版中关闭学习库，再选择包含 workspace.json 的整个文件夹。') }}
    </p>
    <div class="workspace-actions">
      <button v-ui-button class="button primary" :disabled="locked" @click="choose">
        <FolderOpen :size="19" />{{ t('打开本地工作目录') }}
      </button>
      <button
        v-ui-button
        v-if="picker"
        class="button"
        :disabled="locked"
        @click="folderInput?.click()"
      >
        {{ t('使用文件夹选择') }}
      </button>
      <input
        v-ui-control
        ref="folderInput"
        class="sr-only"
        type="file"
        webkitdirectory
        multiple
        :aria-label="t('选择工作目录文件夹')"
        :disabled="locked"
        @change="selected"
      />
    </div>
    <p v-if="error" role="alert" class="workspace-read-error">{{ t(error) }}</p>
    <div v-if="loading" class="workspace-progress" role="status">
      <div>
        <span>{{ t('正在读取工作目录…') }}</span
        ><span>{{ progress }}%</span>
      </div>
      <progress v-ui-control :value="progress" max="100" :aria-label="t('正在读取工作目录…')" />
      <button v-ui-button class="button" @click="cancel"><X :size="17" />{{ t('取消') }}</button>
    </div>
    <section v-if="candidate" class="workspace-preview" :aria-label="t('工作目录预览')">
      <div class="workspace-preview-heading">
        <h2>{{ candidate.snapshot.name }}</h2>
        <span>{{ t('目录格式 {version}', { version: 3 }) }}</span>
      </div>
      <dl class="workspace-totals">
        <div>
          <dt><BookOpen :size="19" />{{ t('卡组') }}</dt>
          <dd>{{ candidate.snapshot.library.decks.length }}</dd>
        </div>
        <div>
          <dt><Layers :size="19" />{{ t('卡片') }}</dt>
          <dd>{{ candidate.snapshot.library.cards.length }}</dd>
        </div>
        <div>
          <dt><FileText :size="19" />{{ t('学习材料') }}</dt>
          <dd>{{ candidate.snapshot.library.sources.length }}</dd>
        </div>
        <div>
          <dt>{{ t('复习记录') }}</dt>
          <dd>{{ candidate.snapshot.library.reviews.length }}</dd>
        </div>
      </dl>
      <p>{{ t('使用桌面已接受的内容；尚未接受的外部编辑不会用于本次试用。') }}</p>
      <div class="workspace-actions">
        <button v-ui-button class="button primary" :disabled="locked" @click="activate()">
          {{ t('开始试用') }}
        </button>
        <button v-ui-button class="button" :disabled="locked" @click="cancel">
          {{ t('取消') }}
        </button>
      </div>
    </section>
    <section v-if="active" class="workspace-preview" :aria-label="t('当前试用副本')">
      <h2>{{ t('正在试用「{name}」', { name: active.name }) }}</h2>
      <p>{{ t('可以从侧栏进入卡片和材料。离开前，可在「数据与备份」中导出试用副本。') }}</p>
      <p>{{ t('文件更新、接受外部修改和自动检测请使用桌面版。') }}</p>
      <div class="workspace-actions">
        <button v-ui-button class="button" :disabled="locked" @click="finish()">
          {{ t('返回浏览器学习库') }}
        </button>
      </div>
    </section>
    <p v-else class="workspace-folder-help">{{ t('打开试用副本不会覆盖已有的浏览器学习库。') }}</p>
    <AppModal v-if="confirm" :title="t('结束当前试用')" :busy="locked" @close="confirm = undefined">
      <p>
        {{
          t('当前试用的修改将不再保留。需要保存时，请先到「数据与备份」导出副本。原目录不受影响。')
        }}
      </p>
      <div class="workspace-actions">
        <button v-ui-button class="button" :disabled="locked" @click="confirm = undefined">
          {{ t('继续试用') }}
        </button>
        <button
          v-ui-button
          class="button primary"
          :disabled="locked"
          @click="confirm === 'replace' ? activate(true) : finish(true)"
        >
          {{ t('结束试用') }}
        </button>
      </div>
    </AppModal>
  </section>
</template>

<style scoped>
.browser-workspace {
  max-width: 1020px;
  padding: 2.5rem;
  margin: 0 auto;
  width: 100%;
}
.browser-workspace-heading {
  display: flex;
  gap: 1.1rem;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}
.workspace-symbol {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  color: var(--green);
  background: var(--sage);
}
h1 {
  font-size: var(--font-size-page);
  line-height: var(--line-height-heading);
  margin: 0 0 0.6rem;
}
h2 {
  font-size: var(--font-size-section);
  line-height: var(--line-height-heading);
  overflow-wrap: anywhere;
}
p {
  font-size: var(--font-size-body);
  line-height: var(--line-height-ui);
}
.browser-workspace-heading p,
.workspace-folder-help,
.workspace-preview > p {
  color: var(--muted);
}
.workspace-readonly-note {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 1rem 1.1rem;
  border-radius: 12px;
  background: var(--sage);
  margin-bottom: 1rem;
}
.workspace-readonly-note svg {
  flex-shrink: 0;
  margin-top: 0.25rem;
}
.workspace-folder-help {
  margin: 1rem 0;
}
.workspace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.1rem;
}
.workspace-preview,
.workspace-progress {
  padding: 1.5rem;
  margin-top: 1.5rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
}
.workspace-preview-heading,
.workspace-progress > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
}
.workspace-preview-heading > span {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.workspace-totals {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.25rem;
  margin: 1.5rem 0;
}
.workspace-totals dt {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--muted);
  line-height: var(--line-height-ui);
}
.workspace-totals dd {
  font-size: var(--font-size-display);
  margin: 0.4rem 0 0;
  font-variant-numeric: tabular-nums;
}
.workspace-preview > p + p {
  margin-top: 0.65rem;
}
.workspace-read-error {
  padding: 1rem;
  margin-top: 1rem;
  border: 1px solid #dfbbb5;
  border-radius: 10px;
  background: var(--rose);
}
.workspace-progress progress {
  display: block;
  width: 100%;
  height: 12px;
  margin: 1rem 0;
  accent-color: var(--green);
}
@media (max-width: 760px) {
  .browser-workspace {
    padding: 1.5rem 1rem;
  }
  .browser-workspace-heading {
    gap: 0.75rem;
  }
  .workspace-symbol {
    width: 44px;
    height: 44px;
    border-radius: 12px;
  }
  .workspace-preview {
    padding: 1.1rem;
  }
  .workspace-totals {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
