import { z } from 'zod'
import { createEmptyCard, type Card as FsrsCard } from 'ts-fsrs'
import { scheduleSchema, librarySchema as legacySchema } from './legacy'

export { scheduleSchema } from './legacy'
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
export const noteTypes = { basic: '正反面', reversed: '双向卡', cloze: '挖空卡' } as const
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
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024

export function clozes(text: string) {
  const result: { raw: string; number: number; answer: string; hint: string }[] = []
  const fail = () =>
    new Error('挖空格式应为 {{c1::答案}} 或 {{c1::答案::提示}}，编号为 1–99，不支持嵌套挖空。')
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
    if (!answer?.trim()) throw new Error('挖空答案不能为空。')
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
    type: z.enum(['basic', 'reversed', 'cloze']),
    format: z.enum(['plain', 'markdown']).default('plain'),
    front: z.string().trim().min(1).max(10_000),
    back: z.string().trim().max(10_000),
    tags,
    frontMedia: z.array(id).max(8),
    backMedia: z.array(id).max(8),
    createdAt: date,
    updatedAt: date,
  })
  .superRefine((note, ctx) => {
    if (note.type !== 'cloze' && !note.back)
      ctx.addIssue({ code: 'custom', message: '答案不能为空' })
    if (note.type === 'cloze') {
      try {
        clozes(note.front)
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message })
      }
    }
  })
export const cardSchema = z.object({
  id,
  noteId: id,
  variant: z.string().regex(/^(forward|reverse|cloze:[1-9]\d?)$/),
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
export const mediaSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  type: z.enum(mediaTypes),
  size: z.number().int().positive().max(MAX_MEDIA_BYTES),
  createdAt: date,
})
export const reviewSchema = z.object({
  id,
  cardId: id,
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reviewedAt: date,
  nextDue: date,
  studyDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['new', 'review', 'learning', 'legacy']),
  source: z.enum(['normal', 'filtered']).default('normal'),
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
>
export type NoteInput = Pick<
  Note,
  'deckId' | 'type' | 'front' | 'back' | 'tags' | 'frontMedia' | 'backMedia'
> & { format?: Note['format'] }
export type CardView = Card &
  Pick<Note, 'deckId' | 'front' | 'back' | 'tags' | 'type' | 'format' | 'frontMedia' | 'backMedia'>
export interface MediaUpload {
  meta: Media
  blob: Blob
}

export function variants(note: Pick<Note, 'type' | 'front'>): string[] {
  if (note.type === 'basic') return ['forward']
  if (note.type === 'reversed') return ['forward', 'reverse']
  return [...new Set(clozes(note.front).map((cloze) => cloze.number))]
    .sort((a, b) => a - b)
    .map((number) => `cloze:${number}`)
}

export const librarySchema = z
  .object({
    version: z.literal(3),
    savedSearches: z.array(savedSearchSchema).max(100).default([]),
    decks: z.array(deckSchema).max(1000),
    notes: z.array(noteSchema).max(100_000),
    cards: z.array(cardSchema).max(200_000),
    reviews: z.array(reviewSchema).max(500_000),
    media: z.array(mediaSchema).max(100_000),
  })
  .superRefine((library, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: 'custom', message })
    for (const key of ['decks', 'notes', 'cards', 'reviews', 'media', 'savedSearches'] as const) {
      if (new Set(library[key].map((entry) => entry.id)).size !== library[key].length)
        problem(`${key} 中存在重复 ID`)
    }
    const decks = new Set(library.decks.map((deck) => deck.id))
    const notes = new Map(library.notes.map((note) => [note.id, note]))
    const cards = new Set(library.cards.map((card) => card.id))
    const media = new Set(library.media.map((item) => item.id))
    const cardVariants = new Map<string, string[]>()
    for (const card of library.cards) {
      if (!notes.has(card.noteId)) problem('卡片所属笔记不存在')
      cardVariants.set(card.noteId, [...(cardVariants.get(card.noteId) ?? []), card.variant])
    }
    for (const note of library.notes) {
      if (!decks.has(note.deckId)) problem('笔记所属卡组不存在')
      if ([...note.frontMedia, ...note.backMedia].some((mediaId) => !media.has(mediaId)))
        problem('笔记引用的媒体不存在')
      try {
        if (variants(note).sort().join(',') !== (cardVariants.get(note.id) ?? []).sort().join(','))
          problem('卡片与笔记生成规则不匹配')
      } catch {
        problem('挖空格式不正确')
      }
    }
    if (library.reviews.some((review) => !cards.has(review.cardId)))
      problem('复习记录对应的卡片不存在')
  })
export type Library = z.infer<typeof librarySchema>
export function emptyLibrary(): Library {
  return { version: 3, decks: [], notes: [], cards: [], reviews: [], media: [], savedSearches: [] }
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
  if (note.type === 'cloze') {
    const target = Number(card.variant.split(':')[1])
    let answer = front
    for (const item of clozes(note.front)) {
      front = front.replace(item.raw, () =>
        item.number === target ? `[${item.hint || '…'}]` : item.answer,
      )
      answer = answer.replace(item.raw, () => item.answer)
    }
    back = answer + (note.back ? `\n\n${note.back}` : '')
  }
  return {
    ...card,
    deckId: note.deckId,
    type: note.type,
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
export function pruneMedia(library: Library): Library {
  const used = new Set(library.notes.flatMap((note) => [...note.frontMedia, ...note.backMedia]))
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
  if (noteId && !previous) throw new Error('笔记已不存在，请刷新页面。')
  const note = noteSchema.parse({
    ...input,
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
    throw new Error('修改后部分卡片将不再生成，请确认移除这些卡片及其复习记录。')
  return pruneMedia({
    ...library,
    notes: previous
      ? library.notes.map((entry) => (entry.id === note.id ? note : entry))
      : [...library.notes, note],
    cards: [
      ...library.cards.filter((card) => card.noteId !== note.id),
      ...keys.map(
        (key) => oldCards.find((card) => card.variant === key) ?? newCard(note.id, key, now),
      ),
    ],
    reviews: library.reviews.filter((review) => !removed.has(review.cardId)),
  })
}
export function removeNotes(library: Library, ids: Set<string>): Library {
  const removed = new Set(
    library.cards.filter((card) => ids.has(card.noteId)).map((card) => card.id),
  )
  return pruneMedia({
    ...library,
    notes: library.notes.filter((note) => !ids.has(note.id)),
    cards: library.cards.filter((card) => !removed.has(card.id)),
    reviews: library.reviews.filter((review) => !removed.has(review.cardId)),
  })
}

export function migrateLibrary(value: unknown): Library {
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    (value.version === 2 || value.version === 3)
  )
    return librarySchema.parse({ ...value, version: 3 })
  const old = legacySchema.parse(value)
  const seen = new Set<string>()
  return librarySchema.parse({
    version: 3,
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
