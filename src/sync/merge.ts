import {
  canonicalSyncValue,
  parseSyncClock,
  parseSyncEvents,
  sameSyncValue,
  syncFailure,
  syncFingerprint,
  syncStore,
  type SyncClock,
  type SyncChange,
  type SyncEvent,
  type SyncSnapshot,
} from './protocol'
import {
  cloneSyncSnapshot,
  normalizeSyncPositions,
  syncRow,
  validateSyncSnapshot,
  libraryFromSnapshot,
} from './projection'
import { validateMaterialChanges } from '../core/material-data'
import { validateAutomationReceipts } from '../core/automation-data'

export type SyncChoice = 'local' | 'remote'
export interface SyncConflict {
  id: string
  eventId: string
  store: string
  recordId: string
  path: string
  kind: 'content' | 'schedule' | 'delete-edit' | 'history' | 'structure'
  base: unknown
  local: unknown
  remote: unknown
  resolvable: boolean
  choice?: SyncChoice
  supersededBy?: string
}
export interface SyncPending {
  eventId: string
  missing: SyncClock
}
export interface SyncPlan {
  snapshot: SyncSnapshot
  /** Preview only. Never persist this while blocked is true. */
  proposedSnapshot: SyncSnapshot
  conflicts: SyncConflict[]
  clock: SyncClock
  appliedIds: string[]
  pending: SyncPending[]
  blocked: boolean
  /** Local causal resolution transaction; broadcast only after a successful apply. */
  resolutionChanges: SyncChange[]
}
export interface SyncPlanInput {
  snapshot: SyncSnapshot
  events: unknown
  appliedClock: SyncClock
  groupId?: string
}

const absent = Symbol('absent')
type Field = unknown | typeof absent
const equal = (a: Field, b: Field) => (a === absent || b === absent ? a === b : sameSyncValue(a, b))
const exposed = (value: Field) => (value === absent ? { present: false } : { present: true, value })
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const historyStores = new Set(['reviews', 'practices', 'attempts', 'studyEvents', 'studyActivity'])
const field = (record: Record<string, unknown>, key: string): Field =>
  Object.hasOwn(record, key) ? record[key] : absent
const sequenceAt = (clock: SyncClock, device: string) =>
  Object.hasOwn(clock, device) ? clock[device]! : 0

/**
 * Plans an atomic application of complete causal transactions. Receiving an event is
 * not applying it: unresolved conflicts and invalid structure leave both clock and
 * snapshot unchanged. The caller retains every envelope, including undo tombstones.
 */
export function planSync(input: SyncPlanInput, choices: Record<string, SyncChoice> = {}): SyncPlan {
  validateSyncSnapshot(input.snapshot)
  const originalClock = parseSyncClock(input.appliedClock)
  const events = parseSyncEvents(input.events, input.groupId)
  const eventById = new Map(events.map((event) => [event.id, event]))
  const clock = { ...originalClock }
  const snapshot = cloneSyncSnapshot(input.snapshot)
  const remoteProjection = cloneSyncSnapshot(input.snapshot)
  const conflicts: SyncConflict[] = [],
    appliedIds: string[] = []
  const conflictsByRecord = new Map<string, SyncConflict[]>()
  const conflictContents = new Map<string, string>()
  const waiting = new Map(
    events
      .filter((event) => event.sequence > sequenceAt(originalClock, event.deviceId))
      .map((event) => [event.id, event]),
  )
  const missing = (event: SyncEvent): SyncClock =>
    Object.fromEntries(
      Object.entries(event.clock).filter(
        ([device, sequence]) => sequenceAt(clock, device) < sequence,
      ),
    )
  const dominates = (left: SyncClock, right: SyncClock) =>
    Object.entries(right).every(([device, sequence]) => sequenceAt(left, device) >= sequence)
  const dependents = new Map<string, string[]>()
  const needed = new Map<string, number>()
  const ready: string[] = []
  const dependencyKey = (device: string, sequence: number) => JSON.stringify([device, sequence])
  function readyPush(id: string) {
    ready.push(id)
    let at = ready.length - 1
    while (at > 0) {
      const parent = (at - 1) >>> 1
      if (ready[parent]! <= ready[at]!) break
      ;[ready[parent], ready[at]] = [ready[at]!, ready[parent]!]
      at = parent
    }
  }
  function readyPop(): string {
    const first = ready[0]!,
      last = ready.pop()!
    if (ready.length) {
      ready[0] = last
      let at = 0
      while (true) {
        let child = at * 2 + 1
        if (child >= ready.length) break
        if (child + 1 < ready.length && ready[child + 1]! < ready[child]!) child++
        if (ready[at]! <= ready[child]!) break
        ;[ready[at], ready[child]] = [ready[child]!, ready[at]!]
        at = child
      }
    }
    return first
  }
  for (const event of waiting.values()) {
    const dependencies = Object.entries(missing(event))
    needed.set(event.id, dependencies.length)
    if (!dependencies.length) readyPush(event.id)
    for (const [device, sequence] of dependencies) {
      const key = dependencyKey(device, sequence)
      const ids = dependents.get(key) ?? []
      ids.push(event.id)
      dependents.set(key, ids)
    }
  }

  function conflict(
    event: SyncEvent,
    store: string,
    recordId: string,
    path: string,
    kind: SyncConflict['kind'],
    base: Field,
    local: Field,
    remote: Field,
    resolvable = true,
  ): Field {
    // Choices are directional. Reversing the same two versions must require a
    // fresh choice instead of silently selecting the opposite content.
    const identity = {
      store,
      recordId,
      path,
      kind,
      base: exposed(base),
      local: exposed(local),
      remote: exposed(remote),
    }
    const content = canonicalSyncValue(identity)
    const id = `sync-conflict:${syncFingerprint(identity)}`
    if (conflictContents.has(id) && conflictContents.get(id) !== content)
      return syncFailure('sync-conflict-identity-collision')
    conflictContents.set(id, content)
    const choice = Object.hasOwn(choices, id) ? choices[id] : undefined
    if (choice !== undefined && choice !== 'local' && choice !== 'remote')
      return syncFailure('sync-invalid-choice')
    const entry: SyncConflict = {
      id,
      eventId: event.id,
      store,
      recordId,
      path,
      kind,
      base: exposed(base),
      local: exposed(local),
      remote: exposed(remote),
      resolvable,
      ...(choice && resolvable ? { choice } : {}),
    }
    conflicts.push(entry)
    const key = JSON.stringify([store, recordId])
    const entries = conflictsByRecord.get(key) ?? []
    entries.push(entry)
    conflictsByRecord.set(key, entries)
    return choice === 'remote' && resolvable ? remote : local
  }

  function merge(
    event: SyncEvent,
    store: string,
    id: string,
    before: unknown,
    current: unknown,
    after: unknown,
  ): unknown {
    if (sameSyncValue(current, before)) return after
    if (sameSyncValue(current, after) || sameSyncValue(before, after)) return current
    if (current === null || after === null || before === null)
      return conflict(
        event,
        store,
        id,
        '',
        current === null || after === null ? 'delete-edit' : 'content',
        before,
        current,
        after,
      )
    const { section, store: actualStore } = syncStore(store)
    if (section === 'values' || !plain(before) || !plain(current) || !plain(after))
      return conflict(event, store, id, '', 'content', before, current, after)
    const result: Record<string, unknown> = Object.create(null)
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(current), ...Object.keys(after)]),
    ].sort()
    for (const key of keys) {
      const base = field(before, key),
        local = field(current, key),
        remote = field(after, key)
      let value: Field
      if (equal(local, base)) value = remote
      else if (equal(local, remote) || equal(remote, base)) value = local
      else if (
        key === 'updatedAt' &&
        actualStore === 'cards' &&
        !sameSyncValue(current.schedule, after.schedule) &&
        !sameSyncValue(before.schedule, current.schedule) &&
        !sameSyncValue(before.schedule, after.schedule)
      ) {
        // A selected real schedule keeps its original timestamp as one unit.
        value = equal(result.schedule, after.schedule) ? remote : local
      } else if (key === 'updatedAt' && typeof local === 'string' && typeof remote === 'string') {
        // This is bookkeeping only: preserve a deterministic observed timestamp,
        // never use it to select content, a schedule, or another user's changes.
        value = syncFingerprint(local) < syncFingerprint(remote) ? local : remote
      } else
        value = conflict(
          event,
          store,
          id,
          key,
          key === 'schedule' ? 'schedule' : historyStores.has(actualStore) ? 'history' : 'content',
          base,
          local,
          remote,
        )
      if (value !== absent) result[key] = value
    }
    return result
  }

  while (ready.length) {
    const event = waiting.get(readyPop())!
    for (const change of event.changes) {
      const rawTarget = syncStore(change.store)
      const rawRows = { ...(remoteProjection[rawTarget.section][rawTarget.store] ?? {}) }
      if (change.after === null) delete rawRows[change.id]
      else
        Object.defineProperty(rawRows, change.id, {
          value: {
            value: change.after,
            position:
              change.position ?? rawRows[change.id]?.position ?? Object.keys(rawRows).length,
          },
          enumerable: true,
          writable: true,
          configurable: true,
        })
      Object.defineProperty(remoteProjection[rawTarget.section], rawTarget.store, {
        value: rawRows,
        enumerable: true,
        writable: true,
        configurable: true,
      })
      let target = change.store
      // A rating on another device does not resurrect a retired card. Its exact
      // generated schedule can still be reconciled inside the retained record.
      if (
        target === 'cards' &&
        !syncRow(snapshot, target, change.id) &&
        syncRow(snapshot, 'retired:cards', change.id) &&
        plain(change.before) &&
        plain(change.after)
      ) {
        const scheduling = new Set(['schedule', 'updatedAt', 'leech', 'autoBurial'])
        const identity = (record: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(record).filter(([key]) => !scheduling.has(key)))
        if (sameSyncValue(identity(change.before), identity(change.after))) target = 'retired:cards'
      }
      const { section, store } = syncStore(target)
      const prior = syncRow(snapshot, target, change.id)
      const unresolved = (conflictsByRecord.get(JSON.stringify([target, change.id])) ?? []).filter(
        (entry) => !entry.supersededBy,
      )
      const resolves =
        unresolved.length > 0 &&
        dominates(event.clock, originalClock) &&
        unresolved.every((entry) => {
          const cause = eventById.get(entry.eventId)!
          return sequenceAt(event.clock, cause.deviceId) >= cause.sequence
        })
      if (resolves) for (const entry of unresolved) entry.supersededBy = event.id
      const value = resolves
        ? change.after
        : merge(event, target, change.id, change.before, prior?.value ?? null, change.after)
      const rows = Object.hasOwn(snapshot[section], store) ? snapshot[section][store]! : {}
      const nextRows = { ...rows }
      if (value === null) delete nextRows[change.id]
      else
        Object.defineProperty(nextRows, change.id, {
          value: {
            value,
            position: change.position ?? prior?.position ?? Object.keys(rows).length,
          },
          enumerable: true,
          writable: true,
          configurable: true,
        })
      Object.defineProperty(snapshot[section], store, {
        value: nextRows,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    clock[event.deviceId] = event.sequence
    appliedIds.push(event.id)
    waiting.delete(event.id)
    const key = dependencyKey(event.deviceId, event.sequence)
    for (const id of dependents.get(key) ?? []) {
      const count = needed.get(id)! - 1
      needed.set(id, count)
      if (count === 0) readyPush(id)
    }
    dependents.delete(key)
  }
  // New history for an already retired owner stays readable in retirement,
  // rather than violating the active projection or silently disappearing.
  for (const [store, ownerStore, key] of [
    ['reviews', 'cards', 'cardId'],
    ['practices', 'cards', 'cardId'],
    ['attempts', 'practices', 'practiceId'],
  ] as const) {
    for (const [id, row] of Object.entries(snapshot.records[store] ?? {})) {
      const owner = (row.value as Record<string, unknown>)[key]
      if (
        typeof owner !== 'string' ||
        syncRow(snapshot, ownerStore, owner) ||
        !syncRow(snapshot, `retired:${ownerStore}`, owner)
      )
        continue
      const prior = syncRow(snapshot, `retired:${store}`, id)
      if (prior && !sameSyncValue(prior.value, row.value)) continue
      snapshot.retired[store] = { ...(snapshot.retired[store] ?? {}), [id]: row }
      delete snapshot.records[store]![id]
    }
  }
  normalizeSyncPositions(snapshot)
  try {
    validateSyncSnapshot(snapshot)
    const before = libraryFromSnapshot(input.snapshot),
      next = libraryFromSnapshot(snapshot)
    validateMaterialChanges(before, next)
    validateAutomationReceipts(before.automationReceipts, next.automationReceipts, () =>
      syncFailure('sync-immutable-receipt'),
    )
  } catch {
    const event = events.find((entry) => entry.id === appliedIds.at(-1))
    if (event)
      conflict(
        event,
        'library',
        '',
        '',
        'structure',
        null,
        { eventIds: appliedIds.slice().sort(), state: syncFingerprint(input.snapshot) },
        { state: syncFingerprint(snapshot) },
        false,
      )
    else return syncFailure('sync-invalid-snapshot')
  }
  for (const id of Object.keys(choices))
    if (!conflictContents.has(id)) return syncFailure('sync-stale-choice')
  const pending = [...waiting.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((event) => ({ eventId: event.id, missing: missing(event) }))
  const activeConflicts = conflicts.filter((entry) => !entry.supersededBy)
  const blocked = activeConflicts.some((entry) => !entry.resolvable || !entry.choice)
  const resolutionChanges: SyncChange[] = []
  const selected = new Set(
    activeConflicts
      .filter((entry) => entry.choice)
      .map((entry) => JSON.stringify([entry.store, entry.recordId])),
  )
  if (!blocked)
    for (const section of ['records', 'values', 'retired'] as const) {
      for (const store of new Set([
        ...Object.keys(remoteProjection[section]),
        ...Object.keys(snapshot[section]),
      ])) {
        const encoded = section === 'records' ? store : `${section}:${store}`
        const beforeRows = remoteProjection[section][store] ?? {},
          afterRows = snapshot[section][store] ?? {}
        for (const id of new Set([...Object.keys(beforeRows), ...Object.keys(afterRows)])) {
          const before = Object.hasOwn(beforeRows, id) ? beforeRows[id] : undefined
          const after = Object.hasOwn(afterRows, id) ? afterRows[id] : undefined
          if (
            sameSyncValue(before?.value ?? null, after?.value ?? null) &&
            before?.position === after?.position &&
            !selected.has(JSON.stringify([encoded, id]))
          )
            continue
          resolutionChanges.push({
            store: encoded,
            id,
            before: before?.value ?? null,
            after: after?.value ?? null,
            ...(after ? { position: after.position } : {}),
          })
        }
      }
    }
  return {
    snapshot: blocked ? cloneSyncSnapshot(input.snapshot) : snapshot,
    proposedSnapshot: snapshot,
    conflicts: activeConflicts,
    clock: blocked ? originalClock : clock,
    appliedIds: blocked ? [] : appliedIds,
    pending,
    blocked,
    resolutionChanges,
  }
}
