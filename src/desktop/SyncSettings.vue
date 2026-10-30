<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { locale, t } from '../i18n'
import { SettingField, SettingGroup, UiButton, UiCollapsible, UiNotice } from '../components/ui'
import { ChevronDown } from '@lucide/vue'
import AppModal from '../components/AppModal.vue'
import { isPrivateSyncAddress, syncUiKey, type SyncAction } from '../sync/ui'

const controller = inject(syncUiKey, undefined)
const state = computed(() => controller?.state.value)
const pendingAction = ref<SyncAction['type'] | null>(null)
const pairingOpen = ref(!state.value?.groupId)
const cancelling = ref(false)
const localError = ref(''),
  leaving = ref(false),
  copied = ref(false),
  revealed = ref(false),
  address = ref(state.value?.address ?? ''),
  addressError = ref(''),
  invite = ref(''),
  removing = ref<string | null>(null),
  resolving = ref<string | null>(null)
const busy = computed(
  () => !!pendingAction.value || cancelling.value || state.value?.phase === 'busy',
)
const unavailable = computed(() => !state.value?.available || busy.value)
const connected = computed(
  () => !!state.value?.groupId && !!state.value.enabled && !state.value.paused,
)
const scope = computed(
  () => `${state.value?.available}/${state.value?.deviceId ?? ''}/${state.value?.groupId ?? ''}`,
)
const peer = computed(() => state.value?.peers.find((entry) => entry.id === removing.value))
const conflict = computed(() =>
  state.value?.conflicts.find((entry) => entry.id === resolving.value),
)
function scheduleSummary(value: unknown) {
  if (!conflict.value?.fields.includes('schedule') || !value || typeof value !== 'object')
    return null
  const schedule = value as { due?: unknown; reps?: unknown; lapses?: unknown }
  if (
    typeof schedule.due !== 'string' ||
    !Number.isFinite(Date.parse(schedule.due)) ||
    typeof schedule.reps !== 'number' ||
    typeof schedule.lapses !== 'number'
  )
    return null
  return {
    due: new Date(schedule.due).toLocaleString(locale.value),
    reps: schedule.reps,
    lapses: schedule.lapses,
  }
}
const versions = computed(() =>
  [
    {
      choice: 'local' as const,
      title: '本机版本',
      button: '使用本机版本',
      value: conflict.value?.local,
    },
    {
      choice: 'remote' as const,
      title: '远端版本',
      button: '使用远端版本',
      value: conflict.value?.remote,
    },
  ].map((entry) => ({ ...entry, schedule: scheduleSummary(entry.value) })),
)
const statusLabel = computed(() => {
  if (!state.value?.available) return '请先打开桌面工作目录。'
  if (state.value.phase === 'error') return '同步需要处理'
  if (busy.value) return '正在处理同步'
  if (!state.value.enabled) return '同步尚未启动'
  if (state.value.paused) return '同步已暂停'
  return state.value.groupId ? '等待同步' : '尚未配对'
})
let alive = true,
  generation = 0
watch(scope, () => {
  generation++
  pendingAction.value = null
  cancelling.value = false
  localError.value = ''
  addressError.value = ''
  invite.value = ''
  revealed.value = false
  copied.value = false
  removing.value = null
  leaving.value = false
  resolving.value = null
  address.value = state.value?.address ?? ''
  pairingOpen.value = !state.value?.groupId
})
watch(
  () => state.value?.address,
  (next, previous) => {
    if (!address.value || address.value === previous) address.value = next ?? ''
  },
)
watch(
  () => state.value?.invite,
  () => {
    revealed.value = false
    copied.value = false
  },
)
onUnmounted(() => {
  alive = false
  generation++
  invite.value = ''
})
async function run(action: SyncAction): Promise<boolean> {
  if (!controller || !state.value?.available || (busy.value && action.type !== 'cancel'))
    return false
  if (action.type === 'cancel' && cancelling.value) return false
  if (
    action.type === 'apply' &&
    (state.value.blockedReason || !state.value.preview || state.value.conflicts.length)
  )
    return false
  const current = generation
  if (action.type === 'cancel') cancelling.value = true
  else pendingAction.value = action.type
  localError.value = ''
  try {
    await controller.run(action)
    return alive && current === generation && controller.state.value.phase !== 'error'
  } catch {
    // Transport exceptions may contain invitation material. Only render the controller's safe state.
    if (alive && current === generation) localError.value = '同步操作未完成，请重试。'
    return false
  } finally {
    if (alive && current === generation) {
      if (action.type === 'cancel') cancelling.value = false
      else if (pendingAction.value === action.type) pendingAction.value = null
    }
  }
}
async function listen() {
  const value = address.value.trim()
  addressError.value = isPrivateSyncAddress(value) ? '' : '请输入私有局域网或回环 IP 地址与端口。'
  if (!addressError.value) await run({ type: 'listen', address: value })
}
function updateAddress(value: unknown) {
  address.value = String(value)
  addressError.value = ''
}
async function join() {
  if (!invite.value.trim()) return
  const listener = address.value.trim()
  addressError.value = isPrivateSyncAddress(listener)
    ? ''
    : '请输入私有局域网或回环 IP 地址与端口。'
  if (addressError.value) return
  if (listener !== state.value?.address && !(await run({ type: 'listen', address: listener })))
    return
  if (await run({ type: 'join', invite: invite.value.trim() })) invite.value = ''
}
async function copyInvite() {
  const value = state.value?.invite
  if (!value || unavailable.value) return
  const current = generation
  localError.value = ''
  try {
    await navigator.clipboard.writeText(value)
    if (alive && current === generation && state.value?.invite === value) copied.value = true
  } catch {
    if (alive && current === generation) localError.value = '无法复制邀请，请显示后手动复制。'
  }
}
async function revoke() {
  if (peer.value && (await run({ type: 'revoke', id: peer.value.id }))) removing.value = null
}
async function leave() {
  if (await run({ type: 'leave' })) leaving.value = false
}
async function resolve(choice: 'local' | 'remote') {
  if (conflict.value && (await run({ type: 'resolve', id: conflict.value.id, choice })))
    resolving.value = null
}
function display(value: unknown) {
  if (value === undefined) return t('此字段不存在')
  if (value === null) return t('此记录已删除')
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? '—'
  } catch {
    return t('无法显示此版本，请重新检查。')
  }
}
const stores: Record<string, string> = {
  notes: '笔记',
  cards: '卡片',
  decks: '卡组',
  sources: '学习材料',
  reviews: '评分记录',
  practices: '练习记录',
  attempts: '答题记录',
  media: '附件',
  documents: '笔记正文',
  savedSearches: '保存的搜索',
  studySettings: '学习设置',
  studyEvents: '学习事件',
  studyActivity: '学习活动',
  fsrsModels: '记忆模型',
  materialFolders: '材料文件夹',
  materialCollections: '材料集合',
  materialReceipts: '材料记录',
  sourceConnections: '材料连接',
  sourceCandidates: '候选材料',
  automationReceipts: '自动化记录',
}
const fields: Record<string, string> = {
  front: '问题',
  back: '答案',
  title: '标题',
  name: '名称',
  description: '说明',
  schedule: '复习安排',
  tags: '标签',
  deckId: '所属卡组',
  noteId: '所属笔记',
  sourceId: '来源材料',
  frontMedia: '问题附件',
  backMedia: '答案附件',
  content: '正文',
  text: '正文',
  data: '插件内容',
  plugin: '插件内容',
  suspended: '暂停状态',
  variant: '卡片变体',
  position: '顺序',
  parentId: '所属文件夹',
  rating: '评分',
  code: '作答代码',
  format: '内容格式',
  type: '内容类型',
}
function storeLabel(store: string) {
  if (store === 'values:settings') return t('插件设置')
  if (store.startsWith('values:')) return t('插件数据')
  if (store.startsWith('retired:'))
    return `${t('已退役')} · ${t(stores[store.slice(8)] ?? '学习记录')}`
  return t(stores[store] ?? '学习记录')
}
function fieldLabel(field: string) {
  return t(fields[field] ?? '内容字段')
}
</script>

<template>
  <div class="sync-settings" :aria-busy="busy" :aria-label="t('设备同步')">
    <UiNotice v-if="localError || state?.error" tone="error">{{
      t(localError || state?.error || '')
    }}</UiNotice>
    <p v-if="state?.message" class="sync-message" role="status">{{ t(state.message) }}</p>
    <SettingGroup
      :title="t('局域网同步')"
      :description="t('在同一局域网内交换学习库更新。收到内容后，先检查再合入。')"
    >
      <div class="sync-status-row">
        <p class="sync-status" role="status">{{ t(statusLabel) }}</p>
        <div class="sync-actions">
          <UiButton
            v-if="!state?.enabled"
            variant="primary"
            :disabled="unavailable"
            @click="run({ type: 'start' })"
            >{{ t('启动同步') }}</UiButton
          >
          <UiButton
            v-else-if="state.paused"
            variant="primary"
            :disabled="unavailable"
            @click="run({ type: 'resume' })"
            >{{ t('恢复同步') }}</UiButton
          >
          <UiButton
            v-else
            :variant="state?.pending ? 'secondary' : 'primary'"
            :disabled="unavailable || !connected || !state?.peers.length"
            @click="run({ type: 'exchange' })"
            >{{ t('立即交换更新') }}</UiButton
          >
          <UiButton
            v-if="state?.enabled && !state.paused"
            :disabled="unavailable"
            @click="run({ type: 'pause' })"
            >{{ t('暂停同步') }}</UiButton
          >
          <UiButton
            v-if="busy"
            :disabled="cancelling || pendingAction === 'apply'"
            @click="run({ type: 'cancel' })"
            >{{ t('取消当前操作') }}</UiButton
          >
          <UiButton
            v-else
            variant="ghost"
            :disabled="unavailable"
            @click="run({ type: 'refresh' })"
            >{{ t('刷新状态') }}</UiButton
          >
        </div>
      </div>
      <dl v-if="state?.deviceId" class="sync-facts">
        <div>
          <dt>{{ t('本机设备') }}</dt>
          <dd>{{ state.deviceId }}</dd>
        </div>
        <div v-if="state.groupId">
          <dt>{{ t('同步组') }}</dt>
          <dd>{{ state.groupId }}</dd>
        </div>
      </dl>
      <UiButton
        v-if="state?.groupId"
        variant="ghost"
        :disabled="unavailable"
        @click="leaving = true"
        >{{ t('退出同步组') }}</UiButton
      >
    </SettingGroup>

    <SettingGroup :title="t('接收的更新')">
      <p>{{ t('待检查 {count} 项更新', { count: state?.pending ?? 0 }) }}</p>
      <UiNotice v-if="state?.blockedReason" tone="warning">{{ t(state.blockedReason) }}</UiNotice>
      <p class="sync-help">
        {{ t('复习、阅读或编辑进行中时不能合入。先结束当前操作，学习内容才会更新。') }}
      </p>
      <ul v-if="state?.conflicts.length" class="sync-list" :aria-label="t('待处理冲突')">
        <li v-for="entry in state.conflicts" :key="entry.id">
          <div class="sync-entry">
            <strong>{{ entry.label || entry.recordId.slice(0, 12) }}</strong
            ><span class="sync-help"
              >{{ storeLabel(entry.store) }} ·
              {{ entry.fields.map(fieldLabel).join('、') || t('整个记录') }}</span
            >
          </div>
          <UiButton :disabled="unavailable" @click="resolving = entry.id">{{
            t('查看并处理')
          }}</UiButton>
        </li>
      </ul>
      <p v-if="state?.preview" class="sync-preview" role="status">
        {{ t('将合入 {changes} 项内容与 {events} 条变更记录。', state.preview) }}
      </p>
      <div class="sync-actions">
        <UiButton
          :disabled="unavailable || !state?.pending || !!state?.conflicts.length"
          @click="run({ type: 'preview' })"
          >{{ t('预览合入') }}</UiButton
        >
        <UiButton
          variant="primary"
          :disabled="
            unavailable || !state?.preview || !!state?.blockedReason || !!state?.conflicts.length
          "
          @click="run({ type: 'apply' })"
          >{{ t('确认合入学习库') }}</UiButton
        >
      </div>
    </SettingGroup>

    <SettingGroup
      :title="t('设备与配对')"
      :description="t('只与自己信任的设备配对。请核对设备标识后批准加入。')"
    >
      <UiCollapsible v-model:open="pairingOpen" class="sync-pairing-disclosure">
        <template #default="{ open }">
          <UiButton variant="ghost" :aria-expanded="open">
            {{ t('添加设备或更改连接')
            }}<ChevronDown :size="16" :class="{ 'sync-chevron-open': open }" aria-hidden="true" />
          </UiButton>
        </template>
        <template #content
          ><div class="sync-pairing-fields">
            <form class="sync-form" @submit.prevent="listen">
              <SettingField
                :label="t('本机监听地址')"
                :model-value="address"
                :error="addressError ? t(addressError) : undefined"
                :disabled="unavailable"
                placeholder="192.168.1.8:43127"
                autocomplete="off"
                :spellcheck="false"
                :description="
                  t('手动填写本机私有 IP 与端口，例如 192.168.1.8:43127。回环地址只用于本机连接。')
                "
                @update:model-value="updateAddress"
              />
              <UiButton type="submit" :disabled="unavailable || !address.trim()">{{
                t('设置监听地址')
              }}</UiButton>
            </form>
            <div class="sync-pairing">
              <div class="sync-actions">
                <UiButton
                  :disabled="unavailable || !connected || !state?.address"
                  @click="run({ type: 'invite' })"
                  >{{ t('生成配对邀请') }}</UiButton
                >
              </div>
              <template v-if="state?.invite">
                <p class="sync-help">{{ t('邀请含有配对密钥。请通过可信方式交给另一台设备。') }}</p>
                <div class="sync-actions">
                  <UiButton
                    variant="ghost"
                    :disabled="unavailable"
                    :aria-expanded="revealed"
                    @click="revealed = !revealed"
                    >{{ t(revealed ? '隐藏邀请' : '显示邀请') }}</UiButton
                  >
                  <UiButton :disabled="unavailable" @click="copyInvite">{{
                    t('复制邀请')
                  }}</UiButton>
                  <span v-if="copied" role="status">{{ t('邀请已复制。') }}</span>
                </div>
                <SettingField
                  v-if="revealed"
                  type="textarea"
                  :label="t('配对邀请')"
                  :model-value="state.invite"
                  readonly
                  monospace
                  :rows="3"
                  autocomplete="off"
                  :spellcheck="false"
                />
              </template>
            </div>
            <form class="sync-form" @submit.prevent="join">
              <SettingField
                type="password"
                :label="t('另一台设备的邀请')"
                :model-value="invite"
                :disabled="unavailable"
                autocomplete="off"
                :spellcheck="false"
                :description="t('粘贴邀请后申请加入，并在另一台设备上批准。')"
                @update:model-value="invite = String($event)"
              />
              <UiButton type="submit" :disabled="unavailable || !invite.trim()">{{
                t('申请加入')
              }}</UiButton>
            </form>
          </div></template
        >
      </UiCollapsible>
      <ul v-if="state?.requests.length" class="sync-list" :aria-label="t('加入申请')">
        <li v-for="request in state.requests" :key="request.id">
          <div class="sync-entry">
            <strong>{{ request.name }}</strong
            ><span class="sync-id">{{ request.id }}</span>
          </div>
          <div class="sync-actions">
            <UiButton :disabled="unavailable" @click="run({ type: 'approve', id: request.id })">{{
              t('批准加入')
            }}</UiButton
            ><UiButton
              variant="ghost"
              :disabled="unavailable"
              @click="run({ type: 'reject', id: request.id })"
              >{{ t('拒绝') }}</UiButton
            >
          </div>
        </li>
      </ul>
      <ul v-if="state?.peers.length" class="sync-list" :aria-label="t('已配对设备')">
        <li v-for="device in state.peers" :key="device.id">
          <div class="sync-entry">
            <strong>{{ device.name }}</strong
            ><span class="sync-id">{{ device.id }}</span
            ><span class="sync-help">{{ device.address }}</span>
          </div>
          <UiButton variant="ghost" :disabled="unavailable" @click="removing = device.id">{{
            t('移除设备')
          }}</UiButton>
        </li>
      </ul>
      <p v-else class="sync-help">{{ t('尚未连接其他设备。') }}</p>
    </SettingGroup>

    <SettingGroup
      :title="t('同步诊断')"
      :description="t('查看连接状态、协议和传输计数。诊断不包含正文、邀请密钥或凭据。')"
    >
      <UiButton :disabled="unavailable" @click="run({ type: 'diagnostics' })">{{
        t('查看同步诊断')
      }}</UiButton>
    </SettingGroup>

    <AppModal v-if="leaving" :title="t('退出同步组')" :busy="busy" @close="leaving = false">
      <p>
        {{
          t(
            '退出后停止同步并移除本机保存的配对授权。学习内容和插件数据保留，旧同步日志归档后不再交换。',
          )
        }}
      </p>
      <div class="sync-actions sync-modal-actions">
        <UiButton :disabled="busy" @click="leaving = false">{{ t('取消') }}</UiButton
        ><UiButton variant="danger" :disabled="unavailable" @click="leave">{{
          t('确认退出同步组')
        }}</UiButton>
      </div>
    </AppModal>
    <AppModal v-if="peer" :title="t('移除设备')" :busy="busy" @close="removing = null">
      <p>
        {{
          t('移除“{name}”后，此设备不能继续同步。已下载的内容仍保留在对方设备上。', {
            name: peer.name,
          })
        }}
      </p>
      <p class="sync-id">{{ peer.id }}</p>
      <div class="sync-actions sync-modal-actions">
        <UiButton :disabled="busy" @click="removing = null">{{ t('取消') }}</UiButton
        ><UiButton variant="danger" :disabled="unavailable" @click="revoke">{{
          t('确认移除')
        }}</UiButton>
      </div>
    </AppModal>
    <AppModal
      v-if="conflict"
      :title="t('处理同步冲突')"
      :busy="busy"
      wide
      @close="resolving = null"
    >
      <p>{{ conflict.label || conflict.recordId.slice(0, 12) }}</p>
      <p class="sync-help">
        {{ storeLabel(conflict.store) }} ·
        {{ conflict.fields.map(fieldLabel).join('、') || t('整个记录') }}
      </p>
      <UiCollapsible>
        <UiButton variant="ghost">{{ t('查看记录标识') }}</UiButton>
        <template #content
          ><p class="sync-id">{{ conflict.recordId }}</p></template
        >
      </UiCollapsible>
      <p class="sync-help">{{ t('选择要使用的版本，再预览并确认合入。') }}</p>
      <UiNotice v-if="versions.some((entry) => entry.schedule)" tone="info">{{
        t('两边的评分历史都会保留。这里只选择之后使用的复习安排。')
      }}</UiNotice>
      <div class="sync-versions">
        <section v-for="version in versions" :key="version.choice">
          <h3>{{ t(version.title) }}</h3>
          <template v-if="version.schedule">
            <dl class="sync-schedule">
              <div>
                <dt>{{ t('下次复习时间') }}</dt>
                <dd>{{ version.schedule.due }}</dd>
              </div>
              <div>
                <dt>{{ t('复习次数') }}</dt>
                <dd>{{ version.schedule.reps }}</dd>
              </div>
              <div>
                <dt>{{ t('遗忘次数') }}</dt>
                <dd>{{ version.schedule.lapses }}</dd>
              </div>
            </dl>
            <UiCollapsible
              ><UiButton variant="ghost">{{ t('查看完整复习安排') }}</UiButton>
              <template #content>
                <pre>{{ display(version.value) }}</pre>
              </template>
            </UiCollapsible>
          </template>
          <pre v-else>{{ display(version.value) }}</pre>
          <UiButton :disabled="unavailable" @click="resolve(version.choice)">{{
            t(version.button)
          }}</UiButton>
        </section>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.sync-settings {
  display: grid;
  gap: 2rem;
  min-width: 0;
}
.sync-settings > :deep(.ui-setting-group) {
  border: 0;
  box-shadow: none;
  border-radius: 0;
  background: transparent;
}
.sync-settings > :deep(.ui-setting-group > [data-slot='header']),
.sync-settings > :deep(.ui-setting-group > [data-slot='body']) {
  padding-inline: 0;
}
.sync-settings > :deep(.ui-setting-group > [data-slot='header']) {
  border-bottom: 0;
}
.sync-actions,
.sync-status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.sync-status-row {
  justify-content: space-between;
  gap: 1rem;
}
.sync-status {
  color: var(--ui-text);
  font-weight: 600;
}
.sync-help,
.sync-facts dt {
  color: var(--ui-text-muted);
  font-size: var(--font-size-meta);
  line-height: 1.65;
}
.sync-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sync-facts {
  display: grid;
  gap: 0.75rem;
}
.sync-facts > div {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  gap: 1rem;
}
.sync-facts dd,
.sync-id {
  font-family: var(--font-mono);
  font-size: var(--font-size-meta);
  overflow-wrap: anywhere;
}
.sync-form,
.sync-pairing {
  display: grid;
  gap: 1rem;
}
.sync-pairing-fields {
  display: grid;
  gap: 1.5rem;
  padding-top: 1rem;
}
.sync-chevron-open {
  transform: rotate(180deg);
}
.sync-form > :deep(button) {
  justify-self: start;
}
.sync-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sync-list > li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  padding-block: 1rem;
  border-bottom: 1px solid var(--line);
}
.sync-entry {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  flex: 1 1 12rem;
  overflow-wrap: anywhere;
}
.sync-preview {
  color: var(--ui-text);
  font-weight: 500;
}
.sync-modal-actions {
  justify-content: flex-end;
  margin-top: 1.5rem;
}
.sync-versions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.5rem;
  margin-top: 1.5rem;
}
.sync-versions section {
  display: grid;
  align-content: start;
  gap: 1rem;
  min-width: 0;
}
.sync-versions h3 {
  font-size: var(--font-size-body);
  font-weight: 600;
}
.sync-schedule {
  display: grid;
  gap: 0.75rem;
}
.sync-schedule > div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  justify-content: space-between;
}
.sync-schedule dt {
  color: var(--ui-text-muted);
}
.sync-versions pre {
  max-height: 24rem;
  overflow: auto;
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--sage);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--font-size-meta);
  line-height: 1.65;
}
@media (max-width: 640px) {
  .sync-versions {
    grid-template-columns: minmax(0, 1fr);
  }
  .sync-facts > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.25rem;
  }
}
</style>
