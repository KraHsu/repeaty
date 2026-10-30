import { z } from 'zod'
import { recordSchemas } from '../core/model'

export type SyncClock = Record<string, number>
export interface SyncChange {
  store: string
  id: string
  before: unknown | null
  after: unknown | null
  position?: number
}
export interface SyncEvent {
  protocol: 1
  groupId: string
  id: string
  deviceId: string
  sequence: number
  /** The applied frontier immediately before this transaction; never a received frontier. */
  clock: SyncClock
  changes: SyncChange[]
}
export interface SyncRow {
  value: unknown
  position: number
}
export type SyncRows = Record<string, Record<string, SyncRow>>
export interface SyncSnapshot {
  records: SyncRows
  values: SyncRows
  retired: SyncRows
}
export const SYNC_LIMITS = Object.freeze({
  events: 2048,
  devices: 128,
  changes: 100_000,
  bytes: 64 * 1024 * 1024,
  depth: 64,
})
export class SyncProtocolError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'SyncProtocolError'
  }
}
export const syncFailure = (code: string): never => {
  throw new SyncProtocolError(code)
}
const device = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/)
  .refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value))
const identifier = z.string().min(1).max(512)
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const changeSchema = z.strictObject({
  store: z.string().min(1).max(150),
  id: identifier,
  before: z.unknown(),
  after: z.unknown(),
  position: z.number().int().min(0).max(1_600_000).optional(),
})
const eventSchema = z.strictObject({
  protocol: z.literal(1),
  groupId: identifier,
  id: identifier,
  deviceId: device,
  sequence: counter.min(1),
  clock: z.record(device, counter),
  changes: z.array(changeSchema).max(SYNC_LIMITS.changes),
})
export const retiredStores = new Set([
  'notes',
  'cards',
  'reviews',
  'practices',
  'attempts',
  'media',
  'documents',
])

export function syncStore(store: string): { section: keyof SyncSnapshot; store: string } {
  if (Object.hasOwn(recordSchemas, store)) return { section: 'records', store }
  if (store.startsWith('values:')) {
    const namespace = store.slice(7)
    // Device credentials and legacy authentication namespaces are never portable.
    if (namespace === 'settings' || /^plugin:[a-z][a-z0-9-]{0,63}$/.test(namespace))
      return { section: 'values', store: namespace }
  }
  if (store.startsWith('retired:') && retiredStores.has(store.slice(8)))
    return { section: 'retired', store: store.slice(8) }
  return syncFailure('sync-unknown-store')
}

/** JSON-only canonical form; identities do not depend on property insertion order or locale. */
export function canonicalSyncValue(value: unknown): string {
  const ancestors = new Set<object>()
  function encode(item: unknown, depth: number): string {
    if (depth > SYNC_LIMITS.depth) return syncFailure('sync-depth-limit')
    if (item === null) return 'null'
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (typeof item !== 'object') return syncFailure('sync-invalid-json')
    if (ancestors.has(item)) return syncFailure('sync-invalid-json')
    ancestors.add(item)
    let result: string
    if (Array.isArray(item))
      result = '[' + item.map((entry) => encode(entry, depth + 1)).join(',') + ']'
    else {
      const prototype = Object.getPrototypeOf(item)
      if (prototype !== Object.prototype && prototype !== null)
        return syncFailure('sync-invalid-json')
      const record = item as Record<string, unknown>
      result =
        '{' +
        Object.keys(record)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encode(record[key], depth + 1))
          .join(',') +
        '}'
    }
    ancestors.delete(item)
    return result
  }
  return encode(value, 0)
}
export const sameSyncValue = (left: unknown, right: unknown) =>
  canonicalSyncValue(left) === canonicalSyncValue(right)

export function parseSyncClock(input: unknown): SyncClock {
  const result = z.record(device, counter).safeParse(input)
  if (!result.success || Object.keys(result.data).length > SYNC_LIMITS.devices)
    return syncFailure('sync-invalid-clock')
  return result.data
}

export function parseSyncEvents(input: unknown, groupId?: string): SyncEvent[] {
  if (!Array.isArray(input) || input.length > SYNC_LIMITS.events)
    return syncFailure('sync-batch-limit')
  const events = new Map<string, { event: SyncEvent; content: string }>()
  let bytes = 0,
    changes = 0,
    group = groupId
  for (const raw of input) {
    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success) return syncFailure('sync-invalid-event')
    const event = parsed.data as SyncEvent
    const clock = parseSyncClock(event.clock)
    if (
      event.id !== `${event.deviceId}:${event.sequence}` ||
      !Object.hasOwn(clock, event.deviceId) ||
      (clock[event.deviceId] ?? 0) !== event.sequence - 1
    )
      return syncFailure('sync-invalid-event-clock')
    if (group === undefined) group = event.groupId
    if (event.groupId !== group) return syncFailure('sync-wrong-group')
    const keys = new Set<string>()
    for (const change of event.changes) {
      syncStore(change.store)
      if (change.store === 'values:settings' && !change.id.startsWith('plugin:'))
        return syncFailure('sync-nonportable-value')
      if (
        !Object.hasOwn(change, 'before') ||
        !Object.hasOwn(change, 'after') ||
        change.before === undefined ||
        change.after === undefined ||
        (change.before === null && change.after === null)
      )
        return syncFailure('sync-invalid-change')
      if (change.after === null && change.position !== undefined)
        return syncFailure('sync-invalid-change')
      const key = JSON.stringify([change.store, change.id])
      if (keys.has(key)) return syncFailure('sync-duplicate-change')
      keys.add(key)
    }
    const content = canonicalSyncValue(event)
    bytes += new TextEncoder().encode(content).byteLength
    changes += event.changes.length
    if (bytes > SYNC_LIMITS.bytes || changes > SYNC_LIMITS.changes)
      return syncFailure('sync-batch-limit')
    const prior = events.get(event.id)
    if (prior && prior.content !== content) return syncFailure('sync-event-identity-conflict')
    events.set(event.id, { event: JSON.parse(content) as SyncEvent, content })
  }
  return [...events.values()].map(({ event }) => event)
}

/** SHA-256 is used only for stable conflict identities, never as transport authentication. */
export function syncFingerprint(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalSyncValue(value))
  const length = Math.ceil((bytes.length + 9) / 64) * 64
  const data = new Uint8Array(length)
  data.set(bytes)
  data[bytes.length] = 128
  const view = new DataView(data.buffer)
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(length - 4, bytes.length * 8)
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits))
  for (let offset = 0; offset < length; offset += 64) {
    const words = new Uint32Array(64)
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index++) {
      const x = words[index - 15]!,
        y = words[index - 2]!
      words[index] =
        words[index - 16]! +
        (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
        words[index - 7]! +
        (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))
    }
    let [a, b, c, d, e, f, g, h] = state as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    for (let index = 0; index < 64; index++) {
      const t1 =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          constants[index]! +
          words[index]!) |
        0
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries())
      state[index] = (state[index]! + value) >>> 0
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('')
}
