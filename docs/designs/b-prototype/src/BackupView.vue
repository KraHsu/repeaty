<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { Download, Upload, FileJson, ArrowRight, ShieldCheck, Check, FolderOpen } from '@lucide/vue'
import { demo, commit, notice } from './state.js'

const fileInput = ref(null)
const pending = ref(null)
const pendingName = ref('')
const error = ref('')
const reading = ref(false)
const restoreOpen = ref(false)
const exported = ref(false)
const currentCards = computed(() => demo.data.cards.length)
const formatKind = 'repeaty-design-b-prototype'
let active = true
let readSequence = 0
const urls = new Set()
onUnmounted(() => {
  active = false
  readSequence += 1
  for (const url of urls) URL.revokeObjectURL(url)
  urls.clear()
})

function validateFile(payload) {
  const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  const string = (value, max = 20000) => typeof value === 'string' && value.length <= max
  const integer = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 10000000
  if (
    !object(payload) ||
    payload.kind !== formatKind ||
    payload.version !== 1 ||
    !object(payload.data)
  )
    throw new Error('请选择由此页面导出的 JSON 文件。')
  const source = payload.data
  if (
    !Array.isArray(source.decks) ||
    source.decks.length > 500 ||
    !Array.isArray(source.cards) ||
    source.cards.length > 5000 ||
    !object(source.settings) ||
    !object(source.enabledPlugins) ||
    !integer(source.reviewCount)
  )
    throw new Error('文件中的学习数据不完整或格式不正确。')
  const deckIds = new Set()
  const decks = source.decks.map((deck) => {
    if (
      !object(deck) ||
      !string(deck.id, 160) ||
      !deck.id ||
      deckIds.has(deck.id) ||
      !string(deck.name, 200) ||
      !deck.name.trim() ||
      !integer(deck.count) ||
      !integer(deck.due) ||
      !integer(deck.fresh) ||
      deck.due + deck.fresh > deck.count
    )
      throw new Error('文件中的卡组数据无效。')
    deckIds.add(deck.id)
    return { id: deck.id, name: deck.name, count: deck.count, due: deck.due, fresh: deck.fresh }
  })
  const cardIds = new Set()
  const cards = source.cards.map((card) => {
    if (
      !object(card) ||
      !string(card.id, 160) ||
      !card.id ||
      cardIds.has(card.id) ||
      !deckIds.has(card.deckId) ||
      !string(card.question) ||
      !string(card.answer) ||
      !Array.isArray(card.tags) ||
      card.tags.length > 50 ||
      !card.tags.every((tag) => string(tag, 200)) ||
      !['new', 'due', 'paused', 'learned'].includes(card.status)
    )
      throw new Error('文件中的卡片数据无效。')
    cardIds.add(card.id)
    return {
      id: card.id,
      deckId: card.deckId,
      question: card.question,
      answer: card.answer,
      tags: [...card.tags],
      status: card.status,
      ...(card.status === 'paused' && ['new', 'due', 'learned'].includes(card.previousStatus)
        ? { previousStatus: card.previousStatus }
        : {}),
    }
  })
  const settings = source.settings
  if (
    !['zh-CN', 'en-US'].includes(settings.language) ||
    !['information', 'warning', 'error', 'historyAfterAnswer'].every(
      (key) => typeof settings[key] === 'boolean',
    ) ||
    !integer(settings.historyLimit) ||
    settings.historyLimit > 1000
  )
    throw new Error('文件中的设置格式不正确。')
  if (
    !['history', 'leetcode', 'typed'].every(
      (key) => typeof source.enabledPlugins[key] === 'boolean',
    )
  )
    throw new Error('文件中的插件状态格式不正确。')
  return {
    decks,
    cards,
    settings: {
      language: settings.language,
      information: settings.information,
      warning: settings.warning,
      error: settings.error,
      historyLimit: settings.historyLimit,
      historyAfterAnswer: settings.historyAfterAnswer,
    },
    enabledPlugins: {
      history: source.enabledPlugins.history,
      leetcode: source.enabledPlugins.leetcode,
      typed: source.enabledPlugins.typed,
    },
    reviewCount: source.reviewCount,
  }
}

function exportJson() {
  try {
    const data = {
      kind: formatKind,
      version: 1,
      exportedAt: new Date().toISOString(),
      data: demo.data,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    urls.add(url)
    const link = document.createElement('a')
    link.href = url
    link.download = `repeaty-design-b-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    exported.value = true
    notice('JSON 文件已生成，请查看浏览器下载。')
    setTimeout(() => {
      URL.revokeObjectURL(url)
      urls.delete(url)
    }, 1000)
  } catch {
    error.value = '无法生成文件，请重试。'
  }
}

async function chooseFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const sequence = ++readSequence
  error.value = ''
  pending.value = null
  reading.value = true
  try {
    if (!file.name.toLowerCase().endsWith('.json')) throw new Error('请选择 JSON 文件。')
    if (file.size > 2 * 1024 * 1024) throw new Error('文件过大，请选择 2 MB 以内的 JSON 文件。')
    const parsed = JSON.parse(await file.text())
    if (!active || sequence !== readSequence) return
    pending.value = validateFile(parsed)
    pendingName.value = file.name
    restoreOpen.value = true
  } catch (cause) {
    if (active && sequence === readSequence)
      error.value =
        cause instanceof SyntaxError
          ? '文件不是有效的 JSON，请重新选择。'
          : cause.message || '无法读取文件，请重试。'
  } finally {
    if (active && sequence === readSequence) reading.value = false
  }
}

function restore() {
  if (!pending.value) return
  const restored = pending.value
  const success = commit((data) => {
    data.decks = restored.decks
    data.cards = restored.cards
    data.settings = restored.settings
    data.enabledPlugins = restored.enabledPlugins
    data.reviewCount = restored.reviewCount
  }, '已恢复 JSON 中的数据')
  if (success) {
    restoreOpen.value = false
    pending.value = null
    if (!restored.decks.some((deck) => deck.id === demo.selectedDeck))
      demo.selectedDeck = restored.decks[0]?.id || null
  }
}
</script>

<template>
  <section class="backup-page">
    <header class="page-head">
      <div>
        <h1>备份与恢复</h1>
        <p class="muted">导出当前卡片和设置，或从已有的 JSON 文件恢复。</p>
      </div>
    </header>
    <PMessage v-if="error" severity="error" :closable="false" class="file-error">{{
      error
    }}</PMessage>
    <section class="surface data-overview" aria-label="当前数据">
      <span class="overview-icon"
        ><FileJson :size="28" :stroke-width="1.6" aria-hidden="true"
      /></span>
      <div>
        <h2>当前数据</h2>
        <p class="meta muted">内容与设置将保存在同一个 JSON 文件中。</p>
      </div>
      <dl class="data-stats">
        <div>
          <dt>卡组</dt>
          <dd>{{ demo.data.decks.length }}</dd>
        </div>
        <div>
          <dt>卡片记录</dt>
          <dd>{{ currentCards }}</dd>
        </div>
      </dl>
    </section>
    <div class="transfer-grid">
      <section class="surface transfer-card">
        <span class="transfer-icon"
          ><Download :size="25" :stroke-width="1.7" aria-hidden="true"
        /></span>
        <h2>导出 JSON</h2>
        <p class="muted">下载当前卡片、卡组、插件状态和设置，方便之后恢复。</p>
        <div class="included">
          <ShieldCheck :size="17" aria-hidden="true" /><span class="meta"
            >文件保存在你选择的下载位置。</span
          >
        </div>
        <PButton label="导出 JSON" @click="exportJson"
          ><template #icon><Download :size="18" aria-hidden="true" /></template
        ></PButton>
        <p v-if="exported" class="exported-note meta" role="status">
          <Check :size="16" aria-hidden="true" />文件已生成
        </p>
      </section>
      <section class="surface transfer-card">
        <span class="transfer-icon secondary"
          ><Upload :size="25" :stroke-width="1.7" aria-hidden="true"
        /></span>
        <h2>恢复 JSON</h2>
        <p class="muted">选择从此页面导出的文件。检查文件内容后，再确认是否替换当前数据。</p>
        <div class="included">
          <FileJson :size="17" aria-hidden="true" /><span class="meta"
            >支持 .json 文件，最大 2 MB。</span
          >
        </div>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="hidden-file"
          tabindex="-1"
          aria-hidden="true"
          @change="chooseFile"
        /><PButton
          label="选择 JSON 文件"
          severity="secondary"
          :loading="reading"
          :disabled="reading"
          @click="fileInput?.click()"
          ><template #icon><FolderOpen v-if="!reading" :size="18" aria-hidden="true" /></template
        ></PButton>
      </section>
    </div>
  </section>
  <PDialog
    v-model:visible="restoreOpen"
    modal
    header="恢复文件中的数据？"
    :style="{ width: '530px', maxWidth: 'calc(100vw - 32px)' }"
  >
    <div v-if="pending" class="restore-body">
      <p class="restore-filename">
        <FileJson :size="20" aria-hidden="true" /><span>{{ pendingName }}</span>
      </p>
      <div class="restore-comparison">
        <div>
          <span class="meta muted">当前</span><strong>{{ demo.data.decks.length }} 个卡组</strong
          ><span>{{ currentCards }} 条卡片记录</span>
        </div>
        <ArrowRight :size="20" aria-hidden="true" />
        <div>
          <span class="meta muted">恢复后</span><strong>{{ pending.decks.length }} 个卡组</strong
          ><span>{{ pending.cards.length }} 条卡片记录</span>
        </div>
      </div>
      <PMessage severity="warn" :closable="false"
        >当前卡片和设置将被文件中的内容替换。建议先导出当前数据。</PMessage
      >
      <div class="actions restore-actions">
        <PButton label="取消" severity="secondary" @click="restoreOpen = false" /><PButton
          label="确认替换"
          @click="restore"
        />
      </div>
    </div>
  </PDialog>
</template>

<style scoped>
.backup-page {
  margin: 0 auto;
}
.file-error {
  margin-top: 22px;
}
.data-overview {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 28px 30px;
  margin-top: 30px;
}
.overview-icon {
  width: 60px;
  height: 60px;
  background: #e5eddf;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #34674d;
  flex-shrink: 0;
}
.data-overview h2 {
  font-size: 1.125rem;
  margin: 0 0 8px;
}
.data-overview p {
  margin: 0;
  line-height: 1.7;
}
.data-stats {
  display: flex;
  gap: 34px;
  margin: 0 0 0 auto;
  padding-left: 24px;
  white-space: nowrap;
}
.data-stats > div {
  display: flex;
  flex-direction: column-reverse;
  gap: 5px;
}
.data-stats dt {
  font-size: 0.875rem;
  color: #52665a;
}
.data-stats dd {
  font-size: 1.75rem;
  letter-spacing: -0.04em;
  font-weight: 600;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.transfer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 24px;
}
.transfer-card {
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.transfer-icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  background: #e5eddf;
  border-radius: 10px;
  color: #34674d;
}
.transfer-icon.secondary {
  background: #edf0e9;
  color: #52665a;
}
.transfer-card h2 {
  font-size: 1.375rem;
  margin: 23px 0 10px;
}
.transfer-card > p.muted {
  line-height: 1.8;
  margin: 0 0 24px;
}
.included {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  line-height: 1.7;
  color: #52665a;
  margin: auto 0 24px;
}
.included svg {
  flex-shrink: 0;
  margin-top: 3px;
}
.transfer-card :deep(.p-button) {
  min-width: 160px;
}
.exported-note {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #34674d;
  margin: 13px 0 0;
}
.hidden-file {
  display: none;
}
.restore-body {
  display: grid;
  gap: 22px;
}
.restore-filename {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.restore-filename svg {
  flex-shrink: 0;
  margin-top: 4px;
}
.restore-comparison {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 20px;
  padding: 22px;
  background: #f3f5f0;
  border-radius: 10px;
}
.restore-comparison > div {
  display: grid;
  gap: 9px;
}
.restore-comparison strong {
  font-size: 1.125rem;
}
.restore-comparison > svg {
  color: #64816d;
}
.restore-actions {
  justify-content: flex-end;
}
@media (max-width: 760px) {
  .data-overview {
    padding: 24px;
    gap: 16px;
    flex-wrap: wrap;
  }
  .data-overview > div {
    flex: 1;
    min-width: 180px;
  }
  .data-stats {
    margin: 8px 0 0 76px;
    padding-left: 0;
    gap: 40px;
  }
  .transfer-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .transfer-card {
    padding: 26px;
  }
  .transfer-card > p.muted {
    max-width: 580px;
  }
  .transfer-card h2 {
    margin-top: 19px;
  }
}
@media (max-width: 440px) {
  .data-overview {
    padding: 22px 18px;
  }
  .overview-icon {
    width: 48px;
    height: 48px;
  }
  .data-overview > div {
    min-width: 160px;
  }
  .data-stats {
    margin-left: 64px;
  }
  .restore-comparison {
    gap: 12px;
    padding: 18px 14px;
  }
  .restore-comparison strong {
    font-size: 1rem;
  }
  .restore-comparison > div > span:last-child {
    font-size: 0.875rem;
  }
  .restore-actions {
    flex-wrap: wrap;
  }
}
</style>
