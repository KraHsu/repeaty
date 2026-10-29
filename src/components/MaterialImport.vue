<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { MaterialHostApi, MaterialImportPlan } from '@repeaty/plugin-api'
import { usePluginManager } from '../plugins/manager'
import { t } from '../i18n'
import AppModal from './AppModal.vue'
import { UiButton, UiSelect, UiNotice } from './ui'

const props = defineProps<{ scope: string; busy?: boolean }>()
const emit = defineEmits<{ imported: [sourceIds: readonly string[]] }>()
const plugins = usePluginManager()
const importers = computed(() =>
  plugins.pluginRuntime.installations.flatMap((installation) =>
    (installation.importers ?? []).map((importer) => ({
      key: `${installation.plugin.id}:${importer.id}`,
      pluginId: installation.plugin.id,
      importer,
    })),
  ),
)
const open = ref(false),
  choice = ref(''),
  parsing = ref(false),
  committing = ref(false),
  error = ref('')
const plan = shallowRef<MaterialImportPlan>()
const selected = computed(() => importers.value.find((entry) => entry.key === choice.value))
let controller: AbortController | undefined,
  api: MaterialHostApi | undefined,
  operationId = '',
  sequence = 0,
  alive = true
function clear() {
  sequence++
  controller?.abort()
  if (plan.value) {
    try {
      api?.discardImport(plan.value.id)
    } catch {
      /* The retired plugin or library has already discarded its plans. */
    }
  }
  plan.value = undefined
  api = undefined
  parsing.value = false
}
function close() {
  if (committing.value) return
  clear()
  open.value = false
  error.value = ''
}
function show() {
  clear()
  choice.value = importers.value[0]?.key ?? ''
  error.value = ''
  open.value = true
}
watch(choice, () => {
  clear()
  error.value = ''
})
watch(
  () => props.scope,
  () => {
    clear()
    open.value = false
    error.value = ''
  },
)
watch(importers, () => {
  if (open.value && !selected.value) {
    clear()
    error.value = t('材料导入器已不可用。')
  }
})
onUnmounted(() => {
  alive = false
  clear()
})
async function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  clear()
  error.value = ''
  const entry = selected.value
  if (!files.length || !entry) return
  const current = ++sequence,
    scope = props.scope
  controller = new AbortController()
  const bound = plugins.materialApiFor(entry.pluginId)
  if (!bound) return
  api = bound
  parsing.value = true
  try {
    const result = await bound.prepareImport(
      { importerId: entry.importer.id, files },
      controller.signal,
    )
    if (!alive || sequence !== current || scope !== props.scope) {
      bound.discardImport(result.id)
      return
    }
    plan.value = result
    operationId = crypto.randomUUID()
  } catch (issue) {
    if (
      alive &&
      sequence === current &&
      !(issue instanceof DOMException && issue.name === 'AbortError')
    )
      error.value = t(issue as Error)
  } finally {
    if (alive && sequence === current) parsing.value = false
  }
}
async function confirm() {
  const pending = plan.value,
    bound = api,
    scope = props.scope
  if (!pending || !bound || committing.value || props.busy) return
  committing.value = true
  error.value = ''
  try {
    const result = await bound.commitImport({
      planId: pending.id,
      expectedRevision: pending.revision,
      operationId,
    })
    if (alive && scope === props.scope && plan.value === pending) {
      bound.discardImport(pending.id)
      plan.value = undefined
      open.value = false
      emit('imported', result.sourceIds)
    }
  } catch (issue) {
    if (alive && scope === props.scope) error.value = t(issue as Error)
  } finally {
    if (alive) committing.value = false
  }
}
</script>

<template>
  <UiButton v-if="importers.length" variant="secondary" :disabled="busy" @click="show">{{
    t('插件导入')
  }}</UiButton>
  <AppModal v-if="open" :title="t('导入材料')" :busy="committing" :error="error" @close="close">
    <div class="material-import-form">
      <label for="material-importer">{{ t('材料导入器') }}</label>
      <UiSelect id="material-importer" v-model="choice" :disabled="parsing || committing">
        <option v-for="entry in importers" :key="entry.key" :value="entry.key">
          {{ entry.importer.title }}
        </option>
      </UiSelect>
      <label for="material-import-files">{{ t('选择材料文件') }}</label>
      <input
        id="material-import-files"
        data-testid="material-import-files"
        type="file"
        multiple
        :accept="selected?.importer.extensions.join(',')"
        :disabled="parsing || committing || !selected"
        @change="chooseFiles"
      />
      <p class="form-note">
        {{ t('解析后先预览，再一次保存所选文件。原始文件和文本副本一起保留。') }}
      </p>
      <p v-if="parsing" role="status">{{ t('正在解析材料…') }}</p>
      <template v-if="plan">
        <ul class="material-import-candidates" :aria-label="t('导入预览')">
          <li v-for="candidate in plan.candidates" :key="candidate.key">
            <span>{{ candidate.title }}</span
            ><span class="muted">{{
              t(candidate.duplicate ? '已导入，将保留已有材料' : '新增')
            }}</span>
          </li>
        </ul>
        <UiNotice>{{
          t('确认后使用新的材料格式，旧版本软件将无法打开此学习库。已有学习内容保留。')
        }}</UiNotice>
      </template>
      <div class="form-actions">
        <UiButton variant="secondary" :disabled="committing" @click="close">{{
          t('取消')
        }}</UiButton>
        <UiButton
          variant="primary"
          :disabled="!plan || parsing || committing || busy"
          @click="confirm"
          >{{ t('确认导入') }}</UiButton
        >
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.material-import-form {
  display: grid;
  gap: 0.75rem;
}
.material-import-candidates {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 18rem;
  overflow: auto;
}
.material-import-candidates li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--border);
}
</style>
