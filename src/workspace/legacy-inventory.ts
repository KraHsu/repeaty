import { sha256 } from './source-revisions'
import { workspaceBytes } from './markdown'
import { MAX_MEDIA_BYTES } from '../core/model'

// Kept independent of createRepository(): opening that repository upgrades and writes checkpoints.
const entityStores = [
  'decks',
  'notes',
  'cards',
  'reviews',
  'media',
  'savedSearches',
  'practices',
  'attempts',
  'sources',
] as const
const mainStores = [
  ...entityStores,
  'workspace',
  'assets',
  'backups',
  'meta',
  'checkpoints',
  'history',
  'cardDrafts',
  'attemptSummaries',
] as const
const preferenceKeys = [
  'repeaty.locale',
  'repeaty.preferences.v1',
  'repeaty.plugins.v1',
  'repeaty.leetcode.site',
] as const
const auxiliaryName = 'repeaty-leetcode-drafts'

export interface LegacyEntry {
  key: IDBValidKey
  value: unknown
}
export interface LegacyDatabaseSnapshot {
  name: string
  version: number
  availableStores: string[]
  stores: Record<string, LegacyEntry[]>
}
export interface LegacySnapshot {
  scope: string
  main: LegacyDatabaseSnapshot
  leetcode?: LegacyDatabaseSnapshot
  // Only recognized portable preference fields; never server tokens, endpoints, or sharing grants.
  preferences: Record<string, unknown>
  fingerprint: string
}
export interface LegacyInventoryReport {
  layout: 'entity-stores' | 'monolithic' | 'unknown'
  databaseVersion: number
  counts: Record<string, number>
  assetBytes: number
  fingerprint: string
  issues: string[]
}
export interface LegacyInventoryResult {
  status: 'ready' | 'incomplete' | 'source-changed' | 'missing'
  report?: LegacyInventoryReport
  snapshot?: LegacySnapshot
}
export interface LegacyInventoryInput {
  // No defaults: this prototype never discovers or opens the user's active database on its own.
  indexedDB: IDBFactory
  databaseName: string
  preferences: Pick<Storage, 'getItem'>
  // Cross-database/localStorage atomicity cannot be manufactured by readonly IDB transactions.
  writersPaused: boolean
  afterFirstRead?: () => Promise<void> // Fixture-only fault injection.
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Blob)
  )
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error ?? new Error('legacy-read-failed'))
  })
}

async function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | undefined> {
  if (!(await factory.databases()).some((database) => database.name === name)) return undefined
  return new Promise((resolve, reject) => {
    const opening = factory.open(name) // Deliberately no version argument.
    let settled = false
    const timer = setTimeout(() => finish(new Error('legacy-open-timeout')), 5000)
    function finish(error?: Error, database?: IDBDatabase) {
      if (settled) {
        database?.close()
        return
      }
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(database)
    }
    // Deletion between databases() and open() would create a DB. Abort that transaction entirely.
    opening.onupgradeneeded = () => opening.transaction?.abort()
    opening.onerror = () => finish(opening.error ?? new Error('legacy-open-failed'))
    opening.onblocked = () => finish(new Error('legacy-database-blocked'))
    opening.onsuccess = () => {
      opening.result.onversionchange = () => opening.result.close()
      finish(undefined, opening.result)
    }
  })
}

async function readDatabase(
  factory: IDBFactory,
  name: string,
  whitelist: readonly string[],
): Promise<LegacyDatabaseSnapshot | undefined> {
  const database = await openExisting(factory, name)
  if (!database) return undefined
  try {
    const availableStores = Array.from(database.objectStoreNames)
    const names = whitelist.filter((store) => database.objectStoreNames.contains(store))
    const stores: Record<string, LegacyEntry[]> = Object.create(null)
    if (names.length) {
      const tx = database.transaction(names, 'readonly')
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new Error('legacy-read-aborted'))
        tx.onerror = () => reject(tx.error ?? new Error('legacy-read-failed'))
      })
      // Queue all requests before yielding, so the single readonly transaction cannot auto-close.
      const reads = names.map((name) => {
        const store = tx.objectStore(name)
        return Promise.all([request(store.getAllKeys()), request(store.getAll())]).then(
          ([keys, values]) => {
            stores[name] = keys.map((key, index) => ({ key, value: values[index] }))
          },
        )
      })
      await Promise.all([...reads, done])
    }
    return { name, version: database.version, availableStores, stores }
  } finally {
    database.close()
  }
}

function scopedDrafts(database: LegacyDatabaseSnapshot | undefined, scope: string) {
  if (!database) return undefined
  return {
    ...database,
    stores: {
      drafts: (database.stores.drafts ?? []).filter(({ key }) => {
        if (typeof key !== 'string') return false
        try {
          const parsed: unknown = JSON.parse(key)
          if (Array.isArray(parsed))
            return parsed.length === 2 && parsed[0] === scope && typeof parsed[1] === 'string'
        } catch {
          /* Old bare IDs belong only to local:repeaty. */
        }
        return scope === 'local:repeaty'
      }),
    },
  }
}

function readPreferences(storage: Pick<Storage, 'getItem'>) {
  const observed: Record<string, string | null> = Object.create(null)
  const portable: Record<string, unknown> = Object.create(null)
  const issues: string[] = []
  for (const key of preferenceKeys) {
    const raw = storage.getItem(key)
    observed[key] = raw
    if (raw === null) continue
    if (key === 'repeaty.locale' || key === 'repeaty.leetcode.site') {
      const values = key === 'repeaty.locale' ? ['en', 'zh-CN'] : ['leetcode.cn', 'leetcode.com']
      if (values.includes(raw)) portable[key] = raw
      else issues.push(`invalid-preference:${key}`)
      continue
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!record(parsed)) throw new Error('invalid-preference')
      const selected: Record<string, unknown> = Object.create(null)
      for (const [field, value] of Object.entries(parsed)) {
        const valid =
          key === 'repeaty.plugins.v1'
            ? /^[a-z][a-z0-9-]{0,63}$/.test(field) && typeof value === 'boolean'
            : field === 'historyLength'
              ? Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 50
              : ['historyAfterReveal', 'popupInfo', 'popupWarning', 'popupError'].includes(field) &&
                typeof value === 'boolean'
        if (valid) selected[field] = value
        else issues.push(`unsupported-preference-field:${key}:${field}`)
      }
      portable[key] = selected
    } catch {
      issues.push(`invalid-preference:${key}`)
    }
  }
  return { observed, portable, issues }
}

/** Deterministic typed fingerprint. Blobs are hashed one at a time, not JSON-serialized or base64 copied. */
export async function legacyFingerprint(input: unknown): Promise<string> {
  const active = new Set<object>()
  async function value(raw: unknown, depth: number): Promise<unknown> {
    if (depth > 256) throw new Error('legacy-value-too-deep')
    if (raw === null) return ['null']
    if (raw === undefined) return ['undefined']
    if (typeof raw === 'string' || typeof raw === 'boolean') return [typeof raw, raw]
    if (typeof raw === 'number' && Number.isFinite(raw))
      return ['number', Object.is(raw, -0) ? '-0' : String(raw)]
    if (raw instanceof Blob) {
      if (raw.size > MAX_MEDIA_BYTES) throw new Error('legacy-blob-too-large')
      return ['blob', raw.type, raw.size, await sha256(new Uint8Array(await raw.arrayBuffer()))]
    }
    if (raw instanceof Date) return ['date', raw.toISOString()]
    if (raw instanceof ArrayBuffer) return ['binary', await sha256(new Uint8Array(raw))]
    if (ArrayBuffer.isView(raw))
      return [
        'binary-view',
        raw.constructor.name,
        await sha256(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)),
      ]
    if (typeof raw !== 'object' || !raw) throw new Error('unsupported-legacy-value')
    if (active.has(raw)) throw new Error('cyclic-legacy-value')
    active.add(raw)
    let result: unknown
    if (Array.isArray(raw)) {
      const items: unknown[] = []
      for (const item of raw) items.push(await value(item, depth + 1))
      result = ['array', items]
    } else {
      const pairs: unknown[] = []
      if (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)
        throw new Error('unsupported-legacy-object')
      for (const key of Object.keys(raw).sort())
        pairs.push([key, await value((raw as Record<string, unknown>)[key], depth + 1)])
      result = ['object', pairs]
    }
    active.delete(raw)
    return result
  }
  return sha256(workspaceBytes(JSON.stringify(await value(input, 0))))
}

function inventory(snapshot: LegacySnapshot, preferenceIssues: string[]): LegacyInventoryReport {
  const { main, leetcode } = snapshot
  const issues = [...preferenceIssues]
  const meta = main.stores.meta?.find(({ key }) => key === 'main')?.value
  const old = main.stores.workspace?.find(({ key }) => key === 'main')?.value
  const counts: Record<string, number> = Object.create(null)
  let layout: LegacyInventoryReport['layout'] = 'unknown'
  let entities: Record<string, unknown[]> = Object.create(null)
  if (record(meta) && Number.isSafeInteger(meta.revision)) {
    layout = 'entity-stores'
    if (!record(meta.counts) || Number(meta.revision) < 0) issues.push('invalid-library-metadata')
    for (const name of entityStores) {
      if (!main.stores[name]) issues.push(`missing-store:${name}`)
      const rows = main.stores[name] ?? []
      entities[name] = rows.map(({ key, value }) => {
        if (
          !record(value) ||
          value.id !== key ||
          !record(value.value) ||
          value.value.id !== key ||
          !Number.isSafeInteger(value.position)
        )
          issues.push(`invalid-entity-row:${name}`)
        return record(value) ? value.value : undefined
      })
      if (record(meta.counts) && meta.counts[name] !== rows.length)
        issues.push(`count-mismatch:${name}`)
    }
  } else if (record(old) && record(old.library)) {
    layout = 'monolithic'
    const library = old.library
    entities = Object.fromEntries(
      entityStores.map((name) => [name, Array.isArray(library[name]) ? library[name] : []]),
    )
    issues.push('legacy-normalization-required')
  } else issues.push('unknown-library-layout')
  if (main.version > 16) issues.push('unsupported-database-version')
  for (const name of entityStores) counts[name] = entities[name]?.length ?? 0
  for (const attempt of entities.attempts ?? []) {
    if (
      !record(attempt) ||
      typeof attempt.code !== 'string' ||
      (attempt.result !== undefined &&
        (!record(attempt.result) || typeof attempt.result.detail !== 'string'))
    )
      issues.push('missing-full-attempt-body')
  }
  const attemptIds = new Set((entities.attempts ?? []).filter(record).map((attempt) => attempt.id))
  if ((main.stores.attemptSummaries ?? []).some(({ key }) => !attemptIds.has(key)))
    issues.push('orphan-attempt-summary')
  for (const name of ['assets', 'backups', 'checkpoints', 'history', 'attemptSummaries'])
    counts[name] = main.stores[name]?.length ?? 0
  const assets = new Map((main.stores.assets ?? []).map(({ key, value }) => [key, value]))
  let assetBytes = 0
  for (const blob of assets.values()) {
    if (blob instanceof Blob) assetBytes += blob.size
    else issues.push('invalid-asset-blob')
  }
  for (const media of entities.media ?? []) {
    if (!record(media)) {
      issues.push('invalid-media-row')
      continue
    }
    const blob = assets.get(String(media.id))
    if (!(blob instanceof Blob) || blob.size !== media.size || blob.type !== media.type)
      issues.push('missing-or-corrupt-media')
  }
  const drafts = main.stores.cardDrafts ?? []
  counts.cardDrafts = drafts.length
  counts.leetcodeDrafts = leetcode?.stores.drafts?.length ?? 0
  for (const { value } of drafts) {
    if (!record(value) || value.scope !== snapshot.scope) issues.push('draft-scope-mismatch')
    if (!record(value) || !Array.isArray(value.uploads)) {
      issues.push('invalid-card-draft')
      continue
    }
    if (
      !record(value.input) ||
      typeof value.input.front !== 'string' ||
      typeof value.input.back !== 'string'
    )
      issues.push('missing-draft-content')
    for (const upload of value.uploads) {
      if (
        !record(upload) ||
        !record(upload.meta) ||
        !(upload.blob instanceof Blob) ||
        upload.blob.size !== upload.meta.size ||
        upload.blob.type !== upload.meta.type
      )
        issues.push('missing-or-corrupt-draft-asset')
    }
  }
  for (const { value } of leetcode?.stores.drafts ?? []) {
    if (
      !record(value) ||
      !record(value.code) ||
      Object.values(value.code).some((code) => typeof code !== 'string') ||
      (value.result !== undefined &&
        (!record(value.result) || typeof value.result.detail !== 'string'))
    )
      issues.push('missing-leetcode-draft-body')
  }
  if (leetcode && (!leetcode.availableStores.includes('drafts') || leetcode.version > 1))
    issues.push('unsupported-leetcode-draft-layout')
  return {
    layout,
    databaseVersion: main.version,
    counts,
    assetBytes,
    fingerprint: snapshot.fingerprint,
    issues: [...new Set(issues)],
  }
}

/** Read-only M0 capture of an explicitly supplied, quiescent source. Does not normalize or migrate it. */
export async function captureLegacyInventory(
  input: LegacyInventoryInput,
): Promise<LegacyInventoryResult> {
  if (!input.writersPaused) throw new Error('legacy-writers-must-be-paused')
  if (!input.databaseName || input.databaseName === auxiliaryName)
    throw new Error('invalid-legacy-database-name')
  async function take() {
    const main = await readDatabase(input.indexedDB, input.databaseName, mainStores)
    if (!main) return undefined
    const scope = `local:${input.databaseName}`
    const leetcode = scopedDrafts(
      await readDatabase(input.indexedDB, auxiliaryName, ['drafts']),
      scope,
    )
    const preferences = readPreferences(input.preferences)
    const fingerprint = await legacyFingerprint({
      main,
      leetcode,
      preferences: preferences.observed,
    })
    return {
      snapshot: { scope, main, leetcode, preferences: preferences.portable, fingerprint },
      preferenceIssues: preferences.issues,
    }
  }
  const first = await take()
  if (!first) return { status: 'missing' }
  await input.afterFirstRead?.()
  const second = await take()
  const report = inventory(first.snapshot, first.preferenceIssues)
  if (!second || second.snapshot.fingerprint !== first.snapshot.fingerprint) {
    return {
      status: 'source-changed',
      report: { ...report, issues: [...report.issues, 'source-changed-during-capture'] },
    }
  }
  return { status: report.issues.length ? 'incomplete' : 'ready', report, snapshot: first.snapshot }
}
