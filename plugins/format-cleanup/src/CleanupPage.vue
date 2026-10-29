<script setup lang="ts">
import { text } from './text'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AppPage,
  SettingField,
  UiButton,
  UiNotice,
  UiTextarea,
  materials,
  type MaterialRecord,
} from '@repeaty/plugin-api'
import type { CleanupSettings } from './settings'
import { runCleanup } from './run-cleanup'

const props = defineProps<{ workspaceScope: string; settings: CleanupSettings }>()
const sources = ref<readonly MaterialRecord[]>([]),
  selected = ref(''),
  busy = ref(false),
  error = ref(''),
  status = ref('')
const applying = ref(false)
const preview = ref<{
  sourceId: string
  versionId: string
  before: string
  after: string
  revision: number
  operationId: string
}>()
const choices = computed(() =>
  sources.value.map((source) => ({ value: source.id, label: source.title })),
)
const changed = computed(() => preview.value && preview.value.before !== preview.value.after)
let controller: AbortController | undefined,
  alive = true
async function refresh() {
  const snapshot = materials.snapshot()
  if (snapshot.workspaceScope !== props.workspaceScope)
    throw new Error('学习库已变化，请重新打开。')
  sources.value = snapshot.sources.filter(
    (source) => source.format === 'markdown' || !source.document,
  )
  if (!sources.value.some((source) => source.id === selected.value))
    selected.value = sources.value[0]?.id ?? ''
}
function clear() {
  controller?.abort()
  preview.value = undefined
  error.value = ''
  status.value = ''
}
watch(selected, clear)
watch(() => props.settings.options, clear, { deep: true })
onMounted(() =>
  refresh().catch((reason) => {
    error.value = String(reason.message ?? reason)
  }),
)
onBeforeUnmount(() => {
  alive = false
  controller?.abort()
})
async function prepare() {
  clear()
  busy.value = true
  const pending = new AbortController()
  controller = pending
  try {
    await refresh()
    const snapshot = materials.snapshot(),
      source = snapshot.sources.find((source) => source.id === selected.value)
    if (!source) throw new Error('请选择材料。')
    const { text } = await materials.get(source.id, source.versionId)
    pending.signal.throwIfAborted()
    const after = await runCleanup(
      text,
      JSON.parse(JSON.stringify(props.settings.options)),
      pending.signal,
    )
    pending.signal.throwIfAborted()
    if (!alive) return
    if (materials.snapshot().revision !== snapshot.revision)
      throw new Error('学习库内容已变化，请重新预览。')
    preview.value = {
      sourceId: source.id,
      versionId: source.versionId,
      before: text,
      after,
      revision: snapshot.revision,
      operationId: crypto.randomUUID(),
    }
  } catch (reason) {
    if (alive && !pending.signal.aborted)
      error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (alive && controller === pending) busy.value = false
  }
}
async function apply() {
  if (!preview.value || !changed.value || busy.value) return
  const captured = preview.value
  busy.value = true
  applying.value = true
  error.value = ''
  try {
    await materials.editContent({
      sourceId: captured.sourceId,
      versionId: captured.versionId,
      content: captured.after,
      expectedRevision: captured.revision,
      operationId: captured.operationId,
    })
    if (!alive) return
    preview.value = undefined
    status.value = '已保存为新版本。可使用应用的撤销操作恢复原文；已有卡片和阅读历史保持不变。'
    await refresh()
  } catch (reason) {
    if (alive) error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (alive) {
      busy.value = false
      applying.value = false
    }
  }
}
</script>

<template>
  <AppPage
    :title="text('格式清理')"
    :description="text('选择材料，检查差异，再应用。规则在「设置 → 工具 → 格式清理」中配置。')"
  >
    <template #actions
      ><UiButton variant="primary" :disabled="!selected || busy" :busy="busy" @click="prepare">{{
        text('预览清理')
      }}</UiButton></template
    >
    <div class="cleanup-page-body">
      <UiNotice v-if="error" tone="error">{{ text(error) }}</UiNotice>
      <UiNotice v-if="status" tone="success">{{ text(status) }}</UiNotice>
      <SettingField
        type="select"
        :label="text('材料')"
        :model-value="selected"
        :options="choices"
        :disabled="busy"
        :placeholder="text('选择要清理的材料')"
        @update:model-value="selected = String($event)"
      />
      <p v-if="!sources.length">{{ text('还没有可清理的文本或 Markdown 材料。') }}</p>
      <p v-else class="cleanup-muted">
        {{ text('代码、链接地址和 YAML 属性保持原样。清理在后台执行，可随时取消。') }}
      </p>
      <UiButton v-if="busy && !applying" variant="secondary" @click="controller?.abort()">{{
        text('取消预览')
      }}</UiButton>
      <template v-if="preview">
        <UiNotice v-if="!changed" tone="info">{{ text('当前规则没有产生变化。') }}</UiNotice>
        <div class="cleanup-diff">
          <section>
            <h2>{{ text('清理前') }}</h2>
            <UiTextarea
              :model-value="preview.before"
              readonly
              :rows="18"
              :aria-label="text('清理前的完整正文')"
            />
          </section>
          <section>
            <h2>{{ text('清理后') }}</h2>
            <UiTextarea
              :model-value="preview.after"
              readonly
              :rows="18"
              :aria-label="text('清理后的完整正文')"
            />
          </section>
        </div>
        <div class="cleanup-apply">
          <span>{{ preview.before.length }} → {{ preview.after.length }} {{ text('字符') }}</span
          ><UiButton variant="primary" :disabled="!changed || busy" :busy="busy" @click="apply">{{
            text('应用清理')
          }}</UiButton>
        </div>
      </template>
    </div>
  </AppPage>
</template>

<style scoped>
.cleanup-page-body {
  display: grid;
  gap: var(--space-lg, 1.5rem);
}
.cleanup-muted {
  color: var(--ui-text-muted);
}
.cleanup-diff {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
}
.cleanup-diff section {
  min-width: 0;
  display: grid;
  gap: 0.75rem;
}
.cleanup-diff :deep(textarea) {
  font-family: var(--font-mono, monospace);
  white-space: pre;
  overflow: auto;
}
.cleanup-diff h2 {
  font-size: var(--text-base, 1rem);
  font-weight: 600;
}
.cleanup-apply {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
@media (max-width: 760px) {
  .cleanup-diff {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
