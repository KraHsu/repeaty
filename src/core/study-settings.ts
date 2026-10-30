import { z } from 'zod'
import type { Library } from './model'

export const studyPrioritySchema = z.number().int().min(0).max(9)
export const studySettingsSchema = z
  .strictObject({
    id: z.literal('study').default('study'),
    dayStartHour: z.number().int().min(0).max(23).default(0),
    maxIntervalDays: z.number().int().min(1).max(36500).default(36500),
    enableShortTerm: z.boolean().default(true),
    cardsPerReading: z.number().int().min(1).max(10).default(3),
    readingsPerCycle: z.number().int().min(1).max(10).default(1),
    priorityMode: z.enum(['legacy', 'weighted']).default('legacy'),
    defaultPriority: z.number().int().min(1).max(9).default(5),
    priorityRatio: z.number().finite().min(1).max(100).default(5),
    readingMode: z.enum(['legacy', 'configured']).default('legacy'),
    readingInitialDays: z.number().int().min(1).max(36500).default(1),
    readingGrowthMin: z.number().finite().min(1).max(10).default(1.3),
    readingGrowthMax: z.number().finite().min(1).max(10).default(3),
    readingMaxDays: z.number().int().min(1).max(36500).default(365),
    newCardWindowDays: z.number().int().min(1).max(99).default(7),
    activeFsrsModelId: z.string().min(1).max(150).optional(),
    statisticsSince: z.iso.datetime().optional(),
  })
  .refine((value) => value.readingGrowthMin <= value.readingGrowthMax, {
    message: '阅读增长范围的最小值不能超过最大值。',
    path: ['readingGrowthMin'],
  })
  .refine((value) => value.readingInitialDays <= value.readingMaxDays, {
    message: '阅读初始间隔不能超过最大间隔。',
    path: ['readingInitialDays'],
  })

export type StudySettings = z.infer<typeof studySettingsSchema>
export const DEFAULT_STUDY_SETTINGS: Readonly<StudySettings> = Object.freeze(
  studySettingsSchema.parse({}),
)

/** Missing records preserve Repeaty's existing scheduling, not another app's defaults. */
export function studySettings(library?: Pick<Library, 'studySettings'>): Readonly<StudySettings> {
  return library?.studySettings?.[0] ?? DEFAULT_STUDY_SETTINGS
}

/** Selection is persisted separately from model training; missing models use stock FSRS. */
export function effectiveFsrsWeights(library: Library, deckId?: string): number[] | undefined {
  const deck = library.decks.find((entry) => entry.id === deckId)
  const modelId = deck?.activeFsrsModelId ?? studySettings(library).activeFsrsModelId
  if (!modelId) return undefined
  const model = library.fsrsModels.find((entry) => entry.id === modelId)
  if (
    !model ||
    model.modelVersion !== 'FSRS-6' ||
    (model.deckId && model.deckId !== deckId) ||
    model.weights.length !== 21 ||
    !model.weights.every(Number.isFinite)
  )
    return undefined
  return [...model.weights]
}
