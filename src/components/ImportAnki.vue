<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { t, type DisplayMessage, type MessageKey } from '../i18n'
import { variants, type Library } from '../core/model'
import { readAnkiFile } from '../core/anki/client'
import { ankiImportCounts, type AnkiPackage, type AnkiIssueReason } from '../core/anki/types'
import CardContent from './CardContent.vue'
import { Upload } from '@lucide/vue'

const props = defineProps<{
  library: Library
  deckId: string
  busy: boolean
  submit: (data: AnkiPackage, deckId: string) => Promise<boolean>
}>()
const emit = defineEmits<{ close: [] }>()
const fileInput = ref<HTMLInputElement>()
const data = shallowRef<AnkiPackage>(),
  error = ref<DisplayMessage>(''),
  reading = ref(false),
  progress = ref(0)
let controller: AbortController | undefined
onUnmounted(() => controller?.abort())
const counts = computed(() =>
  data.value ? ankiImportCounts(props.library, data.value) : undefined,
)
const cards = computed(
  () => counts.value?.notes.reduce((sum, note) => sum + variants(note.input).length, 0) ?? 0,
)
const mediaCount = computed(
  () =>
    new Set(
      counts.value?.notes.flatMap((note) => [...note.input.frontMedia, ...note.input.backMedia]),
    ).size,
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
async function fileChanged(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  controller?.abort()
  const current = new AbortController()
  controller = current
  reading.value = true
  progress.value = 0
  data.value = undefined
  error.value = ''
  try {
    data.value = await readAnkiFile(file, current.signal, (value) => {
      progress.value = value
    })
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
  if (!data.value || !counts.value?.notes.length || reading.value) return
  if (await props.submit(data.value, props.deckId)) emit('close')
}
function downloadReport() {
  if (!data.value) return
  const existing = new Set(props.library.notes.map((note) => note.id))
  const report = {
    format: 'repeaty-anki-import-report',
    version: 1,
    file: data.value.name,
    packageFormat: data.value.format,
    totalNotes: data.value.totalNotes,
    newNotes: counts.value?.notes.length,
    duplicates: counts.value?.duplicates,
    skipped: skipped.value,
    ignoredReviewCount: data.value.reviewCount,
    notes: data.value.notes.map((note) => ({
      ankiId: note.sourceId,
      guid: note.guid,
      model: note.model,
      alreadyPresent: existing.has(note.id),
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
      {{ t('支持 Basic、双向和 Cloze。导入为新卡，不保留 Anki 的复习进度。') }}
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
      <p>{{ t('正在读取 Anki 文件… {percent}%', { percent: progress }) }}</p>
      <progress :value="progress" max="100" :aria-label="t('正在读取 Anki 文件…')" />
      <button type="button" class="text-button" @click="cancelRead">{{ t('取消') }}</button>
    </div>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <section v-if="data && counts" class="anki-preview" aria-live="polite">
      <strong>{{ data.name }}</strong>
      <p>
        {{
          t('共 {total} 条笔记：可导入 {ready} 条，已存在 {duplicates} 条，跳过 {skipped} 条。', {
            total: data.totalNotes,
            ready: counts.notes.length,
            duplicates: counts.duplicates,
            skipped,
          })
        }}
      </p>
      <p>{{ t('将添加 {cards} 张新卡和 {media} 个附件。', { cards, media: mediaCount }) }}</p>
      <p v-if="data.reviewCount" class="form-note">
        {{ t('文件含 {count} 条 Anki 复习记录，本次不会导入。', { count: data.reviewCount }) }}
      </p>
      <p class="form-note">{{ t('相同 GUID 的笔记会跳过，保留 Repeaty 中已有的内容和进度。') }}</p>
      <details v-if="counts.notes.length" class="anki-content-preview">
        <summary>{{ t('查看内容预览') }}</summary>
        <ol>
          <li v-for="note in counts.notes.slice(0, 3)" :key="note.id">
            <span class="form-note">{{
              t(
                note.input.type === 'cloze'
                  ? '挖空卡'
                  : note.input.type === 'reversed'
                    ? '双向卡'
                    : '正反面',
              )
            }}</span>
            <CardContent :text="note.input.front" format="markdown" />
            <hr />
            <CardContent :text="note.input.back" format="markdown" />
          </li>
        </ol>
      </details>
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
      <p v-if="!counts.notes.length" class="form-note">{{ t('没有可导入的新笔记。') }}</p>
    </section>
    <div class="form-actions">
      <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
        {{ t('取消') }}
      </button>
      <button
        type="button"
        class="button primary"
        :disabled="busy || reading || !counts?.notes.length || !deckId"
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
.anki-file-button {
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
.anki-progress {
  display: grid;
  gap: 0.65rem;
}
.anki-progress progress {
  width: 100%;
}
.anki-report ul,
.anki-content-preview ol {
  padding-left: 1.4rem;
  display: grid;
  gap: 1rem;
  margin-block: 1rem;
}
.anki-content-preview li {
  min-width: 0;
}
.anki-content-preview :deep(.card-content) {
  font-size: 1rem;
  margin-top: 0.5rem;
}
.anki-report p {
  margin-top: 0.25rem;
}
summary {
  cursor: pointer;
}
</style>
