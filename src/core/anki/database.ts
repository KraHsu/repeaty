import type { Database, SqlValue } from 'sql.js'
import { z } from 'zod'
import { protobuf, protoNumber, protoText } from './protobuf'
import { MAX_ANKI_NOTES } from './types'

export interface AnkiModel {
  name: string
  kind: number
  fields: string[]
  templates: { question: string; answer: string }[]
}
export interface AnkiSourceNote {
  id: string
  guid: string
  modelId: string
  fields: string[]
  tags: string[]
  ords: number[]
}
export interface AnkiDatabase {
  models: Map<string, AnkiModel>
  notes: AnkiSourceNote[]
  reviewCount: number
}

function rows(db: Database, sql: string, limit: number): Record<string, SqlValue>[] {
  const statement = db.prepare(sql),
    result: Record<string, SqlValue>[] = []
  try {
    while (statement.step()) {
      if (result.length >= limit) throw new Error('Anki table exceeds import limits')
      result.push(statement.getAsObject())
    }
  } finally {
    statement.free()
  }
  return result
}
const string = (value: SqlValue | undefined): string => {
  if (typeof value !== 'string') throw new Error('Invalid Anki text')
  return value
}
const bytes = (value: SqlValue | undefined): Uint8Array => {
  if (!(value instanceof Uint8Array)) throw new Error('Invalid Anki configuration')
  return value
}
const legacyModelSchema = z.object({
  name: z.string().max(1000),
  type: z.number().int(),
  flds: z
    .array(z.object({ name: z.string().max(200), ord: z.number().int().nonnegative() }))
    .max(100),
  tmpls: z
    .array(
      z.object({
        qfmt: z.string().max(100_000),
        afmt: z.string().max(100_000),
        ord: z.number().int().nonnegative(),
      }),
    )
    .max(100),
})

export function readAnkiDatabase(db: Database): AnkiDatabase {
  // sql.js does not register Anki's `unicase` collation. This database exists
  // only in the disposable import worker. Normalize schema text in that copy;
  // our queries never compare/sort names or use their collation indexes.
  db.run(
    "PRAGMA trusted_schema=OFF; PRAGMA writable_schema=ON; UPDATE sqlite_schema SET sql=replace(sql, 'COLLATE unicase', 'COLLATE BINARY') WHERE tbl_name IN ('notetypes', 'fields', 'templates') AND type IN ('table', 'index'); PRAGMA writable_schema=RESET; PRAGMA query_only=ON",
  )
  const tables = new Set(
    rows(db, "SELECT name FROM sqlite_master WHERE type='table'", 200).map((row) => row.name),
  )
  if (!['col', 'notes', 'cards'].every((table) => tables.has(table)))
    throw new Error('Missing Anki tables')
  const collection = rows(db, 'SELECT ver, models FROM col', 1)[0]
  if (
    !collection ||
    typeof collection.ver !== 'number' ||
    collection.ver < 11 ||
    collection.ver > 18
  )
    throw new Error('Unsupported Anki schema')
  const models = new Map<string, AnkiModel>()
  if (collection.ver < 15) {
    const json = string(collection.models)
    if (json.length > 4 * 1024 * 1024) throw new Error('Anki models exceed import limits')
    const parsed = z.record(z.string(), legacyModelSchema).parse(JSON.parse(json))
    if (Object.keys(parsed).length > 1000) throw new Error('Too many Anki models')
    for (const [id, model] of Object.entries(parsed)) {
      const fields = [...model.flds].sort((a, b) => a.ord - b.ord)
      const templates = [...model.tmpls].sort((a, b) => a.ord - b.ord)
      if (
        fields.some((field, i) => field.ord !== i) ||
        templates.some((template, i) => template.ord !== i)
      )
        throw new Error('Invalid Anki field order')
      models.set(id, {
        name: model.name,
        kind: model.type,
        fields: fields.map((field) => field.name),
        templates: templates.map((template) => ({
          question: template.qfmt,
          answer: template.afmt,
        })),
      })
    }
  } else {
    if (!['notetypes', 'fields', 'templates'].every((table) => tables.has(table)))
      throw new Error('Missing Anki model tables')
    for (const row of rows(db, 'SELECT CAST(id AS TEXT) AS id, name, config FROM notetypes', 1000))
      models.set(string(row.id), {
        name: string(row.name),
        kind: protoNumber(protobuf(bytes(row.config)), 1),
        fields: [],
        templates: [],
      })
    for (const row of rows(
      db,
      'SELECT CAST(ntid AS TEXT) AS ntid, ord, name FROM fields ORDER BY ntid, ord',
      100_000,
    )) {
      const model = models.get(string(row.ntid))
      // Package exports may leave fields/templates from unused note types.
      if (!model) continue
      if (row.ord !== model.fields.length || model.fields.length >= 100)
        throw new Error('Invalid Anki fields')
      model.fields.push(string(row.name))
    }
    for (const row of rows(
      db,
      'SELECT CAST(ntid AS TEXT) AS ntid, ord, config FROM templates ORDER BY ntid, ord',
      100_000,
    )) {
      const model = models.get(string(row.ntid))
      if (!model) continue
      const config = protobuf(bytes(row.config))
      if (row.ord !== model.templates.length || model.templates.length >= 100)
        throw new Error('Invalid Anki templates')
      model.templates.push({ question: protoText(config, 1), answer: protoText(config, 2) })
    }
  }
  const notes: AnkiSourceNote[] = rows(
    db,
    'SELECT CAST(id AS TEXT) AS id, guid, CAST(mid AS TEXT) AS mid, flds, tags FROM notes ORDER BY id LIMIT 5001',
    MAX_ANKI_NOTES,
  ).map((row) => ({
    id: string(row.id),
    guid: string(row.guid),
    modelId: string(row.mid),
    fields: string(row.flds).split('\x1f'),
    tags: string(row.tags).split(/\s+/).filter(Boolean),
    ords: [],
  }))
  const byId = new Map(notes.map((note) => [note.id, note]))
  for (const row of rows(
    db,
    'SELECT CAST(nid AS TEXT) AS nid, ord FROM cards ORDER BY nid, ord',
    200_000,
  )) {
    const note = byId.get(string(row.nid))
    if (
      !note ||
      typeof row.ord !== 'number' ||
      !Number.isInteger(row.ord) ||
      note.ords.includes(row.ord)
    )
      throw new Error('Invalid Anki card reference')
    note.ords.push(row.ord)
  }
  const reviewCount = tables.has('revlog')
    ? rows(db, 'SELECT COUNT(*) AS count FROM revlog', 1)[0]?.count
    : 0
  if (typeof reviewCount !== 'number' || !Number.isSafeInteger(reviewCount))
    throw new Error('Invalid Anki review count')
  return { models, notes, reviewCount }
}

/** Accept only templates whose meaning matches a native Repeaty note type. */
export function ankiNoteType(model: AnkiModel): 'basic' | 'reversed' | 'cloze' | undefined {
  if (
    model.fields.length !== 2 ||
    new Set(model.fields).size !== 2 ||
    model.fields.some((field) => !field || /[{}:]/.test(field))
  )
    return
  const first = `{{${model.fields[0]}}}`,
    second = `{{${model.fields[1]}}}`
  const normalize = (text: string) =>
    text.replace(/<\s*(?:hr|br)\b[^>]*>/gi, '').replace(/\s+/g, '')
  const [forward, reverse] = model.templates
  if (!forward) return
  const isForward =
    normalize(forward.question) === normalize(first) &&
    [second, `{{FrontSide}}${second}`].some(
      (answer) => normalize(forward.answer) === normalize(answer),
    )
  if (model.kind === 0 && isForward) {
    if (model.templates.length === 1) return 'basic'
    if (
      model.templates.length === 2 &&
      reverse &&
      normalize(reverse.question) === normalize(second) &&
      normalize(reverse.answer) === normalize(`{{FrontSide}}${first}`)
    )
      return 'reversed'
  }
  const cloze = `{{cloze:${model.fields[0]}}}`
  if (
    model.kind === 1 &&
    model.templates.length === 1 &&
    normalize(forward.question) === normalize(cloze) &&
    [cloze, `${cloze}${second}`].some((answer) => normalize(forward.answer) === normalize(answer))
  )
    return 'cloze'
}
