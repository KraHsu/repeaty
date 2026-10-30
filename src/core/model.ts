import { msg, LocalizedError } from '../i18n'
import { inlineMediaSchema } from './inline-media-data'
import { z } from 'zod'
import { studySettingsSchema } from './study-settings'
import { fsrsModelSchema, studyEventSchema, studyActivitySchema } from './study-data'
import { sourceConnectionSchema, sourceCandidateSchema } from './collection-data'
import { automationReceiptSchema, validateAutomationReceipts } from './automation-data'
export { automationReceiptSchema } from './automation-data'
export { sourceConnectionSchema, sourceCandidateSchema } from './collection-data'
import { materialFolderSchema, validateMaterialFolders } from './material-organization-data'
import { createEmptyCard, type Card as FsrsCard } from 'ts-fsrs'
import { scheduleSchema, librarySchema as legacySchema } from './legacy'
import { pluginDataSchema, assessmentSchema } from '../plugins/data'
import { sourceSchema, excerptSchema, MAX_SOURCE_BYTES, referencedSource } from './source-data'
import { validateSourceHierarchy } from './source-tree'
import {
  materialLocatorMatches,
  materialReceiptSchema,
  locatorMatchesReference,
} from './material-data'
import { validateMaterialSequences } from './material-sequence'
import { practiceSchema, attemptSchema, attemptSummarySchema } from './practice-data'

export { studySettingsSchema } from './study-settings'
export { fsrsModelSchema, studyEventSchema, studyActivitySchema } from './study-data'
export { scheduleSchema } from './legacy'
export { materialReceiptSchema } from './material-data'
export { materialFolderSchema } from './material-organization-data'
const date = z.iso.datetime()
const id = z.string().min(1).max(150)
const tags = z.array(z.string().trim().min(1).max(40)).max(20)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const autoBurialSchema = z.object({ day, reviewId: id })
export const filterStates = [
  'all',
  '新卡片',
  '待复习',
  '学习中',
  '复习中',
  '已暂停',
  '今日暂缓',
  '顽固卡',
] as const
export const savedSearchSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  query: z.string().max(1000),
  deckId: z.string().max(150),
  state: z.enum(filterStates),
})
export type SavedSearch = z.infer<typeof savedSearchSchema>
export type SearchFilter = Pick<SavedSearch, 'query' | 'deckId' | 'state'>
export interface StudySession {
  ids: string[]
  reschedule: boolean
}
export const colors = ['sage', 'sand', 'lavender', 'blue', 'rose'] as const
export const noteTypes = {
  basic: '正反面',
  reversed: '双向卡',
  cloze: '挖空卡',
  plugin: '插件题目',
} as const
export const mediaTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/webm',
  'audio/flac',
  'audio/aac',
] as const
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024

export function clozes(text: string) {
  const result: { raw: string; number: number; answer: string; hint: string }[] = []
  const fail = () =>
    new LocalizedError(
      msg('挖空格式应为 {{c1::答案}} 或 {{c1::答案::提示}}，编号为 1–99，不支持嵌套挖空。'),
    )
  const starts = /\{\{c/gi
  let match: RegExpExecArray | null
  while ((match = starts.exec(text))) {
    const header = text.slice(match.index).match(/^\{\{c([1-9]\d?)::/)
    if (!header) throw fail()
    const start = match.index + header[0].length
    let end = start,
      depth = 0
    for (; end < text.length; end++) {
      if (/^\{\{c/i.test(text.slice(end))) throw fail()
      if (text.startsWith('}}', end) && depth === 0) break
      if (text[end] === '\\' && !(depth === 0 && text.startsWith('}}', end + 1))) {
        end++
        continue
      }
      if (text[end] === '{') depth++
      if (text[end] === '}' && --depth < 0) throw fail()
    }
    if (end >= text.length) throw fail()
    const [answer, ...hints] = text.slice(start, end).split('::')
    if (!answer?.trim()) throw new LocalizedError(msg('挖空答案不能为空。'))
    result.push({
      raw: text.slice(match.index, end + 2),
      number: Number(header[1]),
      answer,
      hint: hints.join('::'),
    })
    starts.lastIndex = end + 2
  }
  if (!result.length) throw fail()
  return result
}

export const deckSchema = z.object({
  id,
  studyPriority: z.number().int().min(0).max(9).optional(),
  activeFsrsModelId: id.optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300),
  color: z.enum(colors),
  createdAt: date,
  newLimit: z.number().int().min(0).max(9999).default(20),
  reviewLimit: z.number().int().min(0).max(9999).default(200),
  burySiblings: z.boolean().default(true),
  leechThreshold: z.number().int().min(0).max(100).default(8),
  desiredRetention: z.number().min(0.7).max(0.97).default(0.9),
})
export const noteSchema = z
  .object({
    id,
    deckId: id,
    studyPriority: z.number().int().min(0).max(9).optional(),
    type: z.enum(['basic', 'reversed', 'cloze', 'plugin']),
    plugin: pluginDataSchema.optional(),
    excerpt: excerptSchema.optional(),
    inlineMedia: inlineMediaSchema.optional(),
    format: z.enum(['plain', 'markdown']).default('plain'),
    front: z
      .string()
      .min(1)
      .max(10_000)
      .refine((value) => value.trim().length > 0),
    back: z.string().max(10_000),
    tags,
    frontMedia: z.array(id).max(8),
    backMedia: z.array(id).max(8),
    createdAt: date,
    updatedAt: date,
  })
  .superRefine((note, ctx) => {
    if (note.type !== 'cloze' && note.type !== 'plugin' && !note.back)
      ctx.addIssue({ code: 'custom', message: '答案不能为空' })
    if (note.type === 'plugin' && !note.plugin)
      ctx.addIssue({ code: 'custom', message: '请选择题目插件。' })
    if (note.type !== 'plugin' && note.plugin)
      ctx.addIssue({ code: 'custom', message: '普通卡片不能包含插件数据。' })
    for (const locator of Object.values(note.plugin?.variantLocators ?? {}))
      if (!note.excerpt || !locatorMatchesReference(note.excerpt, locator))
        ctx.addIssue({ code: 'custom', message: '区域定位与笔记出处不匹配。' })
    if (note.type === 'cloze') {
      try {
        clozes(note.front)
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: (error as Error).message,
          params: error instanceof LocalizedError ? { i18n: error.detail } : undefined,
        })
      }
    }
  })
export const cardSchema = z.object({
  id,
  noteId: id,
  variant: z.string().regex(/^(forward|reverse|cloze:[1-9]\d?|plugin:[a-zA-Z0-9_-]{1,80})$/),
  schedule: scheduleSchema,
  createdAt: date,
  updatedAt: date,
  suspended: z.boolean(),
  leech: z.boolean().default(false),
  autoBurial: autoBurialSchema.optional(),
  buriedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})
export const mediaSchema = z
  .object({
    id,
    name: z.string().min(1).max(255),
    type: z.enum([
      ...mediaTypes,
      'text/plain',
      'text/markdown',
      'text/html',
      'application/pdf',
      'application/epub+zip',
      'application/json',
      'application/octet-stream',
    ]),
    size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
    createdAt: date,
  })
  .refine(
    (asset) =>
      asset.size <= MAX_MEDIA_BYTES ||
      ['application/pdf', 'application/epub+zip', 'text/html', 'application/octet-stream'].includes(
        asset.type,
      ),
  )
export const reviewSchema = z.object({
  id,
  cardId: id,
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reviewedAt: date,
  nextDue: date,
  studyDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['new', 'review', 'learning', 'legacy']),
  source: z.enum(['normal', 'filtered']).default('normal'),
  assessment: assessmentSchema.optional(),
  practiceId: id.optional(),
  effects: z
    .object({
      siblings: z.array(z.object({ cardId: id, previous: autoBurialSchema.optional() })).max(99),
      markedLeech: z.boolean(),
    })
    .optional(),
  previous: z.object({ schedule: scheduleSchema, updatedAt: date }).optional(),
})
export type Schedule = z.infer<typeof scheduleSchema>
export type Deck = z.infer<typeof deckSchema>
export type Note = z.infer<typeof noteSchema>
export type Card = z.infer<typeof cardSchema>
export type Media = z.infer<typeof mediaSchema>
export type Review = z.infer<typeof reviewSchema>
export type Grade = Review['rating']
export type DeckInput = Pick<
  Deck,
  | 'name'
  | 'description'
  | 'color'
  | 'newLimit'
  | 'reviewLimit'
  | 'burySiblings'
  | 'leechThreshold'
  | 'desiredRetention'
  | 'studyPriority'
>
export type NoteInput = Pick<
  Note,
  | 'deckId'
  | 'studyPriority'
  | 'type'
  | 'front'
  | 'back'
  | 'tags'
  | 'frontMedia'
  | 'backMedia'
  | 'plugin'
  | 'excerpt'
  | 'inlineMedia'
> & { format?: Note['format'] }
export type CardView = Card &
  Pick<
    Note,
    | 'deckId'
    | 'front'
    | 'back'
    | 'tags'
    | 'type'
    | 'format'
    | 'frontMedia'
    | 'backMedia'
    | 'plugin'
    | 'excerpt'
    | 'inlineMedia'
  > & { cloze?: { answers: string[]; context: string; extra: string } }
export interface MediaUpload {
  meta: Media
  blob: Blob
}

export function variants(
  note: Pick<Note, 'type' | 'front'> & { plugin?: Note['plugin'] },
): string[] {
  if (note.type === 'plugin' && note.plugin?.variants)
    return note.plugin.variants.map((key) => `plugin:${key}`)
  if (note.type === 'basic' || note.type === 'plugin') return ['forward']
  if (note.type === 'reversed') return ['forward', 'reverse']
  return [...new Set(clozes(note.front).map((cloze) => cloze.number))]
    .sort((a, b) => a - b)
    .map((number) => `cloze:${number}`)
}

const libraryContents = z.object({
  version: z.literal(19),
  studySettings: z.array(studySettingsSchema).max(1).default([]),
  studyEvents: z.array(studyEventSchema).max(500_000).default([]),
  studyActivity: z.array(studyActivitySchema).max(500_000).default([]),
  fsrsModels: z.array(fsrsModelSchema).max(200).default([]),
  materialFolders: z.array(materialFolderSchema).max(10_000).default([]),
  materialReceipts: z.array(materialReceiptSchema).max(100_000).default([]),
  automationReceipts: z.array(automationReceiptSchema).max(100_000).default([]),
  sourceConnections: z.array(sourceConnectionSchema).max(100).default([]),
  sourceCandidates: z.array(sourceCandidateSchema).max(10_000).default([]),
  sources: z.array(sourceSchema).max(10_000),
  practices: z.array(practiceSchema).max(100_000),
  attempts: z.array(attemptSchema).max(500_000),
  savedSearches: z.array(savedSearchSchema).max(100).default([]),
  decks: z.array(deckSchema).max(1000),
  notes: z.array(noteSchema).max(100_000),
  cards: z.array(cardSchema).max(200_000),
  reviews: z.array(reviewSchema).max(500_000),
  media: z.array(mediaSchema).max(100_000),
})
export function validateLibraryReferences(
  library: Omit<z.infer<typeof libraryContents>, 'attempts'> & {
    attempts: { id: string; practiceId: string }[]
  },
  problem: (message: string) => void,
) {
  for (const key of [
    'decks',
    'notes',
    'cards',
    'reviews',
    'media',
    'savedSearches',
    'practices',
    'attempts',
    'sources',
    'materialReceipts',
    'automationReceipts',
    'materialFolders',
    'sourceConnections',
    'sourceCandidates',
    'studySettings',
    'studyEvents',
    'studyActivity',
    'fsrsModels',
  ] as const) {
    if (new Set(library[key].map((entry) => entry.id)).size !== library[key].length)
      problem(`${key} 中存在重复 ID`)
  }
  const models = new Map(library.fsrsModels.map((model) => [model.id, model]))
  const globalModel = library.studySettings[0]?.activeFsrsModelId
  if (globalModel && (!models.has(globalModel) || models.get(globalModel)!.deckId))
    problem('默认记忆参数不存在或不适用')
  for (const deck of library.decks) {
    const model = deck.activeFsrsModelId && models.get(deck.activeFsrsModelId)
    if (deck.activeFsrsModelId && (!model || model.deckId !== deck.id))
      problem('卡组记忆参数不存在或不适用')
  }
  const decks = new Set(library.decks.map((deck) => deck.id))
  const notes = new Map(library.notes.map((note) => [note.id, note]))
  const cards = new Set(library.cards.map((card) => card.id))
  const media = new Map(library.media.map((item) => [item.id, item]))
  const sources = new Map(library.sources.map((source) => [source.id, source]))
  const connections = new Set(library.sourceConnections.map((connection) => connection.id))
  const candidateKeys = new Set<string>(),
    bindings = new Set<string>()
  for (const candidate of library.sourceCandidates) {
    const key = JSON.stringify([candidate.connectionId, candidate.key])
    if (candidateKeys.has(key) || !connections.has(candidate.connectionId))
      problem('来源候选的连接或身份无效')
    candidateKeys.add(key)
    if (
      candidate.mediaId &&
      (!media.has(candidate.mediaId) ||
        !['text/plain', 'text/markdown'].includes(media.get(candidate.mediaId)!.type))
    )
      problem('来源候选正文不存在')
    for (const resource of candidate.resources ?? [])
      if (!media.has(resource.mediaId)) problem('来源候选附件不存在')
    // Removed accepted materials can leave a reviewable candidate, but never a dangling version.
    if (
      candidate.sourceId &&
      sources.has(candidate.sourceId) &&
      candidate.baseMediaId &&
      ![
        sources.get(candidate.sourceId)!,
        ...(sources.get(candidate.sourceId)!.versions ?? []),
      ].some((v) => v.mediaId === candidate.baseMediaId)
    )
      problem('来源候选基线版本不存在')
  }
  for (const source of library.sources)
    if (source.binding) {
      const key = JSON.stringify([source.binding.connectionId, source.binding.key])
      if (bindings.has(key) || !connections.has(source.binding.connectionId))
        problem('材料来源关联无效或重复')
      bindings.add(key)
      if (
        ![source, ...(source.versions ?? [])].some(
          (v) => v.mediaId === source.binding!.acceptedMediaId,
        )
      )
        problem('来源已接受版本不存在')
    }
  const receiptKeys = new Set<string>()
  validateAutomationReceipts([], library.automationReceipts, problem)
  for (const receipt of library.materialReceipts) {
    const key = JSON.stringify([receipt.pluginId, receipt.kind, receipt.operationId])
    if (receiptKeys.has(key)) problem('材料操作身份重复')
    receiptKeys.add(key)
  }
  for (const source of library.sources) {
    for (const snapshot of [source, ...(source.versions ?? [])]) {
      const asset = media.get(snapshot.mediaId)
      if (
        !asset ||
        asset.type !== (snapshot.format === 'markdown' ? 'text/markdown' : 'text/plain') ||
        asset.size > MAX_SOURCE_BYTES
      )
        problem('来源正文缺失或格式不正确')
      if (snapshot.document) {
        for (const resource of snapshot.document.resources ?? [])
          if (!media.has(resource.mediaId)) problem('文档资源缺失')
        const original = media.get(snapshot.document.originalMediaId)
        const expected = (
          { pdf: 'application/pdf', epub: 'application/epub+zip', html: 'text/html' } as Record<
            string,
            string
          >
        )[snapshot.document.format]
        if (
          !original ||
          (expected && original.type !== expected) ||
          (snapshot.document.format === 'image' && !original.type.startsWith('image/'))
        )
          problem('来源原件缺失或格式不正确')
      }
    }
    if (source.origin) {
      const parent = sources.get(source.origin.sourceId)
      const snapshot = parent && referencedSource(parent, source.origin)
      if (
        !snapshot ||
        (!source.derived && source.format !== snapshot.format) ||
        source.origin.end > snapshot.characters ||
        (source.origin.locator && !materialLocatorMatches(snapshot, source.origin.locator))
      )
        problem('摘录与来源不匹配')
    }
  }
  for (const entry of [
    ...library.notes,
    ...library.sources.flatMap((source) => [source, ...(source.versions ?? [])]),
  ])
    for (const ref of entry.inlineMedia ?? [])
      if (!mediaTypes.includes(media.get(ref.mediaId)?.type as (typeof mediaTypes)[number]))
        problem('笔记引用的媒体不存在')
  validateSourceHierarchy(library.sources, problem)
  validateMaterialSequences(library.sources, problem)
  validateMaterialFolders(library.materialFolders, library.sources, problem)
  const cardVariants = new Map<string, string[]>()
  for (const card of library.cards) {
    if (!notes.has(card.noteId)) problem('卡片所属笔记不存在')
    cardVariants.set(card.noteId, [...(cardVariants.get(card.noteId) ?? []), card.variant])
  }
  for (const note of library.notes) {
    if (!decks.has(note.deckId)) problem('笔记所属卡组不存在')
    if ([...note.frontMedia, ...note.backMedia].some((mediaId) => !media.has(mediaId)))
      problem('笔记引用的媒体不存在')
    if (
      [...note.frontMedia, ...note.backMedia].some(
        (id) => !mediaTypes.includes(media.get(id)?.type as (typeof mediaTypes)[number]),
      )
    )
      problem('正文快照不能用作图片或音频')
    if (note.excerpt) {
      const parent = sources.get(note.excerpt.sourceId)
      const source = parent && referencedSource(parent, note.excerpt)
      if (
        !source ||
        note.excerpt.end > source.characters ||
        note.excerpt.end - note.excerpt.start !== note.excerpt.quote.length ||
        (note.excerpt.locator && !materialLocatorMatches(source, note.excerpt.locator)) ||
        Object.values(note.plugin?.variantLocators ?? {}).some(
          (locator) => !source || !materialLocatorMatches(source, locator),
        )
      )
        problem('摘录与来源不匹配')
    }
    try {
      if (variants(note).sort().join(',') !== (cardVariants.get(note.id) ?? []).sort().join(','))
        problem('卡片与笔记生成规则不匹配')
    } catch {
      problem('挖空格式不正确')
    }
  }
  if (library.reviews.some((review) => !cards.has(review.cardId)))
    problem('复习记录对应的卡片不存在')
  const practices = new Map(library.practices.map((entry) => [entry.id, entry]))
  if (library.practices.some((entry) => !cards.has(entry.cardId))) problem('练习对应的卡片不存在')
  if (library.attempts.some((entry) => !practices.has(entry.practiceId)))
    problem('提交对应的练习不存在')
  for (const review of library.reviews) {
    if (review.practiceId && practices.get(review.practiceId)?.cardId !== review.cardId)
      problem('评分与练习不匹配')
  }
  const reviews = new Map(library.reviews.map((entry) => [entry.id, entry]))
  for (const practice of library.practices) {
    const review = practice.reviewId ? reviews.get(practice.reviewId) : undefined
    if (
      practice.reviewId &&
      (!review ||
        review.practiceId !== practice.id ||
        review.cardId !== practice.cardId ||
        review.rating !== practice.rating)
    )
      problem('练习关联的评分不存在')
  }
}
export const librarySchema = libraryContents.superRefine((library, ctx) =>
  validateLibraryReferences(library, (message) => ctx.addIssue({ code: 'custom', message })),
)
export const workspaceLibrarySchema = libraryContents
  .extend({ attempts: z.array(z.union([attemptSchema, attemptSummarySchema])).max(500_000) })
  .superRefine((library, ctx) =>
    validateLibraryReferences(library, (message) => ctx.addIssue({ code: 'custom', message })),
  )
export type Library = z.infer<typeof workspaceLibrarySchema>
export const recordSchemas = {
  studySettings: studySettingsSchema,
  studyEvents: studyEventSchema,
  studyActivity: studyActivitySchema,
  fsrsModels: fsrsModelSchema,
  sourceConnections: sourceConnectionSchema,
  sourceCandidates: sourceCandidateSchema,
  materialFolders: materialFolderSchema,
  sources: sourceSchema,
  materialReceipts: materialReceiptSchema,
  automationReceipts: automationReceiptSchema,
  decks: deckSchema,
  notes: noteSchema,
  cards: cardSchema,
  reviews: reviewSchema,
  media: mediaSchema,
  savedSearches: savedSearchSchema,
  practices: practiceSchema,
  attempts: attemptSchema,
}
export function emptyLibrary(): Library {
  return {
    version: 19,
    studySettings: [],
    studyEvents: [],
    studyActivity: [],
    fsrsModels: [],
    materialFolders: [],
    materialReceipts: [],
    automationReceipts: [],
    sourceConnections: [],
    sourceCandidates: [],
    sources: [],
    decks: [],
    notes: [],
    cards: [],
    reviews: [],
    media: [],
    savedSearches: [],
    practices: [],
    attempts: [],
  }
}
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function serializeSchedule(card: FsrsCard): Schedule {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() }
}
export function hydrateSchedule(card: Schedule): FsrsCard {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  }
}
export function newCard(noteId: string, variant: string, now = new Date()): Card {
  return {
    id: crypto.randomUUID(),
    noteId,
    variant,
    schedule: serializeSchedule(createEmptyCard(now)),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    suspended: false,
    leech: false,
  }
}
export function renderCard(card: Card, note: Note): CardView {
  let front = note.front,
    back = note.back,
    frontMedia = note.frontMedia,
    backMedia = note.backMedia
  if (card.variant === 'reverse')
    [front, back, frontMedia, backMedia] = [back, front, backMedia, frontMedia]
  let cloze: CardView['cloze']
  if (note.type === 'cloze') {
    const target = Number(card.variant.split(':')[1])
    let answer = front
    const deletions = clozes(note.front)
    for (const item of deletions) {
      front = front.replace(item.raw, () =>
        item.number === target ? `[${item.hint || '…'}]` : item.answer,
      )
      answer = answer.replace(item.raw, () => item.answer)
    }
    cloze = {
      answers: deletions.filter((item) => item.number === target).map((item) => item.answer),
      context: answer,
      extra: note.back,
    }
    back = answer + (note.back ? `\n\n${note.back}` : '')
  }
  return {
    ...card,
    cloze,
    deckId: note.deckId,
    type: note.type,
    plugin: note.plugin,
    excerpt:
      note.excerpt && note.plugin?.variantLocators?.[card.variant.slice(7)]
        ? { ...note.excerpt, locator: note.plugin.variantLocators[card.variant.slice(7)] }
        : note.excerpt,
    inlineMedia: note.inlineMedia,
    format: note.format,
    tags: note.tags,
    front,
    back,
    frontMedia,
    backMedia,
  }
}
export function cardViews(library: Library): CardView[] {
  const notes = new Map(library.notes.map((note) => [note.id, note]))
  return library.cards.map((card) => renderCard(card, notes.get(card.noteId)!))
}
/** For UI consumers of immutable snapshots: reuse unchanged rendered cards. */
export function createCardViewReader() {
  const cache = new WeakMap<Card, { note: Note; view: CardView }>()
  let previousNotes: Library['notes'] | undefined,
    notes = new Map<string, Note>()
  return (library: Library) => {
    if (previousNotes !== library.notes) {
      previousNotes = library.notes
      notes = new Map(library.notes.map((note) => [note.id, note]))
    }
    return library.cards.map((card) => {
      const note = notes.get(card.noteId)!,
        prior = cache.get(card)
      if (prior?.note === note) return prior.view
      const view = renderCard(card, note)
      cache.set(card, { note, view })
      return view
    })
  }
}
export function pruneMedia(library: Library): Library {
  const used = new Set([
    ...library.notes.flatMap((note) => [...note.frontMedia, ...note.backMedia]),
    ...library.sources.flatMap((source) => [
      source.mediaId,
      ...(source.versions ?? []).map((version) => version.mediaId),
    ]),
  ])
  for (const candidate of library.sourceCandidates) {
    if (candidate.mediaId) used.add(candidate.mediaId)
    for (const resource of candidate.resources ?? []) used.add(resource.mediaId)
  }
  for (const note of library.notes) for (const ref of note.inlineMedia ?? []) used.add(ref.mediaId)
  for (const source of library.sources)
    for (const version of [source, ...(source.versions ?? [])]) {
      if (version.document) used.add(version.document.originalMediaId)
      for (const resource of version.document?.resources ?? []) used.add(resource.mediaId)
      for (const ref of version.inlineMedia ?? []) used.add(ref.mediaId)
    }
  return { ...library, media: library.media.filter((item) => used.has(item.id)) }
}
export function saveNote(
  library: Library,
  input: NoteInput,
  noteId?: string,
  allowRemove = false,
  now = new Date(),
): Library {
  const previous = library.notes.find((note) => note.id === noteId)
  if (noteId && !previous) throw new LocalizedError(msg('笔记已不存在，请刷新页面。'))
  const note = noteSchema.parse({
    ...input,
    studyPriority: Object.hasOwn(input, 'studyPriority')
      ? input.studyPriority
      : previous?.studyPriority,
    excerpt: input.excerpt ?? previous?.excerpt,
    inlineMedia: input.inlineMedia ?? previous?.inlineMedia,
    id: noteId ?? crypto.randomUUID(),
    createdAt: previous?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  })
  const keys = variants(note)
  const oldCards = library.cards.filter((card) => card.noteId === note.id)
  const removed = new Set(
    oldCards.filter((card) => !keys.includes(card.variant)).map((card) => card.id),
  )
  if (removed.size && !allowRemove)
    throw new LocalizedError(msg('修改后部分卡片将不再生成，请确认移除这些卡片及其复习记录。'))
  const removedPractices = new Set(
    library.practices.filter((entry) => removed.has(entry.cardId)).map((entry) => entry.id),
  )
  // Existing cards keep their index; only new variants append. Editing a note must not
  // shift every later card, which would rewrite the whole library on each save.
  const existing = new Set(oldCards.map((card) => card.variant))
  const added = keys.filter((key) => !existing.has(key)).map((key) => newCard(note.id, key, now))
  return pruneMedia({
    ...library,
    notes: previous
      ? library.notes.map((entry) => (entry.id === note.id ? note : entry))
      : [...library.notes, note],
    cards:
      added.length || removed.size
        ? [...library.cards.filter((card) => !removed.has(card.id)), ...added]
        : library.cards,
    reviews: library.reviews.filter((review) => !removed.has(review.cardId)),
    practices: library.practices.filter((entry) => !removed.has(entry.cardId)),
    attempts: library.attempts.filter((entry) => !removedPractices.has(entry.practiceId)),
  })
}
export function removeNotes(library: Library, ids: Set<string>): Library {
  const removed = new Set(
    library.cards.filter((card) => ids.has(card.noteId)).map((card) => card.id),
  )
  const removedPractices = new Set(
    library.practices.filter((entry) => removed.has(entry.cardId)).map((entry) => entry.id),
  )
  return pruneMedia({
    ...library,
    notes: library.notes.filter((note) => !ids.has(note.id)),
    cards: library.cards.filter((card) => !removed.has(card.id)),
    reviews: library.reviews.filter((review) => !removed.has(review.cardId)),
    practices: library.practices.filter((entry) => !removed.has(entry.cardId)),
    attempts: library.attempts.filter((entry) => !removedPractices.has(entry.practiceId)),
  })
}

export function migrateLibrary(value: unknown): Library {
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    (value.version === 2 ||
      value.version === 3 ||
      value.version === 4 ||
      value.version === 5 ||
      value.version === 6 ||
      value.version === 7 ||
      value.version === 8 ||
      value.version === 9 ||
      value.version === 10 ||
      value.version === 11 ||
      value.version === 12 ||
      value.version === 13 ||
      value.version === 14 ||
      value.version === 15 ||
      value.version === 16 ||
      value.version === 17 ||
      value.version === 18 ||
      value.version === 19)
  )
    return librarySchema.parse(
      value.version === 19
        ? value
        : value.version === 6 ||
            value.version === 7 ||
            value.version === 8 ||
            value.version === 9 ||
            value.version === 10 ||
            value.version === 11 ||
            value.version === 12 ||
            value.version === 13 ||
            value.version === 14 ||
            value.version === 15 ||
            value.version === 16 ||
            value.version === 17 ||
            value.version === 18
          ? { ...value, version: 19 }
          : value.version === 5
            ? { sources: [], ...value, version: 19 }
            : {
                sources: [],
                practices: [],
                attempts: [],
                ...value,
                version: 19,
              },
    )
  const old = legacySchema.parse(value)
  const seen = new Set<string>()
  return librarySchema.parse({
    version: 19,
    sources: [],
    practices: [],
    attempts: [],
    decks: old.decks,
    media: [],
    notes: old.cards.map((card) => ({
      id: `note-${card.id}`,
      deckId: card.deckId,
      type: 'basic',
      front: card.front,
      back: card.back,
      tags: card.tags,
      frontMedia: [],
      backMedia: [],
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    })),
    cards: old.cards.map((card) => ({
      id: card.id,
      noteId: `note-${card.id}`,
      variant: 'forward',
      schedule: card.schedule,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      suspended: false,
    })),
    reviews: [...old.reviews]
      .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
      .map((review) => {
        // V1 did not record the pre-review state: don't invent a review/learning classification.
        const kind = seen.has(review.cardId) ? 'legacy' : 'new'
        seen.add(review.cardId)
        return { ...review, kind, studyDay: localDay(new Date(review.reviewedAt)) }
      }),
  })
}
