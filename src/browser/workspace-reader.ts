import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { z } from 'zod'
import {
  MAX_DOCUMENT_BYTES,
  MAX_MEDIA_BYTES,
  workspaceLibrarySchema,
  type Library,
} from '../core/model'
import { retiredNoteSchema, type RetiredNote } from '../desktop/retirement'
import { parseOperationHistory, type OperationHistory } from '../core/operation-history'
import { recordStores } from '../core/storage'
import { sourceDraftSchema, type SourceDraft } from '../core/source-workbench'
import {
  readWorkspaceMarkdown,
  workspaceSourceProperties,
  MAX_WORKSPACE_TEXT_BYTES,
} from '../workspace/markdown'
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
  automationReceipts: 100_000,
  materialFolders: 10_000,
  sourceConnections: 100,
  sourceCandidates: 10_000,
  studySettings: 1,
  studyEvents: 500_000,
  studyActivity: 500_000,
  fsrsModels: 200,
}
const assetSchema = z
  .object({
    id: z.string(),
    mime: z.string(),
    path: z.string().regex(/^[a-f0-9]{64}\.[a-z0-9]+$/),
    size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  })
  .refine(
    (value) =>
      value.size <= MAX_MEDIA_BYTES ||
      ['application/pdf', 'application/epub+zip', 'text/html', 'application/octet-stream'].includes(
        value.mime,
      ),
  )
export interface BrowserWorkspaceSnapshot {
  id: string
  name: string
  revision: number
  library: Library
  operationHistory?: OperationHistory
  sourceDrafts?: SourceDraft[]
  sourceProperties?: Record<string, string>
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
        ![10, 11, 12, 13, 14, 15, 16, 17].includes(scalar(db, 'PRAGMA user_version') as number) ||
        scalar(db, 'SELECT id FROM workspace_identity') !== marker.id
      )
        throw new WorkspaceReadError('incompatible')
      const tables = new Set(
        rows(db, "SELECT name FROM sqlite_schema WHERE type='table'").map((row) => row.name),
      )
      const databaseVersion = scalar(db, 'PRAGMA user_version') as number
      const materialReceiptsRequired = databaseVersion >= 11
      if (
        [
          ...recordStores.filter(
            (store) =>
              (store !== 'materialReceipts' || materialReceiptsRequired) &&
              (store !== 'automationReceipts' || databaseVersion >= 17) &&
              (store !== 'materialFolders' || databaseVersion >= 13) &&
              (!['sourceConnections', 'sourceCandidates'].includes(store) ||
                databaseVersion >= 15) &&
              (!['studySettings', 'studyEvents', 'studyActivity', 'fsrsModels'].includes(store) ||
                databaseVersion >= 16),
          ),
          'workspace',
          'workspace_identity',
          'documents',
          'publications',
          'assets',
          ...(databaseVersion >= 12 ? ['operation_history'] : []),
          ...(databaseVersion >= 13 ? ['source_drafts'] : []),
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
      const content: Record<string, unknown> = { version: 19 }
      for (const [index, store] of recordStores.entries()) {
        if (
          !tables.has(store) &&
          ((store === 'materialReceipts' && !materialReceiptsRequired) ||
            (store === 'automationReceipts' && databaseVersion < 17) ||
            (store === 'materialFolders' && databaseVersion < 13) ||
            (['sourceConnections', 'sourceCandidates'].includes(store) && databaseVersion < 15) ||
            (['studySettings', 'studyEvents', 'studyActivity', 'fsrsModels'].includes(store) &&
              databaseVersion < 16))
        ) {
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
      const sourceDrafts: SourceDraft[] = []
      if (tables.has('source_drafts')) {
        const count = scalar(db, 'SELECT COUNT(*) FROM source_drafts')
        if (typeof count !== 'number' || count > 50) throw new WorkspaceReadError('limit')
        for (const row of rows(db, 'SELECT id,data FROM source_drafts')) {
          if (typeof row.data !== 'string' || row.data.length > 2 * 1024 * 1024)
            throw new WorkspaceReadError('limit')
          const draft = sourceDraftSchema.parse(JSON.parse(row.data))
          if (draft.sourceId !== row.id) throw new WorkspaceReadError('invalid')
          // A deleted source can still be restored through the operation journal.
          // The draft remains inert until its original source/version is present.
          sourceDrafts.push(draft)
        }
      }
      // Use accepted SQLite records, never pending edits in notes/ or sources/.
      const documents = rows(db, 'SELECT kind,id,path,hash FROM documents')
      const sourceProperties: Record<string, string> = Object.create(null)
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
        if (row.kind === 'source')
          sourceProperties[row.id] = workspaceSourceProperties(parsed.document)
        identities.add(`${row.kind}:${row.id}`)
      }
      if (
        documents.length !== library.notes.length + library.sources.length ||
        library.notes.some((note) => !identities.has('note:' + note.id)) ||
        library.sources.some((source) => !identities.has('source:' + source.id))
      )
        throw new WorkspaceReadError('invalid')
      const assets = new Map<string, z.infer<typeof assetSchema>>()
      const rawHistory = tables.has('operation_history')
        ? scalar(db, 'SELECT data FROM operation_history WHERE id=1')
        : undefined
      const operationHistory =
        typeof rawHistory === 'string' ? parseOperationHistory(JSON.parse(rawHistory)) : undefined
      const retainedIds = new Set([
        ...library.media.map((media) => media.id),
        ...(operationHistory?.mediaIds ?? []),
        ...sourceDrafts.map((draft) => draft.mediaId),
      ])
      for (const row of rows(db, 'SELECT id,mime,path,size FROM assets')) {
        if (!retainedIds.has(row.id as string)) continue
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
        {
          id: marker.id,
          name: files.name,
          revision,
          library,
          operationHistory,
          sourceDrafts,
          sourceProperties,
        },
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
      MAX_DOCUMENT_BYTES,
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
  /** Explicit edits/export request full retired records; opening and grading never call this. */
  async retiredNotes(ids?: string[]): Promise<RetiredNote[]> {
    if (ids && (ids.length > 128 || ids.some((id) => !id || id.length > 100)))
      throw new WorkspaceReadError('limit')
    const tables = new Set(
      rows(this.db, "SELECT name FROM sqlite_schema WHERE type='table'").map((row) => row.name),
    )
    if (!tables.has('retired_cards') && !tables.has('retired_notes')) return []
    if (
      [
        'retired_cards',
        'retired_notes',
        'retired_records',
        'retired_media',
        'retired_documents',
      ].some((table) => !tables.has(table))
    )
      throw new WorkspaceReadError('invalid')
    const all =
      ids ??
      rows(
        this.db,
        'SELECT id FROM retired_notes UNION SELECT note_id AS id FROM retired_cards',
      ).map((row) => String(row.id))
    if (all.length > 100_000) throw new WorkspaceReadError('limit')
    let bytes = 0
    const decode = (value: unknown) => {
      if (typeof value !== 'string') throw new WorkspaceReadError('invalid')
      bytes += value.length * 2
      if (bytes > MAX_DATABASE_BYTES) throw new WorkspaceReadError('limit')
      return JSON.parse(value)
    }
    const read = (sql: string, id: string) =>
      boundRows(this.db, sql, [id]).map((row) => decode(row.data))
    const result: RetiredNote[] = []
    for (const id of all) {
      const note = read('SELECT data FROM retired_notes WHERE id=?', id)[0] ?? null
      const cards = read(
        'SELECT data FROM retired_cards WHERE note_id=? ORDER BY retired_at DESC,id',
        id,
      )
      if (!note && !cards.length) continue
      const raw: Record<string, unknown> = {
        note,
        cards,
        revision: this.snapshot.revision,
        document: null,
        media: [],
      }
      for (const store of ['reviews', 'practices', 'attempts'])
        raw[store] = read(
          `SELECT r.data FROM retired_records r JOIN retired_cards c ON c.id=r.card_id WHERE c.note_id=? AND r.store='${store}' ORDER BY r.position,r.id`,
          id,
        )
      const doc = boundRows(this.db, 'SELECT path,hash FROM retired_documents WHERE id=?', [id])[0]
      if (doc) {
        if (
          typeof doc.hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(doc.hash) ||
          typeof doc.path !== 'string'
        )
          throw new WorkspaceReadError('invalid')
        const data = await this.files.read(
          '.repeaty/objects/' + doc.hash,
          MAX_WORKSPACE_TEXT_BYTES,
          doc.hash,
        )
        const rawText = new TextDecoder('utf-8', { fatal: true }).decode(data)
        const parsed = readWorkspaceMarkdown(rawText)
        if (
          parsed.status !== 'managed' ||
          parsed.document.identity.kind !== 'note' ||
          parsed.document.identity.id !== id
        )
          throw new WorkspaceReadError('invalid')
        raw.document = { id, kind: 'note', path: doc.path, hash: doc.hash, raw: rawText }
      }
      raw.media = read(
        "SELECT m.data FROM retired_media m WHERE m.id IN (SELECT value FROM retired_notes n,json_each(json_extract(n.data,'$.frontMedia')) WHERE n.id=?1 UNION SELECT value FROM retired_notes n,json_each(json_extract(n.data,'$.backMedia')) WHERE n.id=?1 UNION SELECT json_extract(value,'$.mediaId') FROM retired_notes n,json_each(json_extract(n.data,'$.inlineMedia')) WHERE n.id=?1)",
        id,
      )
      const value = retiredNoteSchema.parse(raw)
      if (
        (value.note && value.note.id !== id) ||
        value.cards.some((card) => card.noteId !== id) ||
        value.attempts.some((attempt) => !('code' in attempt) || typeof attempt.code !== 'string')
      )
        throw new WorkspaceReadError('invalid')
      for (const meta of value.media) {
        const row = boundRows(this.db, 'SELECT id,mime,path,size FROM assets WHERE id=?', [
          meta.id,
        ])[0]
        const asset = assetSchema.parse(row)
        if (
          asset.mime !== meta.type ||
          asset.size !== meta.size ||
          this.files.size('.repeaty/media/' + asset.path) !== asset.size
        )
          throw new WorkspaceReadError('invalid')
        this.assets.set(asset.id, asset)
      }
      result.push(value)
    }
    return result
  }
  close() {
    this.db.close()
    this.assets.clear()
    this.attemptIndex.clear()
  }
}
function boundRows(db: Database, sql: string, parameters: string[]) {
  const statement = db.prepare(sql)
  try {
    statement.bind(parameters)
    const result = []
    while (statement.step()) result.push(statement.getAsObject())
    return result
  } finally {
    statement.free()
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
