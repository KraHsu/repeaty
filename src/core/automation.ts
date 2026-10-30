import { z } from 'zod'
import {
  colors,
  deckSchema,
  noteSchema,
  removeNotes,
  saveNote,
  validateLibraryReferences,
  type Library,
  type MediaUpload,
} from './model'
import { addSource, editSourceDetails, prepareSource, replaceSourceContent } from './sources'
import { sourceDetailsSchema } from './source-data'
import { arrangeSource } from './source-queue'
import {
  addMaterialFolder,
  renameMaterialFolder,
  removeMaterialFolder,
  moveMaterial,
} from './material-organization'
import { editNotes } from './batch'
import { operationFor } from './operations'
import { noteLifecycle, type RetiredNote } from '../desktop/retirement'
import { canonicalAutomationValue, type AutomationIds } from './automation-data'
import { materialCollectionSchema } from './collection-data'
export type { AutomationIds, AutomationReceipt, AutomationResult } from './automation-data'

const id = z.string().min(1).max(150)
const sourceId = z.string().min(1).max(100)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const text = z.string().max(1000)
const tags = z.array(z.string().trim().min(1).max(40)).max(20)
const page = {
  revision: revision.optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(200).default(50),
}
export const AutomationQuerySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('library'), revision: revision.optional() }),
  z.strictObject({ kind: z.literal('decks'), ...page, id: id.optional(), text: text.optional() }),
  z.strictObject({
    kind: z.literal('collections'),
    ...page,
    id: id.optional(),
    text: text.optional(),
    archived: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('folders'),
    ...page,
    id: sourceId.optional(),
    parentId: sourceId.optional(),
    text: text.optional(),
  }),
  z.strictObject({
    kind: z.literal('sources'),
    ...page,
    id: sourceId.optional(),
    folderId: sourceId.optional(),
    parentSourceId: sourceId.optional(),
    text: text.optional(),
  }),
  z.strictObject({
    kind: z.literal('notes'),
    ...page,
    id: id.optional(),
    deckId: id.optional(),
    sourceId: sourceId.optional(),
    text: text.optional(),
    tag: z.string().max(40).optional(),
  }),
  z.strictObject({
    kind: z.literal('cards'),
    ...page,
    id: id.optional(),
    noteId: id.optional(),
    deckId: id.optional(),
  }),
  z.strictObject({
    kind: z.literal('history'),
    ...page,
    cardId: id.optional(),
    historyKind: z.enum(['reviews', 'practices', 'reading']).default('reviews'),
  }),
  z.strictObject({
    kind: z.literal('source.body'),
    sourceId,
    versionId: sourceId.optional(),
    revision: revision.optional(),
  }),
  z.strictObject({ kind: z.literal('retired'), ...page }),
  z.strictObject({ kind: z.literal('checkpoints'), ...page }),
])
export type AutomationQuery = z.input<typeof AutomationQuerySchema>
export type ParsedAutomationQuery = z.infer<typeof AutomationQuerySchema>

const noteFields = {
  deckId: id,
  type: z.enum(['basic', 'reversed', 'cloze']),
  format: z.enum(['plain', 'markdown']).optional(),
  front: noteSchema.shape.front,
  back: noteSchema.shape.back,
  tags: tags.optional(),
  frontMedia: z.array(id).max(8).optional(),
  backMedia: z.array(id).max(8).optional(),
  studyPriority: z.number().int().min(0).max(9).optional(),
}
const noteInput = z.strictObject(noteFields)
const deckInput = z.strictObject({
  name: deckSchema.shape.name,
  description: z.string().max(300).optional(),
  color: z.enum(colors).optional(),
  newLimit: z.number().int().min(0).max(9999).optional(),
  reviewLimit: z.number().int().min(0).max(9999).optional(),
  burySiblings: z.boolean().optional(),
  leechThreshold: z.number().int().min(0).max(100).optional(),
  desiredRetention: z.number().min(0.7).max(0.97).optional(),
  studyPriority: z.number().int().min(0).max(9).optional(),
})
const body = z
  .string()
  .min(1)
  .max(250_000)
  .refine((value) => !!value.trim())
const destination = z
  .strictObject({ folderId: sourceId.optional(), parentSourceId: sourceId.optional() })
  .refine((value) => !(value.folderId && value.parentSourceId))
const ids = z
  .array(id)
  .min(1)
  .max(1000)
  .refine((value) => new Set(value).size === value.length)
const nonempty = (value: object) => Object.keys(value).length > 0
export const AutomationCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('collection.create'),
    name: materialCollectionSchema.shape.name,
    sourceIds: materialCollectionSchema.shape.sourceIds.optional(),
  }),
  z.strictObject({
    kind: z.literal('collection.patch'),
    collectionId: id,
    name: materialCollectionSchema.shape.name,
  }),
  z.strictObject({
    kind: z.literal('collection.members'),
    collectionId: id,
    add: materialCollectionSchema.shape.sourceIds.optional(),
    remove: materialCollectionSchema.shape.sourceIds.optional(),
  }),
  z.strictObject({
    kind: z.literal('collection.reorder'),
    collectionId: id,
    sourceIds: materialCollectionSchema.shape.sourceIds,
  }),
  z.strictObject({ kind: z.literal('collection.archive'), collectionId: id }),
  z.strictObject({ kind: z.literal('collection.restore'), collectionId: id }),
  z.strictObject({
    kind: z.literal('source.create'),
    destination: destination.optional(),
    input: z.strictObject({
      title: sourceDetailsSchema.shape.title,
      body,
      format: z.enum(['plain', 'markdown']).optional(),
      url: sourceDetailsSchema.shape.url.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('source.patch'),
    sourceId,
    versionId: sourceId,
    patch: z
      .strictObject({ title: sourceDetailsSchema.shape.title.optional(), body: body.optional() })
      .refine(nonempty),
  }),
  z.strictObject({ kind: z.literal('source.archive'), sourceId }),
  z.strictObject({ kind: z.literal('source.restore'), sourceId }),
  z.strictObject({
    kind: z.literal('source.move'),
    sourceId,
    destination,
    beforeId: sourceId.optional(),
  }),
  z.strictObject({
    kind: z.literal('folder.create'),
    name: z.string().trim().min(1).max(160),
    parentId: sourceId.optional(),
  }),
  z.strictObject({
    kind: z.literal('folder.patch'),
    folderId: sourceId,
    name: z.string().trim().min(1).max(160),
  }),
  z.strictObject({ kind: z.literal('folder.remove'), folderId: sourceId }),
  z.strictObject({
    kind: z.literal('folder.move'),
    folderId: sourceId,
    destination: z.strictObject({ folderId: sourceId.optional() }),
    beforeId: sourceId.optional(),
  }),
  z.strictObject({ kind: z.literal('note.create'), input: noteInput }),
  z.strictObject({
    kind: z.literal('note.patch'),
    noteId: id,
    patch: noteInput.partial().refine(nonempty),
    allowRemove: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('note.move'), noteIds: ids, deckId: id }),
  z.strictObject({
    kind: z.literal('note.tags'),
    noteIds: ids,
    add: tags.optional(),
    remove: tags.optional(),
  }),
  z.strictObject({ kind: z.literal('note.remove'), noteIds: ids }),
  z.strictObject({ kind: z.literal('deck.create'), input: deckInput }),
  z.strictObject({
    kind: z.literal('deck.patch'),
    deckId: id,
    patch: deckInput.partial().refine(nonempty),
  }),
  z.strictObject({ kind: z.literal('history.undo') }),
  z.strictObject({ kind: z.literal('history.redo') }),
  z.strictObject({ kind: z.literal('retired.restore'), noteId: id }),
  z.strictObject({ kind: z.literal('checkpoint.restore'), checkpointId: id }),
])
export type AutomationCommand = z.infer<typeof AutomationCommandSchema>
export const AutomationRequestSchema = z
  .strictObject({
    protocolVersion: z.literal(1),
    operationId: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
    expectedRevision: revision,
    commands: z.array(AutomationCommandSchema).min(1).max(100),
  })
  .refine((value) => value.commands.length === 1 || !value.commands.some(isAutomationHostCommand), {
    message: 'Host actions cannot be combined with other commands.',
  })
export type AutomationRequest = z.infer<typeof AutomationRequestSchema>
export const AutomationApplySchema = z.strictObject({
  request: AutomationRequestSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  planId: id.optional(),
})
export type AutomationApply = z.infer<typeof AutomationApplySchema>
export type AutomationErrorCode =
  | 'invalid-arguments'
  | 'library-changed'
  | 'not-found'
  | 'host-action-required'
  | 'request-conflict'
export class AutomationError extends Error {
  constructor(readonly code: AutomationErrorCode) {
    super(code)
  }
}
export function isAutomationHostCommand(command: AutomationCommand) {
  return (
    command.kind === 'history.undo' ||
    command.kind === 'history.redo' ||
    command.kind === 'retired.restore' ||
    command.kind === 'checkpoint.restore'
  )
}
export function parseAutomationRequest(input: unknown): AutomationRequest {
  const parsed = AutomationRequestSchema.safeParse(input)
  if (!parsed.success) throw new AutomationError('invalid-arguments')
  return parsed.data
}
export function canonicalAutomationRequest(input: unknown): string {
  return canonicalAutomationValue(parseAutomationRequest(input))
}
export async function automationFingerprint(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalAutomationRequest(input))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}
export const emptyAutomationIds = (): AutomationIds => ({
  sources: [],
  folders: [],
  collections: [],
  notes: [],
  decks: [],
  cards: [],
})
export type AutomationEntity = keyof AutomationIds
export interface AutomationChange {
  entity: AutomationEntity
  id: string
  action: 'create' | 'update' | 'remove'
  fields: string[]
}
export interface PreparedAutomation {
  library: Library
  assets: MediaUpload[]
  changes: AutomationChange[]
  touched: AutomationIds
  resultIds: AutomationIds
}

/** Prepares one immutable transaction; it neither saves nor authorizes anything.
 * Hosts must retain the prepared IDs/assets and recheck revision and every touched record on apply. */
export function prepareAutomation(
  library: Library,
  input: unknown,
  currentRevision: number,
  now = new Date(),
  retiredById: ReadonlyMap<string, RetiredNote> = new Map(),
): PreparedAutomation {
  const request = parseAutomationRequest(input)
  if (request.expectedRevision !== currentRevision) throw new AutomationError('library-changed')
  if (request.commands.some(isAutomationHostCommand))
    throw new AutomationError('host-action-required')
  let next = library
  const assets: MediaUpload[] = []
  const requireNote = (noteId: string) => {
    const note = next.notes.find((value) => value.id === noteId)
    if (!note) throw new AutomationError('not-found')
    return note
  }
  const requireDeck = (deckId: string) => {
    const deck = next.decks.find((value) => value.id === deckId)
    if (!deck) throw new AutomationError('not-found')
    return deck
  }
  for (const command of request.commands) {
    switch (command.kind) {
      case 'collection.create': {
        if (
          next.materialCollections.length >= 10_000 ||
          command.sourceIds?.some((id) => !next.sources.some((v) => v.id === id))
        )
          throw new AutomationError('invalid-arguments')
        const collection = materialCollectionSchema.parse({
          id: crypto.randomUUID(),
          name: command.name,
          sourceIds: command.sourceIds ?? [],
          archived: false,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })
        next = { ...next, materialCollections: [...next.materialCollections, collection] }
        break
      }
      case 'collection.patch':
      case 'collection.members':
      case 'collection.reorder':
      case 'collection.archive':
      case 'collection.restore': {
        const current = next.materialCollections.find((v) => v.id === command.collectionId)
        if (!current || (current.archived && command.kind !== 'collection.restore'))
          throw new AutomationError('not-found')
        let value = { ...current, updatedAt: now.toISOString() }
        if (command.kind === 'collection.patch') value.name = command.name
        else if (command.kind === 'collection.archive' || command.kind === 'collection.restore')
          value.archived = command.kind === 'collection.archive'
        else if (command.kind === 'collection.members') {
          const add = command.add ?? [],
            remove = new Set(command.remove ?? [])
          if (add.some((id) => remove.has(id) || !next.sources.some((v) => v.id === id)))
            throw new AutomationError('invalid-arguments')
          value.sourceIds = [
            ...current.sourceIds.filter((id) => !remove.has(id)),
            ...add.filter((id) => !current.sourceIds.includes(id)),
          ]
        } else {
          const live = new Set(next.sources.map((v) => v.id)),
            members = current.sourceIds.filter((id) => live.has(id))
          if (
            members.length !== command.sourceIds.length ||
            command.sourceIds.some((id) => !members.includes(id))
          )
            throw new AutomationError('invalid-arguments')
          let index = 0
          value.sourceIds = current.sourceIds.map((id) =>
            live.has(id) ? command.sourceIds[index++]! : id,
          )
        }
        value = materialCollectionSchema.parse(value)
        next = {
          ...next,
          materialCollections: next.materialCollections.map((v) => (v.id === value.id ? value : v)),
        }
        break
      }
      case 'source.create': {
        const prepared = prepareSource(
          {
            ...command.input,
            content: command.input.body,
            url: command.input.url ?? '',
            format: command.input.format ?? 'markdown',
          },
          now,
        )
        next = addSource(next, prepared.source, prepared.asset)
        if (command.destination)
          next = moveMaterial(next, {
            kind: 'source',
            id: prepared.source.id,
            destination: command.destination,
          })
        assets.push(prepared.asset)
        break
      }
      case 'source.patch': {
        const source = next.sources.find((value) => value.id === command.sourceId)
        if (!source) throw new AutomationError('not-found')
        if (source.mediaId !== command.versionId) throw new AutomationError('library-changed')
        if (command.patch.body !== undefined) {
          const prepared = replaceSourceContent(
            next,
            source.id,
            {
              title: command.patch.title ?? source.title,
              content: command.patch.body,
              format: source.format,
              url: source.url,
            },
            now,
          )
          next = prepared.library
          assets.push(prepared.asset)
        } else
          next = editSourceDetails(next, source.id, source.mediaId, source, {
            title: command.patch.title!,
            url: source.url,
          })
        break
      }
      case 'source.archive':
      case 'source.restore': {
        const source = next.sources.find((value) => value.id === command.sourceId)
        if (!source) throw new AutomationError('not-found')
        next = arrangeSource(
          next,
          source.id,
          source.mediaId,
          { type: command.kind === 'source.archive' ? 'archive' : 'restore' },
          now,
        )
        break
      }
      case 'source.move':
        next = moveMaterial(next, {
          kind: 'source',
          id: command.sourceId,
          destination: command.destination,
          beforeId: command.beforeId,
        })
        break
      case 'folder.create':
        next = addMaterialFolder(next, command.name, command.parentId)
        break
      case 'folder.patch':
        next = renameMaterialFolder(next, command.folderId, command.name)
        break
      case 'folder.remove':
        next = removeMaterialFolder(next, command.folderId)
        break
      case 'folder.move':
        next = moveMaterial(next, {
          kind: 'folder',
          id: command.folderId,
          destination: command.destination,
          beforeId: command.beforeId,
        })
        break
      case 'note.create':
        requireDeck(command.input.deckId)
        next = saveNote(
          next,
          { tags: [], frontMedia: [], backMedia: [], ...command.input },
          undefined,
          false,
          now,
        )
        break
      case 'note.patch': {
        const note = requireNote(command.noteId)
        if (command.patch.deckId) requireDeck(command.patch.deckId)
        const prior = retiredById.get(note.id)
        const prepared = noteLifecycle(
          next,
          { ...note, ...command.patch },
          note.id,
          prior,
          command.allowRemove ?? false,
          now,
        )
        next = prepared.library
        break
      }
      case 'note.move':
      case 'note.tags': {
        command.noteIds.forEach(requireNote)
        next = editNotes(
          next,
          new Set(command.noteIds),
          command.kind === 'note.move'
            ? { deckId: command.deckId, addTags: [], removeTags: [] }
            : { addTags: command.add ?? [], removeTags: command.remove ?? [] },
          now,
        )
        break
      }
      case 'note.remove':
        command.noteIds.forEach(requireNote)
        next = removeNotes(next, new Set(command.noteIds))
        break
      case 'deck.create': {
        const deck = deckSchema.parse({
          description: '',
          color: 'sage',
          ...command.input,
          id: crypto.randomUUID(),
          createdAt: now.toISOString(),
        })
        next = { ...next, decks: [...next.decks, deck] }
        break
      }
      case 'deck.patch': {
        const deck = requireDeck(command.deckId)
        const updated = deckSchema.parse({ ...deck, ...command.patch })
        next = {
          ...next,
          decks: next.decks.map((value) => (value.id === deck.id ? updated : value)),
        }
        break
      }
    }
  }
  validateLibraryReferences(next, () => {
    throw new AutomationError('invalid-arguments')
  })
  const touched = emptyAutomationIds(),
    resultIds = emptyAutomationIds()
  const changes: AutomationChange[] = []
  const entities = {
    sources: 'sources',
    materialFolders: 'folders',
    materialCollections: 'collections',
    notes: 'notes',
    decks: 'decks',
    cards: 'cards',
  } as const
  const operation = operationFor(library, next, 'automation-preview', '整理材料')
  for (const change of operation?.changes ?? []) {
    const entity = entities[change.store as keyof typeof entities]
    if (!entity) continue
    touched[entity].push(change.id)
    if (change.after) resultIds[entity].push(change.id)
    changes.push({
      entity,
      id: change.id,
      action: !change.before ? 'create' : !change.after ? 'remove' : 'update',
      fields: change.keys,
    })
  }
  return { library: next, assets, changes, touched, resultIds }
}

/** Metadata/index queries never load source bodies, attempts' code, credentials or plugin state. */
export function queryAutomation(library: Library, currentRevision: number, input: unknown) {
  const parsed = AutomationQuerySchema.safeParse(input)
  if (!parsed.success) throw new AutomationError('invalid-arguments')
  const query = parsed.data
  if (
    (query.revision !== undefined && query.revision !== currentRevision) ||
    ('offset' in query && query.offset > 0 && query.revision === undefined)
  )
    throw new AutomationError('library-changed')
  if (query.kind === 'source.body' || query.kind === 'retired' || query.kind === 'checkpoints')
    throw new AutomationError('host-action-required')
  if (query.kind === 'library')
    return {
      revision: currentRevision,
      counts: {
        sources: library.sources.length,
        folders: library.materialFolders.length,
        collections: library.materialCollections.filter((v) => !v.archived).length,
        notes: library.notes.length,
        decks: library.decks.length,
        cards: library.cards.length,
        reviews: library.reviews.length,
        practices: library.practices.length,
      },
    }
  const matches = (value: string, search?: string) =>
    !search || value.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  let items: unknown[]
  switch (query.kind) {
    case 'collections': {
      const sources = new Map(library.sources.map((v) => [v.id, v]))
      items = library.materialCollections
        .filter(
          (v) =>
            (!query.id || v.id === query.id) &&
            v.archived === (query.archived ?? false) &&
            matches(v.name, query.text),
        )
        .map((v) => ({
          ...v,
          members: v.sourceIds.map((id) => ({
            id,
            title: sources.get(id)?.title,
            available: sources.has(id),
          })),
        }))
      break
    }
    case 'decks':
      items = library.decks.filter(
        (value) => (!query.id || value.id === query.id) && matches(value.name, query.text),
      )
      break
    case 'folders':
      items = library.materialFolders.filter(
        (value) =>
          (!query.id || value.id === query.id) &&
          (!query.parentId || value.parentId === query.parentId) &&
          matches(value.name, query.text),
      )
      break
    case 'sources':
      items = library.sources
        .filter(
          (value) =>
            (!query.id || value.id === query.id) &&
            (!query.folderId || value.folderId === query.folderId) &&
            (!query.parentSourceId || value.parentSourceId === query.parentSourceId) &&
            matches(value.title, query.text),
        )
        .map((value) => ({
          id: value.id,
          title: value.title,
          versionId: value.mediaId,
          format: value.format,
          characters: value.characters,
          folderId: value.folderId,
          parentSourceId: value.parentSourceId,
          order: value.order,
          createdAt: value.createdAt,
          queue: value.queue,
          studyPriority: value.studyPriority,
          kind: value.kind ?? 'original',
          versions: value.versions?.map((version) => ({
            versionId: version.mediaId,
            title: version.title,
            characters: version.characters,
            format: version.format,
            acceptedAt: version.acceptedAt,
          })),
        }))
      break
    case 'notes':
      items = library.notes
        .filter(
          (value) =>
            (!query.id || value.id === query.id) &&
            (!query.deckId || value.deckId === query.deckId) &&
            (!query.sourceId || value.excerpt?.sourceId === query.sourceId) &&
            (!query.tag || value.tags.includes(query.tag)) &&
            matches(`${value.front}\n${value.back}`, query.text),
        )
        .map((value) => ({
          id: value.id,
          deckId: value.deckId,
          type: value.type,
          format: value.format,
          front: value.front,
          back: value.back,
          tags: value.tags,
          frontMedia: value.frontMedia,
          backMedia: value.backMedia,
          excerpt: value.excerpt,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          studyPriority: value.studyPriority,
          ...(value.plugin
            ? { plugin: { id: value.plugin.id, version: value.plugin.version } }
            : {}),
        }))
      break
    case 'cards': {
      const notes = new Map(library.notes.map((note) => [note.id, note]))
      items = library.cards
        .filter(
          (value) =>
            (!query.id || value.id === query.id) &&
            (!query.noteId || value.noteId === query.noteId) &&
            (!query.deckId || notes.get(value.noteId)?.deckId === query.deckId),
        )
        .map((value) => ({ ...value, deckId: notes.get(value.noteId)?.deckId }))
      break
    }
    case 'history':
      if (query.historyKind === 'reading') {
        if (query.cardId) throw new AutomationError('invalid-arguments')
        items = library.studyEvents
          .filter((value) => value.kind === 'reading')
          .map((value) => ({ ...value }))
      } else if (query.historyKind === 'practices') {
        items = library.practices
          .filter((value) => !query.cardId || value.cardId === query.cardId)
          .map((value) => ({
            id: value.id,
            cardId: value.cardId,
            question: value.question.front,
            startedAt: value.startedAt,
            completedAt: value.completedAt,
            completion: value.completion,
            rating: value.rating,
          }))
      } else
        items = library.reviews
          .filter((value) => !query.cardId || value.cardId === query.cardId)
          .map(({ previous: _previous, effects: _effects, ...value }) => value)
      break
  }
  const pageItems = items.slice(query.offset, query.offset + query.limit)
  return structuredClone({
    revision: currentRevision,
    offset: query.offset,
    limit: query.limit,
    total: items.length,
    nextOffset:
      query.offset + pageItems.length < items.length ? query.offset + pageItems.length : undefined,
    items: pageItems,
  })
}
