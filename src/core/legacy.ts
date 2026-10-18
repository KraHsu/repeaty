// Version 1 schema is frozen for migration and old JSON backups.
import { z } from 'zod'

const date = z.iso.datetime()
const id = z.string().min(1).max(100)
const count = z.number().int().min(0).max(1_000_000)
export const colors = ['sage', 'sand', 'lavender', 'blue', 'rose'] as const

export const scheduleSchema = z
  .object({
    due: date,
    stability: z.number().finite().min(0),
    difficulty: z.number().finite().min(0).max(10),
    elapsed_days: count,
    scheduled_days: count,
    learning_steps: count,
    reps: count,
    lapses: count,
    state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    last_review: date.optional(),
  })
  .superRefine((schedule, ctx) => {
    if (
      schedule.state !== 0 &&
      (!schedule.last_review || schedule.reps === 0 || schedule.stability === 0)
    ) {
      ctx.addIssue({ code: 'custom', message: '已学习卡片缺少有效的复习状态' })
    }
    if (schedule.last_review && schedule.due < schedule.last_review) {
      ctx.addIssue({ code: 'custom', message: '下次复习时间不能早于上次复习' })
    }
  })

export const deckSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300),
  color: z.enum(colors),
  createdAt: date,
})

export const cardSchema = z.object({
  id,
  deckId: id,
  front: z.string().trim().min(1).max(10_000),
  back: z.string().trim().min(1).max(10_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  createdAt: date,
  updatedAt: date,
  schedule: scheduleSchema,
})

export const reviewSchema = z.object({
  id,
  cardId: id,
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reviewedAt: date,
  nextDue: date,
})

export const librarySchema = z
  .object({
    version: z.literal(1),
    decks: z.array(deckSchema).max(1_000),
    cards: z.array(cardSchema).max(100_000),
    reviews: z.array(reviewSchema).max(500_000),
  })
  .superRefine((library, ctx) => {
    for (const key of ['decks', 'cards', 'reviews'] as const) {
      const ids = library[key].map((entry) => entry.id)
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', path: [key], message: '存在重复 ID' })
      }
    }
    const decks = new Set(library.decks.map((deck) => deck.id))
    const cards = new Set(library.cards.map((card) => card.id))
    if (library.cards.some((card) => !decks.has(card.deckId))) {
      ctx.addIssue({ code: 'custom', path: ['cards'], message: '卡片所属卡组不存在' })
    }
    if (library.reviews.some((review) => !cards.has(review.cardId))) {
      ctx.addIssue({ code: 'custom', path: ['reviews'], message: '复习记录对应的卡片不存在' })
    }
  })
