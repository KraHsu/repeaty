import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { createNativeRepository, type AcceptedDocument } from '../../src/desktop/repository'
import { statusSchema, type NativeApi } from '../../src/desktop/workspaces'
import { fixture, now } from '../../src/core/test-fixtures'
import { reviewCard, undoReview } from '../../src/core/scheduler'
import { removeNotes, saveNote, type Library } from '../../src/core/model'
import { addSource, prepareSource } from '../../src/core/sources'
import { noteLifecycle } from '../../src/desktop/retirement'
import { planSync, type SyncChoice, type SyncPlan } from '../../src/sync/merge'
import { libraryFromSnapshot, snapshotToRetired } from '../../src/sync/projection'
import {
  sameSyncValue,
  type SyncClock,
  type SyncEvent,
  type SyncSnapshot,
} from '../../src/sync/protocol'
import type { SyncCommit } from '../../src/sync/commit'

let binary: string
const roots: string[] = [],
  processes: ChildProcessWithoutNullStreams[] = []
beforeAll(() => {
  execFileSync(
    'cargo',
    [
      'build',
      '--locked',
      '--manifest-path',
      'crates/workspace-store/Cargo.toml',
      '--example',
      'workspace-runtime',
    ],
    { stdio: 'pipe' },
  )
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      [
        'metadata',
        '--no-deps',
        '--format-version',
        '1',
        '--manifest-path',
        'crates/workspace-store/Cargo.toml',
      ],
      { encoding: 'utf8' },
    ),
  )
  binary = join(
    metadata.target_directory,
    'debug/examples/workspace-runtime' + (process.platform === 'win32' ? '.exe' : ''),
  )
})
afterEach(async () => {
  for (const child of processes.splice(0))
    if (child.exitCode === null) {
      child.stdin.end()
      await once(child, 'exit')
    }
  const parent = resolve(tmpdir()) + sep
  for (const root of roots.splice(0)) {
    const target = resolve(root)
    if (
      !target.startsWith(parent) ||
      !target.slice(parent.length).startsWith('repeaty-sync-native-')
    )
      throw new Error('unsafe-test-cleanup')
    await rm(target, { recursive: true, force: true })
  }
})
function host(device: string) {
  const child = spawn(binary, [device], { stdio: 'pipe' })
  processes.push(child)
  let id = 0,
    errors = ''
  child.stderr.on('data', (part) => {
    errors += part
  })
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (issue: Error) => void }
  >()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const response = JSON.parse(line),
      waiter = pending.get(response.id)
    if (!waiter) return
    pending.delete(response.id)
    if (response.error) waiter.reject(new Error(response.error))
    else waiter.resolve(response.value)
  })
  child.on('exit', () => {
    for (const waiter of pending.values())
      waiter.reject(new Error('Native sync fixture exited: ' + errors))
    pending.clear()
  })
  const api: NativeApi = <T>(command: string, args: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const requestId = ++id
      pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject })
      child.stdin.write(JSON.stringify({ id: requestId, command, args }) + '\n')
    })
  return {
    api,
    async stop() {
      if (child.exitCode === null) {
        child.stdin.end()
        await once(child, 'exit')
      }
    },
  }
}
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'repeaty-sync-native-'))
  roots.push(root)
  const path = join(root, '真实学习库🙂'),
    device = join(root, 'device')
  await mkdir(path)
  const runtime = host(device),
    status = statusSchema.parse(await runtime.api('workspace_status'))
  const selected = statusSchema.parse(
    await runtime.api('workspace_choose', { epoch: status.epoch, mode: 'create', path }),
  )
  const active = selected.active!,
    repo = createNativeRepository(active, runtime.api)
  await repo.load()
  return { root, path, device, runtime, active, repo }
}
type Environment = Awaited<ReturnType<typeof workspace>>
interface NativeState {
  snapshot: SyncSnapshot
  revision: number
  status: { groupId: string; clock: SyncClock; pending: number }
}
interface SyncObject {
  kind: 'media' | 'document'
  id: string
  mime: string
  hash: string
  size: number
}
const sync = <T>(env: Environment, method: string, payload: unknown = {}) =>
  env.runtime.api<T>('workspace_sync', { token: env.active.token, method, payload })
async function restart(env: Environment) {
  await env.runtime.stop()
  env.runtime = host(env.device)
  const status = statusSchema.parse(await env.runtime.api('workspace_status'))
  env.active = status.active!
  env.repo = createNativeRepository(env.active, env.runtime.api)
  return env.repo.load()
}
async function objects(from: Environment, to: Environment) {
  const inventory = await sync<{ objects: SyncObject[]; chunkSize: number }>(from, 'objects/info')
  for (const object of inventory.objects) {
    const progress = await sync<{ complete: boolean; received: number[] }>(to, 'objects/info', {
      object,
    })
    if (!progress.complete)
      for (let offset = 0; offset < object.size; offset += inventory.chunkSize) {
        if (progress.received.includes(offset / inventory.chunkSize)) continue
        const chunk = await sync<{ offset: number; data: string; chunkHash: string }>(
          from,
          'objects/read',
          { object, offset },
        )
        await sync(to, 'objects/write', { object, ...chunk })
      }
    await sync(to, 'objects/finish', { object })
  }
}
async function transfer(from: Environment, to: Environment) {
  const status = await sync<{ receivedClock: SyncClock }>(to, 'journal/status')
  const events = await sync<SyncEvent[]>(from, 'journal/list', {
    clock: status.receivedClock,
    limit: 256,
  })
  if (events.length)
    await sync(to, 'journal/receive', { events: [...events].reverse().concat(events.slice(0, 1)) })
  await objects(from, to)
  return events
}
async function preview(env: Environment) {
  const base = await sync<NativeState>(env, 'snapshot')
  const events = await sync<SyncEvent[]>(env, 'journal/list', {
    clock: base.status.clock,
    limit: 256,
  })
  return {
    base,
    events,
    plan: planSync({
      snapshot: base.snapshot,
      events,
      appliedClock: base.status.clock,
      groupId: base.status.groupId,
    }),
  }
}
async function documentBodies(env: Environment, snapshot: SyncSnapshot) {
  const required = new Set(
    Object.values(snapshot.retired.documents ?? {}).map(
      (row) => (row.value as { hash: string }).hash,
    ),
  )
  const bodies: Record<string, string> = Object.create(null)
  if (!required.size) return bodies
  const inventory = await sync<{ objects: SyncObject[]; chunkSize: number }>(env, 'objects/info')
  for (const hash of required) {
    const object = inventory.objects.find(
      (entry) => entry.kind === 'document' && entry.hash === hash,
    )!
    expect(object).toBeDefined()
    const parts: Buffer[] = []
    for (let offset = 0; offset < object.size; offset += inventory.chunkSize) {
      const chunk = await sync<{ data: string }>(env, 'objects/read', { object, offset })
      parts.push(Buffer.from(chunk.data, 'base64'))
    }
    const content = Buffer.concat(parts)
    expect(createHash('sha256').update(content).digest('hex')).toBe(hash)
    bodies[hash] = content.toString('utf8')
  }
  return bodies
}
function values(before: SyncSnapshot, after: SyncSnapshot): SyncCommit['values'] {
  const result: SyncCommit['values'] = Object.create(null)
  for (const namespace of new Set([...Object.keys(before.values), ...Object.keys(after.values)])) {
    const left = before.values[namespace] ?? {},
      right = after.values[namespace] ?? {}
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const prior = Object.hasOwn(left, id) ? left[id]!.value : null,
        next = Object.hasOwn(right, id) ? right[id]!.value : null
      if (!sameSyncValue(prior, next)) (result[namespace] ??= Object.create(null))[id] = next
    }
  }
  return result
}
async function persist(env: Environment, base: NativeState, plan: SyncPlan) {
  expect(plan.blocked).toBe(false)
  const loaded = await env.repo.load()
  expect(loaded.revision).toBe(base.revision)
  return env.repo.save(libraryFromSnapshot(plan.snapshot), base.revision, {
    retired: snapshotToRetired(plan.snapshot, await documentBodies(env, plan.snapshot)),
    sync: {
      expectedClock: base.status.clock,
      clock: plan.clock,
      appliedIds: plan.appliedIds,
      values: values(base.snapshot, plan.snapshot),
      resolutions: plan.resolutionChanges,
      retiredMedia: Object.fromEntries(
        Object.entries(plan.snapshot.retired.media ?? {}).map(([id, row]) => [id, row.value]),
      ),
    },
  })
}
async function apply(env: Environment, choice?: SyncChoice) {
  const prepared = await preview(env)
  let plan = prepared.plan
  if (choice)
    plan = planSync(
      {
        snapshot: prepared.base.snapshot,
        events: prepared.events,
        appliedClock: prepared.base.status.clock,
        groupId: prepared.base.status.groupId,
      },
      Object.fromEntries(
        plan.conflicts.filter((entry) => entry.resolvable).map((entry) => [entry.id, choice]),
      ),
    )
  expect(plan.pending).toEqual([])
  if (plan.appliedIds.length || plan.blocked) await persist(env, prepared.base, plan)
  return plan
}
async function pair(library: Library, assets: Parameters<Environment['repo']['save']>[2] = {}) {
  const a = await workspace(),
    b = await workspace(),
    groupId = crypto.randomUUID()
  await a.repo.save(library, 0, assets)
  await sync(a, 'start', { groupId })
  await sync(b, 'start', { groupId })
  await transfer(a, b)
  await apply(b)
  return { a, b, groupId }
}
async function edit(env: Environment, patch: Partial<Library['notes'][number]>) {
  const state = await env.repo.load(),
    note = state.library.notes[0]!
  return env.repo.save(
    saveNote(state.library, { ...note, ...patch }, note.id, false, now),
    state.revision,
  )
}

describe('real native storage and TypeScript domain sync', () => {
  it('round-trips baseline objects, disjoint offline edits, concurrent real FSRS schedules and causal choices across two native workspaces', async () => {
    const source = prepareSource({
      title: '同步材料',
      format: 'markdown',
      url: '',
      content: '保留材料原文🙂\n正文',
    })
    const original = addSource(fixture(), source.source, source.asset)
    const { a, b } = await pair(original, { assets: [source.asset] })
    expect((await b.repo.load()).library).toEqual((await a.repo.load()).library)
    expect(await (await b.repo.getMedia(source.asset.meta.id))!.text()).toBe(
      await source.asset.blob.text(),
    )
    await edit(a, { front: '设备 A 改题面' })
    await edit(b, { back: '设备 B 改答案' })
    await transfer(b, a)
    await apply(a)
    await transfer(a, b)
    await apply(b)
    expect((await b.repo.load()).library.notes[0]).toMatchObject({
      front: '设备 A 改题面',
      back: '设备 B 改答案',
    })
    expect((await b.repo.load()).library).toEqual((await a.repo.load()).library)
    const left = await a.repo.load(),
      right = await b.repo.load(),
      cardId = left.library.cards[0]!.id
    const leftScore = reviewCard(left.library, cardId, 1, now),
      rightScore = reviewCard(right.library, cardId, 4, now)
    await a.repo.save(leftScore, left.revision)
    await b.repo.save(rightScore, right.revision)
    await transfer(b, a)
    const conflicting = await preview(a)
    expect(conflicting.plan.blocked).toBe(true)
    expect(conflicting.plan.conflicts.some((entry) => entry.kind === 'schedule')).toBe(true)
    expect((await a.repo.load()).library.reviews).toHaveLength(1)
    await apply(a, 'remote')
    await transfer(a, b)
    await apply(b)
    const merged = (await a.repo.load()).library
    expect(merged.reviews.map((review) => review.id).sort()).toEqual(
      [leftScore.reviews[0]!.id, rightScore.reviews[0]!.id].sort(),
    )
    expect(merged.cards[0]!.schedule).toEqual(rightScore.cards[0]!.schedule)
    expect((await b.repo.load()).library).toEqual(merged)
    expect((await restart(a)).library).toEqual(merged)
    expect((await restart(b)).library).toEqual(merged)
    expect((await sync<{ pending: number }>(b, 'journal/status')).pending).toBe(0)
  })

  it('retains missing predecessors, applies duplicated unordered score and undo events exactly once, and rejects cross-batch equivocation', async () => {
    const { a, b } = await pair(fixture())
    const base = await a.repo.load(),
      scored = reviewCard(base.library, base.library.cards[0]!.id, 3, now)
    const saved = await a.repo.save(scored, base.revision)
    await a.repo.save(undoReview(saved.library), saved.revision)
    const status = await sync<{ receivedClock: SyncClock }>(b, 'journal/status')
    const events = await sync<SyncEvent[]>(a, 'journal/list', {
      clock: status.receivedClock,
      limit: 256,
    })
    expect(events).toHaveLength(2)
    await sync(b, 'journal/receive', { events: [events[1]] })
    const waiting = await preview(b)
    expect(waiting.plan.pending).toHaveLength(1)
    expect(waiting.plan.appliedIds).toEqual([])
    expect((await b.repo.load()).library.reviews).toHaveLength(0)
    await sync(b, 'journal/receive', { events: [events[1], events[0], events[0]] })
    await apply(b)
    expect((await b.repo.load()).library.reviews).toHaveLength(0)
    expect((await b.repo.load()).library.cards[0]!.schedule).toEqual(
      base.library.cards[0]!.schedule,
    )
    await sync(b, 'journal/receive', { events })
    expect((await preview(b)).plan.appliedIds).toEqual([])
    await expect(
      sync(b, 'journal/receive', { events: [{ ...events[0], changes: [] }] }),
    ).rejects.toThrow('sync-event-identity-conflict')
    expect(
      (await sync<SyncEvent[]>(b, 'journal/list', { clock: {}, limit: 256 })).filter((entry) =>
        events.some((event) => event.id === entry.id),
      ),
    ).toHaveLength(2)
    await restart(b)
    expect((await b.repo.load()).library.reviews).toHaveLength(0)
  })

  it('keeps complete code, remote ratings and portable plugin settings through delete/edit conflict, retirement, restoration and restart', async () => {
    const plugin = { id: 'sample', version: 1, data: { prompt: '保留插件数据' } }
    const original = fixture({ type: 'plugin', plugin }),
      cardId = original.cards[0]!.id,
      noteId = original.notes[0]!.id
    original.practices = [
      {
        id: 'practice',
        cardId,
        contentRevision: 'v1',
        question: { front: 'Q', back: 'A', format: 'plain', plugin },
        startedAt: now.toISOString(),
      },
    ]
    original.attempts = [
      {
        id: 'attempt',
        practiceId: 'practice',
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        language: 'python3',
        code: 'print("完整历史代码🙂")',
        elapsedMs: 1000,
        status: 'failed',
      },
    ]
    const { a, b } = await pair(original)
    await a.runtime.api('workspace_write', {
      token: a.active.token,
      request: {
        type: 'value',
        namespace: 'plugin:sample',
        id: 'data',
        value: { retained: 'private plugin state' },
      },
    })
    await a.runtime.api('workspace_write', {
      token: a.active.token,
      request: {
        type: 'value',
        namespace: 'settings',
        id: 'plugin:sample:configuration',
        value: '{"mode":"retain"}',
      },
    })
    await a.runtime.api('workspace_write', {
      token: a.active.token,
      request: {
        type: 'value',
        namespace: 'settings',
        id: 'device-only',
        value: 'never synchronized',
      },
    })
    const before = await a.repo.load()
    await a.repo.save(removeNotes(before.library, new Set([noteId])), before.revision)
    const edited = await edit(b, { front: '并发编辑仍在事件日志里' })
    const scored = reviewCard(edited.library, cardId, 3, now)
    await b.repo.save(scored, edited.revision)
    await transfer(b, a)
    expect((await preview(a)).plan.conflicts.some((entry) => entry.kind === 'delete-edit')).toBe(
      true,
    )
    await apply(a, 'local')
    await transfer(a, b)
    await apply(b)
    expect((await b.repo.load()).library.notes).toHaveLength(0)
    const archived = await b.repo.retiredNotes()
    expect(archived[0]!.cards[0]!.id).toBe(cardId)
    expect(archived[0]!.reviews.map((review) => review.id)).toContain(scored.reviews[0]!.id)
    expect(archived[0]!.attempts[0]).toMatchObject({ code: 'print("完整历史代码🙂")' })
    const readValue = (namespace: string, id: string) =>
      b.runtime.api('workspace_read', {
        token: b.active.token,
        request: { type: 'value', namespace, id },
      })
    expect(await readValue('plugin:sample', 'data')).toEqual({ retained: 'private plugin state' })
    expect(await readValue('settings', 'plugin:sample:configuration')).toBe('{"mode":"retain"}')
    expect(await readValue('settings', 'device-only')).toBeNull()
    const current = await a.repo.load(),
      retained = await a.repo.retiredNote(noteId)
    const restored = noteLifecycle(current.library, retained.note!, noteId, retained, true, now)
    await a.repo.save(restored.library, current.revision)
    await transfer(a, b)
    await apply(b)
    expect((await b.repo.load()).library.cards[0]!.id).toBe(cardId)
    expect(await b.repo.getAttempt('attempt')).toMatchObject({ code: 'print("完整历史代码🙂")' })
    await restart(a)
    await restart(b)
    expect((await b.repo.load()).library).toEqual((await a.repo.load()).library)
    expect(await readValue('plugin:sample', 'data')).toEqual({ retained: 'private plugin state' })
  })

  it('does not acknowledge or partially apply an incoming event when the guarded Markdown write fails', async () => {
    const { a, b } = await pair(fixture())
    await edit(a, { front: '远端新正文' })
    await transfer(a, b)
    const prepared = await preview(b)
    expect(prepared.plan.blocked).toBe(false)
    const documents = await b.runtime.api<AcceptedDocument[]>('workspace_read', {
      token: b.active.token,
      request: { type: 'documents' },
    })
    const document = documents[0]!
    await writeFile(
      join(b.path, ...document.path.split('/')),
      document.raw + '\n外部尚未接受的修改',
      'utf8',
    )
    await expect(persist(b, prepared.base, prepared.plan)).rejects.toThrow()
    const after = await sync<NativeState>(b, 'snapshot')
    expect(after.status.clock).toEqual(prepared.base.status.clock)
    expect(after.revision).toBe(prepared.base.revision)
    expect(after.snapshot).toEqual(prepared.base.snapshot)
    expect(after.status.pending).toBeGreaterThan(0)
  })
})
