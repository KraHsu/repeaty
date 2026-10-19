<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { t, type DisplayMessage, type MessageKey } from '../i18n'
import type { Library } from '../core/model'
import { readAnkiFile } from '../core/anki/client'
import type { AnkiPackage, AnkiIssueReason } from '../core/anki/types'
import { ankiSelectionSummary, type AnkiImportPlan, type AnkiSelection } from '../core/anki/changes'
import AnkiImportChanges from './AnkiImportChanges.vue'
import { Upload } from '@lucide/vue'

const props = defineProps<{
  library: Library
  deckId: string
  busy: boolean
  analyze: (data: AnkiPackage, signal: AbortSignal) => Promise<AnkiImportPlan>
  submit: (plan: AnkiImportPlan, selection: AnkiSelection, deckId: string) => Promise<boolean>
  getMedia: (id: string) => Promise<Blob | undefined>
}>()
const emit = defineEmits<{ close: [] }>()
const fileInput = ref<HTMLInputElement>()
const data = shallowRef<AnkiPackage>(),
  plan = shallowRef<AnkiImportPlan>()
const error = ref<DisplayMessage>(''),
  reading = ref(false),
  comparing = ref(false),
  progress = ref(0)
const comparisonId = ref(0)
const selected = ref<string[]>([]),
  confirmCardChanges = ref(false)
let controller: AbortController | undefined,
  applying = false
onUnmounted(() => controller?.abort())
watch(
  () => props.library,
  () => {
    if (applying) return
    controller?.abort()
    reading.value = false
    plan.value = undefined
    selected.value = []
    if (data.value) error.value = '学习库已变化，请重新比较后再导入。'
  },
)
watch(
  selected,
  () => {
    confirmCardChanges.value = false
  },
  { flush: 'sync' },
)
const summary = computed(() =>
  plan.value ? ankiSelectionSummary(plan.value, selected.value) : undefined,
)
const counts = computed(() => {
  const entries = plan.value?.changes ?? []
  return {
    duplicates: entries.filter((entry) => entry.current).length,
    changed: entries.filter((entry) => entry.status === 'changed').length,
    same: entries.filter((entry) => entry.status === 'same').length,
    unavailable: entries.filter((entry) => entry.status === 'unavailable').length,
  }
})
const removedHistory = computed(() =>
  summary.value?.removedCards.reduce(
    (sum, card) => ({
      reviews: sum.reviews + card.reviews,
      practices: sum.practices + card.practices,
      attempts: sum.attempts + card.attempts,
    }),
    { reviews: 0, practices: 0, attempts: 0 },
  ),
)
const skipped = computed(() => data.value?.issues.filter((issue) => issue.skipped).length ?? 0)
const reasons: Record<AnkiIssueReason, MessageKey> = {
  template: '模板无法转换为问答、双向或挖空卡',
  fields: '字段数量或身份不正确',
  content: '内容、标签或挖空格式超出支持范围',
  variants: '卡片变体不完整或不受支持',
  media: '附件缺失、损坏或格式不受支持',
  'active-content': '已移除脚本或交互内容',
  'external-media': '已移除外部图片或音频',
}
async function compare(current: AbortController) {
  if (!data.value) return
  comparing.value = true
  const next = await props.analyze(data.value, current.signal)
  current.signal.throwIfAborted()
  if (controller !== current) return
  comparisonId.value++
  plan.value = next
  selected.value = next.changes
    .filter((entry) => entry.status === 'new')
    .map((entry) => entry.incoming.id)
}
async function fileChanged(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  controller?.abort()
  const current = new AbortController()
  controller = current
  reading.value = true
  comparing.value = false
  progress.value = 0
  data.value = undefined
  plan.value = undefined
  selected.value = []
  error.value = ''
  try {
    const parsed = await readAnkiFile(file, current.signal, (value) => {
      progress.value = value
    })
    current.signal.throwIfAborted()
    data.value = parsed
    await compare(current)
  } catch (issue) {
    if (!current.signal.aborted) error.value = issue as Error
  } finally {
    if (controller === current) reading.value = false
  }
}
async function retryComparison() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  reading.value = true
  error.value = ''
  plan.value = undefined
  selected.value = []
  try {
    await compare(current)
  } catch (issue) {
    if (!current.signal.aborted) error.value = issue as Error
  } finally {
    if (controller === current) reading.value = false
  }
}
function cancelRead() {
  controller?.abort()
  reading.value = false
}
async function submit() {
  if (
    !plan.value ||
    !selected.value.length ||
    reading.value ||
    (summary.value?.cardChanges && !confirmCardChanges.value)
  )
    return
  applying = true
  try {
    if (
      await props.submit(
        plan.value,
        { ids: selected.value, confirmCardChanges: confirmCardChanges.value },
        props.deckId,
      )
    )
      emit('close')
  } finally {
    applying = false
  }
}
function downloadReport() {
  if (!data.value || !plan.value) return
  const chosen = new Set(selected.value)
  const report = {
    format: 'repeaty-anki-import-report',
    version: 2,
    file: data.value.name,
    packageFormat: data.value.format,
    totalNotes: data.value.totalNotes,
    newNotes: summary.value?.addedNotes,
    updatedNotes: summary.value?.updatedNotes,
    duplicates: counts.value.duplicates,
    skipped: skipped.value,
    ignoredReviewCount: data.value.reviewCount,
    cardChangesConfirmed: confirmCardChanges.value,
    notes: plan.value.changes.map((change) => ({
      ankiId: change.incoming.sourceId,
      guid: change.incoming.guid,
      model: change.incoming.model,
      alreadyPresent: !!change.current,
      status: change.status,
      decision: chosen.has(change.incoming.id) ? (change.current ? 'update' : 'add') : 'keep',
      differences: change.differences,
      retainedCards: change.retained,
      addedVariants: change.added,
      removedCards: change.removed,
    })),
    issues: data.value.issues.map((issue) => ({ ...issue, message: t(reasons[issue.reason]) })),
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${data.value.name.replace(/\.apkg$/i, '')}-import-report.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="anki-import">
    <p class="form-note">
      {{
        t(
          '支持 Basic、双向和 Cloze。新笔记作为新卡添加；已有笔记可选择更新。不导入 Anki 复习进度。',
        )
      }}
    </p>
    <p class="form-note">{{ t('内容转为 Markdown，图片和音频作为附件。模板样式不保留。') }}</p>
    <p class="form-note">{{ t('最多 5000 条 · 文件最大 256 MB · 单个附件最大 10 MB') }}</p>
    <label class="sr-only" for="anki-file">{{ t('选择 Anki 文件') }}</label>
    <input
      ref="fileInput"
      id="anki-file"
      class="sr-only"
      type="file"
      tabindex="-1"
      accept=".apkg"
      :disabled="busy || reading"
      @change="fileChanged"
    />
    <button
      type="button"
      class="button attachment-button anki-file-button"
      :disabled="busy || reading"
      @click="fileInput?.click()"
    >
      <Upload :size="18" aria-hidden="true" />{{ t('选择 Anki 文件') }} (.apkg)
    </button>
    <div v-if="reading" class="anki-progress" role="status" aria-live="polite">
      <p>
        {{
          comparing
            ? t('正在比较笔记和附件…')
            : t('正在读取 Anki 文件… {percent}%', { percent: progress })
        }}
      </p>
      <progress
        v-if="!comparing"
        :value="progress"
        max="100"
        :aria-label="t('正在读取 Anki 文件…')"
      />
      <button type="button" class="text-button" @click="cancelRead">{{ t('取消') }}</button>
    </div>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <button
      v-if="data && !reading"
      type="button"
      class="text-button anki-retry"
      :disabled="busy"
      @click="retryComparison"
    >
      {{ t('重新比较') }}
    </button>
    <section v-if="data && plan && summary" class="anki-preview" aria-live="polite">
      <strong>{{ data.name }}</strong>
      <p>
        {{
          t('共 {total} 条笔记：可导入 {ready} 条，已存在 {duplicates} 条，跳过 {skipped} 条。', {
            total: data.totalNotes,
            ready: summary.addedNotes,
            duplicates: counts.duplicates,
            skipped,
          })
        }}
      </p>
      <p v-if="counts.duplicates">
        {{ t('已有笔记：{same} 条相同，{changed} 条内容不同，{unavailable} 条无法比较。', counts) }}
      </p>
      <p>
        {{
          t('将添加 {cards} 张新卡和 {media} 个附件。', {
            cards: summary.addedCards,
            media: summary.newMedia,
          })
        }}
      </p>
      <p v-if="counts.changed">
        {{ t('已选择更新 {count} 条笔记。', { count: summary.updatedNotes }) }}
      </p>
      <p v-if="data.reviewCount" class="form-note">
        {{ t('文件含 {count} 条 Anki 复习记录，本次不会导入。', { count: data.reviewCount }) }}
      </p>
      <p class="form-note">
        {{
          t(
            '已有笔记默认保留。选择采用文件内容会覆盖当前内容和标签，所属卡组不变；保留的卡片继续使用原进度。',
          )
        }}
      </p>
      <AnkiImportChanges
        :key="comparisonId"
        :plan="plan"
        :selected="selected"
        :disabled="busy || reading"
        :get-media="getMedia"
        @select="selected = $event"
      />
      <div v-if="summary.cardChanges" class="anki-card-impact">
        <strong>{{ t('确认卡片变化') }}</strong>
        <p>
          {{
            t('更新将新增 {added} 张卡片、移除 {removed} 张卡片。新增卡片从头学习。', {
              added: summary.addedCards,
              removed: summary.removedCards.length,
            })
          }}
        </p>
        <p v-if="summary.removedCards.length && removedHistory" class="import-warning">
          {{
            t(
              '移除的卡片包含 {reviews} 条复习记录、{practices} 次练习和 {attempts} 次提交，将一并移除。',
              removedHistory,
            )
          }}
        </p>
        <p class="form-note">{{ t('导入前会保存快照，可恢复原内容、进度和附件。') }}</p>
        <label class="check-line"
          ><input v-model="confirmCardChanges" type="checkbox" :disabled="busy" />{{
            t('我已确认以上卡片变化')
          }}</label
        >
      </div>
      <details v-if="data.issues.length" class="anki-report">
        <summary>{{ t('导入报告') }} ({{ data.issues.length }})</summary>
        <ul>
          <li v-for="(issue, index) in data.issues.slice(0, 20)" :key="index">
            <strong>{{ t(issue.skipped ? '已跳过' : '已调整') }}</strong> · {{ issue.model }} ·
            {{ issue.noteId }}
            <p>{{ t(reasons[issue.reason]) }}</p>
          </li>
        </ul>
        <p v-if="data.issues.length > 20" class="form-note">
          {{ t('还有 {count} 项，完整列表见下载报告。', { count: data.issues.length - 20 }) }}
        </p>
      </details>
      <button type="button" class="text-button" @click="downloadReport">{{ t('下载报告') }}</button>
      <p v-if="!selected.length" class="form-note">{{ t('未选择添加或更新任何笔记。') }}</p>
    </section>
    <div class="form-actions">
      <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
        {{ t('取消') }}
      </button>
      <button
        type="button"
        class="button primary"
        :disabled="
          busy ||
          reading ||
          !plan ||
          !selected.length ||
          !deckId ||
          (summary?.cardChanges && !confirmCardChanges)
        "
        @click="submit"
      >
        {{ t('确认导入') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.anki-import {
  display: grid;
  gap: 0.8rem;
  min-width: 0;
}
.anki-import > * {
  min-width: 0;
}
.anki-import input[type='file'] {
  width: 1px;
  max-width: 1px;
  height: 1px;
  min-height: 0;
}
.anki-file-button,
.anki-retry {
  justify-self: start;
  max-width: 100%;
}
.anki-import p {
  margin: 0;
}
.anki-preview {
  display: grid;
  gap: 0.85rem;
  padding: 1.1rem;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.anki-preview strong,
.anki-report li {
  overflow-wrap: anywhere;
}
.anki-progress,
.anki-card-impact {
  display: grid;
  gap: 0.65rem;
}
.anki-card-impact {
  padding: 1rem;
  background: #faf6e9;
  border: 1px solid #dfd1a9;
  border-radius: 10px;
}
.anki-progress progress {
  width: 100%;
}
.anki-report ul {
  padding-left: 1.4rem;
  display: grid;
  gap: 1rem;
  margin-block: 1rem;
}
.anki-report p {
  margin-top: 0.25rem;
}
summary {
  cursor: pointer;
}
@media (max-width: 720px) {
  .anki-preview {
    padding: 0.75rem;
  }
}
</style>
