import { computed, shallowRef } from 'vue'
import { z } from 'zod'
import type { Library } from '../core/model'
import type { RetiredNote } from '../desktop/retirement'
import {
  planSync,
  type SyncChoice,
  type SyncConflict,
  type SyncPlan,
  type SyncPlanInput,
} from './merge'
import { libraryFromSnapshot, snapshotToRetired, syncRow, validateSyncSnapshot } from './projection'
import {
  canonicalSyncValue,
  parseSyncClock,
  parseSyncEvents,
  sameSyncValue,
  SYNC_LIMITS,
  type SyncClock,
  type SyncEvent,
  type SyncSnapshot,
} from './protocol'
import type { SyncCommit } from './commit'
import {
  isPrivateSyncAddress,
  type SyncAction,
  type SyncUiController,
  type SyncUiState,
} from './ui'

export type SyncRequest = (method: string, payload?: unknown) => Promise<unknown>
export interface DeviceSyncOptions {
  scope: string
  current(): boolean
  blockedReason(): string | null
  apply(
    scope: string,
    revision: number,
    library: Library,
    options: { retired: RetiredNote[]; sync: SyncCommit },
  ): Promise<void>
  afterApply?(): Promise<void>
}
export interface DeviceSyncController extends SyncUiController {
  refresh(): Promise<void>
  dispose(): Promise<void>
}
export const emptySyncUiState = (): SyncUiState => ({
  available: false,
  phase: 'idle',
  enabled: false,
  paused: false,
  deviceId: '',
  groupId: null,
  address: '',
  invite: null,
  peers: [],
  requests: [],
  pending: 0,
  conflicts: [],
  preview: null,
  message: null,
  error: null,
  blockedReason: null,
})

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const journalSchema = z.object({
  groupId: z.string().nullable(),
  clock: z.unknown(),
  pending: count,
  receivedClock: z.unknown().optional(),
})
const peerSchema = z.object({ id: z.string(), name: z.string(), address: z.string() })
const statusSchema = z.object({
  transport: z.object({
    deviceId: z.string(),
    enabled: z.boolean(),
    paused: z.boolean(),
    listenAddress: z.string().nullable(),
    group: z.string().nullable(),
    peers: z.array(peerSchema).max(32),
    pending: z.array(z.object({ id: z.string(), name: z.string() })).max(128),
    errors: z.array(z.string()).max(100),
  }),
  journal: journalSchema,
})
const snapshotSchema = z.object({ snapshot: z.unknown(), status: journalSchema, revision: count })
const objectSchema = z.object({
  kind: z.enum(['media', 'document']),
  id: z.string().min(1).max(512),
  mime: z.string().max(256),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  size: count,
})
const CHUNK_BYTES = 262144
const inventorySchema = z.object({
  objects: z.array(objectSchema).max(200_000),
  chunkSize: z.literal(CHUNK_BYTES),
})
const progressSchema = z.object({
  complete: z.boolean(),
  received: z.array(count),
  chunkSize: z.literal(CHUNK_BYTES),
})
const chunkSchema = z.object({
  data: z.string().max(Math.ceil(CHUNK_BYTES / 3) * 4),
  chunkHash: z.string().regex(/^[a-f0-9]{64}$/),
  offset: count,
})
const cancelled = () => new Error('sync-cancelled')
const invalid = () => new Error('sync-invalid-response')

/** Redact exceptions by translating known codes; never echo transport or invitation payloads. */
export function syncErrorMessage(issue: unknown): string {
  const code = typeof issue === 'string' ? issue : issue instanceof Error ? issue.message : ''
  const messages: Record<string, string> = {
    'sync-cancelled': '同步已取消，已接收的更新仍保留。',
    'sync-preview-stale': '学习库已变化，请重新预览合入。',
    'sync-already-grouped': '当前学习库已加入其他同步组，不能直接更换配对。',
    'sync-invalid-invitation': '邀请无效或已过期，请重新生成。',
    'sync-pairing-expired': '邀请无效或已过期，请重新生成。',
    'sync-pairing-rejected': '对方拒绝了加入申请。',
    'sync-listen-failed': '无法使用这个本机地址，请检查 IP、端口和网络权限。',
    'sync-invalid-address': '请输入私有局域网或回环 IP 地址与端口。',
    'sync-address-required': '请先填写并设置本机监听地址。',
    'sync-protocol-incompatible': '设备协议不兼容，请将两端更新到兼容版本。',
    'sync-incompatible': '设备协议不兼容，请将两端更新到兼容版本。',
    'sync-unreachable': '无法连接对方设备，请检查局域网地址、监听状态和防火墙。',
    'sync-disconnected': '连接已断开，已收到的更新保留，可以重新交换。',
    'sync-timeout': '连接等待超时，请检查对方设备后重试。',
    'sync-authentication-failed': '设备认证失败，请检查配对是否已被撤销。',
    'sync-not-listening': '请先填写并设置本机监听地址。',
    'sync-paused': '同步已暂停，请恢复后重试。',
    'sync-disk-full': '磁盘空间不足，已接收的分块保留，请释放空间后重试。',
    'sync-hash-mismatch': '附件校验失败，未合入学习库，请重新交换。',
    'sync-object-conflict': '同一附件标识的内容不同，已停止合入以保留原有内容。',
    'sync-object-incomplete': '所需附件尚未传输完成，请继续交换更新。',
    'sync-object-limit': '附件超过传输上限，原数据和待处理更新均保留。',
    'sync-batch-limit':
      '单次合入最多处理 10 万条更新、10 万项变更和 64 MiB；本次未合入，待处理更新保留。',
    'sync-dependency-missing': '部分更新缺少前序记录，请与原设备继续交换。',
    'sync-conflict-blocked': '请先处理冲突，再确认合入。',
    'sync-structure-conflict': '关联记录存在冲突，当前无法合入；双方版本仍保留。',
    'sync-object-missing': '所需附件尚未传输完成，请继续交换更新。',
    'sync-no-peers': '请先配对另一台设备。',
    'sync-not-enabled': '请先启动同步并设置本机监听地址。',
    'sync-study-active': '请先结束当前学习或编辑，再合入同步更新。',
    'sync-workspace-changed': '学习库已切换，请重新打开同步设置。',
  }
  return messages[code] ?? '同步操作未完成，请检查连接和待处理状态后重试。'
}

export function createSyncController(
  options: DeviceSyncOptions & { request: SyncRequest },
): DeviceSyncController {
  const data = shallowRef<SyncUiState>({ ...emptySyncUiState(), available: true })
  let alive = true,
    epoch = 0,
    active = false,
    refreshing = false
  let committing = false
  let closing: Promise<void> | undefined
  let preview:
    | {
        source: SyncSnapshot
        revision: number
        clock: SyncClock
        groupId: string
        events: SyncEvent[]
        plan: SyncPlan
      }
    | undefined
  let choices: Record<string, SyncChoice> = Object.create(null)
  const state = computed(() => ({
    ...data.value,
    available: alive && options.current(),
    blockedReason: options.blockedReason(),
  }))
  const update = (patch: Partial<SyncUiState>) => {
    data.value = { ...data.value, ...patch }
  }
  function current(generation: number) {
    if (!alive || generation !== epoch || !options.current()) throw cancelled()
  }
  function request(generation: number): SyncRequest {
    return async (method, payload = {}) => {
      current(generation)
      const result = await options.request(method, payload)
      current(generation)
      return result
    }
  }
  function clearPreview() {
    preview = undefined
    choices = Object.create(null)
    update({ preview: null, conflicts: [] })
  }
  async function status(call: SyncRequest) {
    const result = statusSchema.parse(await call('status'))
    const { transport, journal } = result
    parseSyncClock(journal.clock)
    if (data.value.groupId && data.value.groupId !== journal.groupId) {
      clearPreview()
      update({ invite: null })
    }
    update({
      deviceId: transport.deviceId,
      enabled: transport.enabled,
      paused: transport.paused,
      groupId: journal.groupId,
      address: transport.listenAddress ?? data.value.address,
      peers: transport.peers,
      requests: transport.pending,
      pending: journal.pending,
    })
    return result
  }
  async function snapshot(call: SyncRequest) {
    const raw = snapshotSchema.parse(await call('snapshot'))
    validateSyncSnapshot(raw.snapshot as SyncSnapshot)
    return {
      source: raw.snapshot as SyncSnapshot,
      revision: raw.revision,
      clock: parseSyncClock(raw.status.clock),
      groupId: raw.status.groupId,
    }
  }
  async function events(
    call: SyncRequest,
    clock: SyncClock,
    groupId: string,
  ): Promise<SyncEvent[]> {
    const cursor = { ...clock },
      collected: SyncEvent[] = []
    let bytes = 0,
      changes = 0
    while (true) {
      const batch = parseSyncEvents(
        await call('journal/list', { clock: cursor, limit: 128 }),
        groupId,
      )
      if (!batch.length) return parseSyncEvents(collected, groupId)
      for (const event of batch) {
        if (event.sequence <= (cursor[event.deviceId] ?? 0)) throw invalid()
        cursor[event.deviceId] = event.sequence
        bytes += new TextEncoder().encode(canonicalSyncValue(event)).byteLength
        changes += event.changes.length
        if (bytes > SYNC_LIMITS.bytes || changes > SYNC_LIMITS.changes)
          throw new Error('sync-batch-limit')
      }
      collected.push(...batch)
      if (collected.length > SYNC_LIMITS.events) throw new Error('sync-batch-limit')
    }
  }
  function showPlan(plan: SyncPlan, changedChoices = false) {
    const conflicts = plan.conflicts.filter((entry) => !entry.choice && !entry.supersededBy)
    const applied = new Set(plan.appliedIds)
    const value = (entry: unknown) => {
      const envelope = entry as { present: boolean; value?: unknown }
      return envelope.present ? envelope.value : undefined
    }
    update({
      conflicts: conflicts.map((entry) => ({
        id: entry.id,
        store: entry.store,
        recordId: entry.recordId,
        label: conflictLabel(entry, plan.proposedSnapshot),
        fields: entry.path ? [entry.path] : [],
        local: value(entry.local),
        remote: value(entry.remote),
      })),
      preview:
        plan.blocked || !plan.appliedIds.length
          ? null
          : {
              changes:
                preview?.events.reduce(
                  (total, event) => total + (applied.has(event.id) ? event.changes.length : 0),
                  0,
                ) ?? 0,
              events: plan.appliedIds.length,
            },
      message:
        [
          changedChoices ? '关联冲突已变化，请重新检查剩余的版本选择。' : null,
          plan.pending.length ? syncErrorMessage('sync-dependency-missing') : null,
        ]
          .filter(Boolean)
          .join('\n') || null,
    })
  }
  function planWithChoices(input: SyncPlanInput) {
    try {
      return { plan: planSync(input, choices), changedChoices: false }
    } catch (issue) {
      if (!(issue instanceof Error) || issue.message !== 'sync-stale-choice') throw issue
    }
    const previous = choices
    const retained: Record<string, SyncChoice> = Object.create(null)
    let plan = planSync(input)
    // A choice can change a later conflict on the same record. Rebuild in causal order,
    // retaining only choices whose exact alternatives still exist after earlier choices.
    while (true) {
      const next = plan.conflicts.find(
        (entry) =>
          entry.resolvable &&
          !entry.supersededBy &&
          Object.hasOwn(previous, entry.id) &&
          !Object.hasOwn(retained, entry.id),
      )
      if (!next) break
      retained[next.id] = previous[next.id]!
      plan = planSync(input, retained)
    }
    choices = retained
    return { plan, changedChoices: Object.keys(retained).length !== Object.keys(previous).length }
  }
  function conflictLabel(entry: SyncConflict, next: SyncSnapshot): string {
    const row = (store: string, id: string) => {
      const value = (syncRow(next, store, id) ?? (preview && syncRow(preview.source, store, id)))
        ?.value
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
    }
    let value = row(entry.store, entry.recordId)
    if (typeof value?.practiceId === 'string') value = row('practices', value.practiceId) ?? value
    if (typeof value?.cardId === 'string')
      value = row('cards', value.cardId) ?? row('retired:cards', value.cardId) ?? value
    if (typeof value?.noteId === 'string')
      value = row('notes', value.noteId) ?? row('retired:notes', value.noteId) ?? value
    const title = [value?.front, value?.title, value?.name].find(
      (item): item is string => typeof item === 'string' && !!item.trim(),
    )
    if (!title)
      return entry.store.startsWith('values:')
        ? entry.recordId.slice(0, 80)
        : entry.recordId.slice(0, 12)
    const text = title
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\{\{c\d+::([^}:]*)(?:::[^}]*)?\}\}/g, '$1')
      .replace(/[`*_#~>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return text.length > 80 ? `${text.slice(0, 80)}…` : text || entry.recordId.slice(0, 12)
  }
  async function buildPreview(call: SyncRequest) {
    preview = undefined
    update({ preview: null, conflicts: [] })
    const base = await snapshot(call)
    if (!base.groupId) throw new Error('sync-not-enabled')
    const pending = await events(call, base.clock, base.groupId)
    const check = await snapshot(call)
    if (
      check.groupId !== base.groupId ||
      check.revision !== base.revision ||
      !sameSyncValue(check.clock, base.clock)
    )
      throw new Error('sync-preview-stale')
    const input = {
      snapshot: base.source,
      events: pending,
      appliedClock: base.clock,
      groupId: base.groupId,
    }
    const { plan, changedChoices } = planWithChoices(input)
    preview = { ...base, groupId: base.groupId, events: pending, plan }
    showPlan(plan, changedChoices)
  }
  async function transferObjects(source: SyncRequest, destination: SyncRequest) {
    const { objects } = inventorySchema.parse(await source('objects/info'))
    for (const object of objects) {
      const progress = progressSchema.parse(await destination('objects/info', { object }))
      if (!progress.complete) {
        const received = new Set(progress.received)
        for (let index = 0; index * CHUNK_BYTES < object.size; index++) {
          if (received.has(index)) continue
          const offset = index * CHUNK_BYTES
          const chunk = chunkSchema.parse(await source('objects/read', { object, offset }))
          if (chunk.offset !== offset) throw invalid()
          progressSchema.parse(await destination('objects/write', { object, ...chunk }))
        }
      }
      const finished = z
        .object({ complete: z.literal(true) })
        .parse(await destination('objects/finish', { object }))
      if (!finished.complete) throw invalid()
    }
  }
  async function sendEvents(source: SyncRequest, destination: SyncRequest, groupId: string) {
    const remote = journalSchema.parse(await destination('journal/status'))
    if (remote.groupId !== groupId) throw new Error('sync-workspace-changed')
    // This traversal cursor never becomes the applied frontier. The receiver acknowledges only contiguous receipt.
    const cursor = parseSyncClock(remote.receivedClock ?? {})
    while (true) {
      const batch = parseSyncEvents(
        await source('journal/list', { clock: cursor, limit: 128 }),
        groupId,
      )
      if (!batch.length) return
      const response = z
        .object({ receivedClock: z.unknown() })
        .parse(await destination('journal/receive', { events: batch }))
      parseSyncClock(response.receivedClock)
      for (const event of batch) {
        if (event.sequence <= (cursor[event.deviceId] ?? 0)) throw invalid()
        cursor[event.deviceId] = event.sequence
      }
    }
  }
  async function exchange(call: SyncRequest) {
    clearPreview()
    const currentStatus = await status(call)
    const groupId = currentStatus.journal.groupId
    if (!groupId || !currentStatus.transport.enabled || currentStatus.transport.paused)
      throw new Error('sync-not-enabled')
    if (!currentStatus.transport.peers.length) throw new Error('sync-no-peers')
    for (const peer of currentStatus.transport.peers) {
      const remote: SyncRequest = (method, payload = {}) =>
        call('peer', { peerId: peer.id, method, payload })
      await sendEvents(call, remote, groupId)
      await transferObjects(call, remote)
      await sendEvents(remote, call, groupId)
      await transferObjects(remote, call)
    }
    update({ message: '交换完成。请预览收到的更新，再确认合入。' })
  }
  async function documentBodies(call: SyncRequest, next: SyncSnapshot) {
    const required = new Set(
      Object.values(next.retired.documents ?? {}).map(
        (row) => (row.value as { hash: string }).hash,
      ),
    )
    const result: Record<string, string> = Object.create(null)
    const media = [
      ...Object.values(next.records.media ?? {}),
      ...Object.values(next.retired.media ?? {}),
    ].map((row) => row.value as { id: string; type: string; size: number })
    if (!required.size && !media.length) return result
    const inventory = inventorySchema.parse(await call('objects/info')).objects
    const assets = new Map(
      inventory.filter((entry) => entry.kind === 'media').map((entry) => [entry.id, entry]),
    )
    for (const expected of media) {
      const object = assets.get(expected.id)
      if (
        !object ||
        object.mime !== expected.type ||
        object.size !== expected.size ||
        !progressSchema.parse(await call('objects/info', { object })).complete
      )
        throw new Error('sync-object-missing')
    }
    const documents = new Map(
      inventory.filter((entry) => entry.kind === 'document').map((entry) => [entry.hash, entry]),
    )
    for (const hash of required) {
      const object = documents.get(hash)
      if (!object) throw new Error('sync-object-missing')
      if (object.size > SYNC_LIMITS.bytes) throw new Error('sync-batch-limit')
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let text = ''
      for (let offset = 0; offset < object.size; offset += CHUNK_BYTES) {
        const chunk = chunkSchema.parse(await call('objects/read', { object, offset }))
        if (chunk.offset !== offset) throw invalid()
        const bytes = Uint8Array.from(atob(chunk.data), (character) => character.charCodeAt(0))
        text += decoder.decode(bytes, { stream: true })
      }
      result[hash] = text + decoder.decode()
    }
    return result
  }
  function changedValues(before: SyncSnapshot, after: SyncSnapshot): SyncCommit['values'] {
    const result: SyncCommit['values'] = Object.create(null)
    for (const namespace of new Set([
      ...Object.keys(before.values),
      ...Object.keys(after.values),
    ])) {
      const left = before.values[namespace] ?? {},
        right = after.values[namespace] ?? {}
      for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
        const old = left[id]?.value ?? null,
          next = right[id]?.value ?? null
        if (!sameSyncValue(old, next)) (result[namespace] ??= Object.create(null))[id] = next
      }
    }
    return result
  }
  async function apply(call: SyncRequest, generation: number) {
    if (options.blockedReason()) throw new Error('sync-study-active')
    const pending = preview
    if (!pending || pending.plan.blocked || !pending.plan.appliedIds.length)
      throw new Error('sync-conflict-blocked')
    const latest = await snapshot(call)
    if (
      latest.groupId !== pending.groupId ||
      latest.revision !== pending.revision ||
      !sameSyncValue(latest.clock, pending.clock)
    ) {
      clearPreview()
      throw new Error('sync-preview-stale')
    }
    const bodies = await documentBodies(call, pending.plan.snapshot)
    const retired = snapshotToRetired(pending.plan.snapshot, bodies)
    current(generation)
    if (options.blockedReason()) throw new Error('sync-study-active')
    committing = true
    try {
      await options.apply(
        options.scope,
        pending.revision,
        libraryFromSnapshot(pending.plan.snapshot),
        {
          retired,
          sync: {
            expectedClock: pending.clock,
            clock: pending.plan.clock,
            appliedIds: pending.plan.appliedIds,
            values: changedValues(pending.source, pending.plan.snapshot),
            resolutions: pending.plan.resolutionChanges,
            retiredMedia: Object.fromEntries(
              Object.entries(pending.plan.snapshot.retired.media ?? {}).map(([id, row]) => [
                id,
                row.value,
              ]),
            ),
          },
        },
      )
    } finally {
      committing = false
    }
    current(generation)
    clearPreview()
    update({ message: '同步更新已合入学习库。' })
    try {
      await options.afterApply?.()
    } catch {
      if (alive && generation === epoch && options.current())
        update({ error: '同步已合入，但插件设置暂未刷新，请重新打开学习库。' })
    }
  }
  async function execute(action: SyncAction, call: SyncRequest, generation: number) {
    switch (action.type) {
      case 'refresh':
        await status(call)
        return
      case 'start':
        await call('start', { groupId: data.value.groupId ?? crypto.randomUUID() })
        if (isPrivateSyncAddress(data.value.address))
          await call('listen', { address: data.value.address })
        else update({ message: '同步组已创建，请设置本机监听地址。' })
        break
      case 'listen':
        if (!isPrivateSyncAddress(action.address)) throw new Error('sync-invalid-address')
        update({ address: action.address })
        if (data.value.groupId) await call('listen', { address: action.address })
        else update({ message: '地址已准备。可以创建同步组，或使用另一台设备的邀请加入。' })
        break
      case 'join': {
        if (!isPrivateSyncAddress(data.value.address)) throw new Error('sync-address-required')
        let invitation: unknown
        try {
          invitation = JSON.parse(action.invite)
        } catch {
          throw new Error('sync-invalid-invitation')
        }
        if (!invitation || typeof invitation !== 'object' || Array.isArray(invitation))
          throw new Error('sync-invalid-invitation')
        await call('prepareJoin', { invitation })
        await call('listen', { address: data.value.address })
        update({ message: '加入申请已发送，请在另一台设备上批准。' })
        await call('join', { invitation })
        update({ message: '设备已配对。现在可以交换更新。' })
        break
      }
      case 'invite':
        update({ invite: JSON.stringify(await call('invite')) })
        break
      case 'leave':
        await call('leave')
        clearPreview()
        update({
          invite: null,
          groupId: null,
          peers: [],
          requests: [],
          pending: 0,
          message: '已退出同步组，学习内容和插件数据保留。',
        })
        break
      case 'approve':
      case 'reject':
      case 'revoke':
        await call(action.type, { id: action.id })
        break
      case 'pause':
      case 'resume':
        await call(action.type)
        break
      case 'exchange':
        await exchange(call)
        break
      case 'preview':
        await buildPreview(call)
        break
      case 'resolve': {
        const conflict = preview?.plan.conflicts.find(
          (entry) => entry.id === action.id && !entry.supersededBy,
        )
        if (!conflict || !preview) throw new Error('sync-preview-stale')
        if (!conflict.resolvable) throw new Error('sync-structure-conflict')
        choices[action.id] = action.choice
        const result = planWithChoices({
          snapshot: preview.source,
          events: preview.events,
          appliedClock: preview.clock,
          groupId: data.value.groupId ?? undefined,
        })
        preview.plan = result.plan
        showPlan(preview.plan, result.changedChoices)
        break
      }
      case 'apply':
        await apply(call, generation)
        break
      case 'diagnostics': {
        const report = z
          .object({
            protocol: count,
            enabled: z.boolean(),
            paused: z.boolean(),
            peerCount: count,
            pendingCount: count,
            errors: z.array(z.string()).max(100),
          })
          .parse(await call('diagnostics'))
        update({
          message: JSON.stringify(
            {
              protocol: report.protocol,
              enabled: report.enabled,
              paused: report.paused,
              pairedDevices: report.peerCount,
              joinRequests: report.pendingCount,
              issues: report.errors.map(syncErrorMessage),
            },
            null,
            2,
          ),
        })
        break
      }
      case 'cancel':
        return
    }
    await status(call)
  }
  async function run(action: SyncAction) {
    if (!alive || !options.current()) return
    if (action.type === 'cancel') {
      if (committing) {
        update({ message: '正在提交合入，已提交的学习内容会保留。' })
        return
      }
      const generation = ++epoch
      active = true
      clearPreview()
      update({ phase: 'busy', error: null, message: syncErrorMessage('sync-cancelled') })
      await options.request('cancel', {}).catch(() => {})
      if (alive && generation === epoch && options.current()) {
        active = false
        update({ phase: 'idle' })
      }
      return
    }
    if (active) return
    active = true
    const generation = ++epoch
    update({ phase: 'busy', error: null, ...(action.type === 'refresh' ? {} : { message: null }) })
    try {
      await execute(action, request(generation), generation)
    } catch (issue) {
      if (alive && generation === epoch && options.current())
        update({ phase: 'error', error: syncErrorMessage(issue) })
    } finally {
      if (alive && generation === epoch) {
        active = false
        if (data.value.phase === 'busy') update({ phase: 'idle' })
      }
    }
  }
  return {
    state,
    run,
    async refresh() {
      if (!alive || active || refreshing || !options.current()) return
      const generation = epoch
      refreshing = true
      try {
        await status(request(generation))
      } catch (issue) {
        if (alive && generation === epoch && options.current())
          update({ error: syncErrorMessage(issue) })
      } finally {
        refreshing = false
      }
    },
    dispose() {
      if (closing) return closing
      alive = false
      epoch++
      active = false
      preview = undefined
      choices = Object.create(null)
      data.value = emptySyncUiState()
      closing = options
        .request('cancel', {})
        .catch(() => {})
        .then(() => options.request('deactivate', {}).catch(() => {}))
        .then(() => {})
      return closing
    },
  }
}
