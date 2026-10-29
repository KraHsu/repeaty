import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { z } from 'zod'
import { workspaceLibrarySchema, type Library } from '../core/model'
import { recordStores } from '../core/storage'
import { readWorkspaceMarkdown, MAX_WORKSPACE_TEXT_BYTES } from '../workspace/markdown'
import {
  attemptSchema,
  sameAttemptSummary,
  type Attempt,
  type AttemptRecord,
} from '../core/practice-data'
import { WorkspaceReadError } from './errors'
import {
  collectWorkspaceFiles,
  MAX_DATABASE_BYTES,
  type WorkspaceSelection,
  type WorkspaceFiles,
} from './workspace-files'

const markerSchema = z.object({
  format: z.literal('repeaty-workspace'),
  version: z.literal(3),
  id: z.uuid(),
})
const limits = {
  decks: 1000,
  notes: 100_000,
  cards: 200_000,
  reviews: 500_000,
  media: 100_000,
  savedSearches: 100,
  practices: 100_000,
  attempts: 500_000,
  sources: 10_000,
  materialReceipts: 100_000,
}
const assetSchema = z.object({
  id: z.string(),
  mime: z.string(),
  path: z.string().regex(/^[a-f0-9]{64}\.[a-z0-9]+$/),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
})
export interface BrowserWorkspaceSnapshot {
  id: string
  name: string
  revision: number
  library: Library
}

/** SQLite is an immutable in-memory copy. No native open, lock, migration or checkpoint. */
export class BrowserWorkspaceReader {
  private attemptIndex: Map<string, AttemptRecord>
  private constructor(
    private db: Database,
    private files: WorkspaceFiles,
    readonly snapshot: BrowserWorkspaceSnapshot,
    private assets: Map<string, z.infer<typeof assetSchema>>,
  ) {
    this.attemptIndex = new Map(snapshot.library.attempts.map((record) => [record.id, record]))
  }
  static async open(
    SQL: SqlJsStatic,
    selection: WorkspaceSelection,
    progress: (percent: number) => void = () => {},
  ) {
    const files = await collectWorkspaceFiles(selection)
    progress(15)
    let marker: z.infer<typeof markerSchema>
    try {
      marker = markerSchema.parse(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            await files.read('workspace.json', 4096),
          ),
        ),
      )
    } catch (error) {
      if (error instanceof WorkspaceReadError) throw error
      throw new WorkspaceReadError('incompatible')
    }
    const bytes = await files.read('.repeaty/state.sqlite3', MAX_DATABASE_BYTES)
    let db: Database | undefined
    try {
      db = new SQL.Database(bytes)
      db.run('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;')
      if (
        scalar(db, 'PRAGMA application_id') !== 0x52505459 ||
        ![10, 11].includes(scalar(db, 'PRAGMA user_version') as number) ||
        scalar(db, 'SELECT id FROM workspace_identity') !== marker.id
      )
        throw new WorkspaceReadError('incompatible')
      const tables = new Set(
        rows(db, "SELECT name FROM sqlite_schema WHERE type='table'").map((row) => row.name),
      )
      const materialReceiptsRequired = scalar(db, 'PRAGMA user_version') === 11
      if (
        [
          ...recordStores.filter(
            (store) => store !== 'materialReceipts' || materialReceiptsRequired,
          ),
          'workspace',
          'workspace_identity',
          'documents',
          'publications',
          'assets',
        ].some((name) => !tables.has(name)) ||
        scalar(db, 'PRAGMA quick_check(1)') !== 'ok'
      )
        throw new WorkspaceReadError('invalid')
      if (
        scalar(
          db,
          "SELECT COUNT(*) FROM publications WHERE status NOT IN ('done','superseded')",
        ) !== 0
      )
        throw new WorkspaceReadError('incomplete')
      const revision = z
        .number()
        .int()
        .nonnegative()
        .safe()
        .parse(scalar(db, 'SELECT revision FROM workspace WHERE id=1'))
      progress(30)
      const content: Record<string, unknown> = { version: 14 }
      for (const [index, store] of recordStores.entries()) {
        if (store === 'materialReceipts' && !tables.has(store) && !materialReceiptsRequired) {
          content[store] = []
          continue
        }
        const count = scalar(db, `SELECT COUNT(*) FROM ${store}`)
        if (typeof count !== 'number' || count > limits[store])
          throw new WorkspaceReadError('limit')
        const statement = db.prepare(
          `SELECT id,position,${store === 'attempts' ? "json_remove(data,'$.code','$.result.detail')" : 'data'} AS data FROM ${store} ORDER BY position`,
        )
        const values = []
        try {
          while (statement.step()) {
            const row = statement.getAsObject()
            if (row.position !== values.length || typeof row.data !== 'string')
              throw new WorkspaceReadError('invalid')
            const value = JSON.parse(row.data)
            if (value?.id !== row.id) throw new WorkspaceReadError('invalid')
            values.push(value)
          }
        } finally {
          statement.free()
        }
        content[store] = values
        progress(30 + Math.round(((index + 1) / recordStores.length) * 40))
      }
      const library = workspaceLibrarySchema.parse(content)
      // Use accepted SQLite records, never pending edits in notes/ or sources/.
      const documents = rows(db, 'SELECT kind,id,path,hash FROM documents')
      const identities = new Set<string>()
      const notes = new Map(library.notes.map((note) => [note.id, note]))
      let documentBytes = 0
      for (const row of documents) {
        if (
          !['note', 'source'].includes(String(row.kind)) ||
          typeof row.id !== 'string' ||
          typeof row.path !== 'string' ||
          !row.path.startsWith(row.kind === 'note' ? 'notes/' : 'sources/') ||
          row.path
            .split('/')
            .some((part) => !part || part === '.' || part === '..' || part.includes('\\')) ||
          typeof row.hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row.hash) ||
          !files.has('.repeaty/objects/' + row.hash)
        )
          throw new WorkspaceReadError('invalid')
        const bytes = await files.read(
          '.repeaty/objects/' + row.hash,
          MAX_WORKSPACE_TEXT_BYTES,
          row.hash,
        )
        documentBytes += bytes.length
        if (documentBytes > 32 * 1024 * 1024) throw new WorkspaceReadError('limit')
        const parsed = readWorkspaceMarkdown(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        )
        if (
          parsed.status !== 'managed' ||
          parsed.document.identity.id !== row.id ||
          parsed.document.identity.kind !== row.kind
        )
          throw new WorkspaceReadError('invalid')
        const note = notes.get(row.id)
        if (
          row.kind === 'note' &&
          (!note ||
            parsed.document.content.kind !== 'note' ||
            parsed.document.content.front !== note.front ||
            parsed.document.content.back !== note.back ||
            parsed.document.header.type !== note.type ||
            parsed.document.header.format !== note.format ||
            parsed.document.header.deckId !== note.deckId)
        )
          throw new WorkspaceReadError('invalid')
        identities.add(`${row.kind}:${row.id}`)
      }
      if (
        documents.length !== library.notes.length + library.sources.length ||
        library.notes.some((note) => !identities.has('note:' + note.id)) ||
        library.sources.some((source) => !identities.has('source:' + source.id))
      )
        throw new WorkspaceReadError('invalid')
      const assets = new Map<string, z.infer<typeof assetSchema>>()
      for (const row of rows(
        db,
        'SELECT a.id,a.mime,a.path,a.size FROM assets a JOIN media m ON m.id=a.id',
      )) {
        const asset = assetSchema.parse(row)
        assets.set(asset.id, asset)
      }
      for (const media of library.media) {
        const asset = assets.get(media.id)
        if (
          !asset ||
          asset.mime !== media.type ||
          asset.size !== media.size ||
          files.size('.repeaty/media/' + asset.path) !== asset.size
        )
          throw new WorkspaceReadError('invalid')
      }
      progress(85)
      await files.verify()
      progress(100)
      return new BrowserWorkspaceReader(
        db,
        files,
        { id: marker.id, name: files.name, revision, library },
        assets,
      )
    } catch (error) {
      db?.close()
      throw error
    }
  }
  async media(id: string): Promise<Blob | undefined> {
    const asset = this.assets.get(id)
    if (!asset) return undefined
    const bytes = await this.files.read(
      '.repeaty/media/' + asset.path,
      10 * 1024 * 1024,
      asset.path.slice(0, 64),
    )
    return new Blob([Uint8Array.from(bytes).buffer], { type: asset.mime })
  }
  attempts(ids: string[]): Attempt[] {
    if (ids.length > 128) throw new WorkspaceReadError('limit')
    const statement = this.db.prepare('SELECT data FROM attempts WHERE id=?1')
    try {
      return ids.map((id) => {
        statement.bind([id])
        if (!statement.step()) throw new WorkspaceReadError('invalid')
        const value = attemptSchema.parse(JSON.parse(String(statement.get()[0])))
        const summary = this.attemptIndex.get(id)
        if (!summary || !sameAttemptSummary(summary, value)) throw new WorkspaceReadError('invalid')
        statement.reset()
        return value
      })
    } finally {
      statement.free()
    }
  }
  close() {
    this.db.close()
    this.assets.clear()
    this.attemptIndex.clear()
  }
}
function scalar(db: Database, sql: string): SqlValue | undefined {
  return db.exec(sql)[0]?.values[0]?.[0]
}
function rows(db: Database, sql: string) {
  const statement = db.prepare(sql)
  try {
    const result = []
    while (statement.step()) result.push(statement.getAsObject())
    return result
  } finally {
    statement.free()
  }
}
