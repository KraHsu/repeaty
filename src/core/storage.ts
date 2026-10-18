import { openDB, type DBSchema, type IDBPTransaction } from 'idb'
import {
  emptyLibrary,
  librarySchema,
  migrateLibrary,
  type Library,
  type MediaUpload,
} from './model'

export interface Snapshot {
  revision: number
  library: Library
}
export interface AutoBackup {
  id: string
  createdAt: string
  revision: number
  reason: string
  library: Library
}
export type BackupSummary = Omit<AutoBackup, 'library'> & { cards: number; notes: number }
interface RepeatyDB extends DBSchema {
  workspace: { key: string; value: { revision: number; library: unknown } }
  assets: { key: string; value: Blob }
  backups: { key: string; value: AutoBackup }
}
const stores = ['workspace', 'assets', 'backups'] as const
const BACKUP_INTERVAL = 30 * 60_000
export const MAX_AUTO_BACKUPS = 10
export function createRepository(name = 'repeaty', onBlocked?: () => void) {
  const database = openDB<RepeatyDB>(name, 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('workspace')) db.createObjectStore('workspace')
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets')
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups')
    },
    blocking() {
      void database.then((db) => db.close())
    },
    blocked() {
      onBlocked?.()
    },
  })
  type Transaction = IDBPTransaction<RepeatyDB, typeof stores, 'readwrite'>
  async function checkpoint(
    tx: Transaction,
    snapshot: Snapshot,
    reason: string,
    now: Date,
    force: boolean,
  ) {
    if (!snapshot.library.notes.length && !force) return
    const backups = await tx.objectStore('backups').getAll()
    const latest = backups.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision,
    )[0]
    if (
      latest?.revision === snapshot.revision ||
      (!force && latest && now.getTime() - new Date(latest.createdAt).getTime() < BACKUP_INTERVAL)
    )
      return
    const entry: AutoBackup = {
      ...snapshot,
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      reason,
    }
    await tx.objectStore('backups').put(entry, entry.id)
    const ordered = [...backups, entry].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision,
    )
    for (const expired of ordered.slice(MAX_AUTO_BACKUPS))
      await tx.objectStore('backups').delete(expired.id)
  }
  async function collectUnusedAssets(tx: Transaction, library: Library) {
    const snapshots = await tx.objectStore('backups').getAll()
    const used = new Set(
      [...library.media, ...snapshots.flatMap((backup) => backup.library.media)].map(
        (item) => item.id,
      ),
    )
    for (const id of await tx.objectStore('assets').getAllKeys())
      if (!used.has(id)) await tx.objectStore('assets').delete(id)
  }
  async function abort(tx: Transaction) {
    try {
      tx.abort()
    } catch {
      /* Already completed/aborted. */
    }
    await tx.done.catch(() => {})
  }
  return {
    async load(): Promise<Snapshot> {
      const db = await database
      const tx = db.transaction(stores, 'readwrite')
      try {
        const saved = await tx.objectStore('workspace').get('main')
        if (!saved) {
          await tx.done
          return { revision: 0, library: emptyLibrary() }
        }
        const library = migrateLibrary(saved.library)
        const migrated = (saved.library as { version: number }).version !== 3
        const snapshot = { revision: saved.revision, library }
        await checkpoint(tx, snapshot, migrated ? '升级前快照' : '自动备份', new Date(), migrated)
        if (migrated) {
          snapshot.revision++
          await tx.objectStore('workspace').put(snapshot, 'main')
        }
        await tx.done
        return snapshot
      } catch (error) {
        await abort(tx)
        throw error
      }
    },
    async save(
      library: Library,
      expectedRevision: number,
      options: { assets?: MediaUpload[]; reason?: string; now?: Date } = {},
    ): Promise<Snapshot> {
      const validated = librarySchema.parse(library)
      const db = await database
      const tx = db.transaction(stores, 'readwrite')
      try {
        const current = await tx.objectStore('workspace').get('main')
        if ((current?.revision ?? 0) !== expectedRevision)
          throw new Error('数据已在另一个标签页更新，请刷新页面后重试。')
        if (current)
          await checkpoint(
            tx,
            { revision: current.revision, library: migrateLibrary(current.library) },
            options.reason ?? '自动备份',
            options.now ?? new Date(),
            Boolean(options.reason),
          )
        for (const asset of options.assets ?? []) {
          const meta = validated.media.find((item) => item.id === asset.meta.id)
          if (!meta) continue
          if (meta.type !== asset.blob.type || meta.size !== asset.blob.size)
            throw new Error('媒体内容与文件信息不一致。')
          if (await tx.objectStore('assets').getKey(meta.id))
            throw new Error('媒体 ID 冲突，未覆盖已有文件。')
          await tx.objectStore('assets').put(asset.blob, meta.id)
        }
        for (const meta of validated.media)
          if (!(await tx.objectStore('assets').getKey(meta.id)))
            throw new Error(`媒体「${meta.name}」缺失，未保存修改。`)
        const next = { revision: expectedRevision + 1, library: validated }
        await tx.objectStore('workspace').put(next, 'main')
        await collectUnusedAssets(tx, validated)
        await tx.done
        return next
      } catch (error) {
        await abort(tx)
        throw error
      }
    },
    async backupNow(force = false, now = new Date()): Promise<void> {
      const db = await database
      const tx = db.transaction(stores, 'readwrite')
      try {
        const saved = await tx.objectStore('workspace').get('main')
        if (saved) {
          const library = migrateLibrary(saved.library)
          await checkpoint(
            tx,
            { revision: saved.revision, library },
            force ? '手动快照' : '自动备份',
            now,
            force,
          )
          await collectUnusedAssets(tx, library)
        }
        await tx.done
      } catch (error) {
        await abort(tx)
        throw error
      }
    },
    async listBackups(): Promise<BackupSummary[]> {
      return (await (await database).getAll('backups'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision)
        .map(({ library, ...entry }) => ({
          ...entry,
          notes: library.notes.length,
          cards: library.cards.length,
        }))
    },
    async getBackup(id: string): Promise<Library> {
      const backup = await (await database).get('backups', id)
      if (!backup) throw new Error('该快照已被清理，请重新打开备份列表。')
      return migrateLibrary(backup.library)
    },
    async getMedia(id: string) {
      return (await database).get('assets', id)
    },
    async close() {
      ;(await database).close()
    },
  }
}
