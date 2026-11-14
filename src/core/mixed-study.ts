import { type CardView, type Library } from './model'
import { studyDay } from './study-day'
import { studySettings } from './study-settings'
import { createPriorityResolver } from './study-priority'
import { dueCards } from './scheduler'
import { queuedSources, sourceQueueState } from './source-queue'

export interface MixedRound {
  sources: ReadonlyArray<{ id: string; mediaId: string }>
  cursor: number
  cardsPerReading: number
  readingsPerCycle: number
  readingsInCycle: number
  cardsSinceReading: number
  completedCards: number
  completedReadings: number
}
export type MixedTask =
  { kind: 'card'; id: string } | { kind: 'reading'; id: string; mediaId: string; index: number }

export function startMixedRound(
  library: Library,
  now: Date,
  cardsPerReading = studySettings(library).cardsPerReading,
): MixedRound {
  if (!Number.isInteger(cardsPerReading) || cardsPerReading < 1 || cardsPerReading > 10)
    throw new RangeError('每篇阅读之间的卡片数需为 1–10。')
  return {
    sources: queuedSources(
      library.sources,
      'ready',
      studyDay(now, studySettings(library)),
      {},
      library,
    ).map(({ id, mediaId }) => ({
      id,
      mediaId,
    })),
    cursor: 0,
    cardsPerReading,
    readingsPerCycle: studySettings(library).readingsPerCycle,
    readingsInCycle: 0,
    cardsSinceReading: 0,
    completedCards: 0,
    completedReadings: 0,
  }
}

export function nextMixedTask(
  round: MixedRound,
  library: Library,
  now: Date,
  permitted?: (card: CardView) => boolean,
): MixedTask | undefined {
  const card = dueCards(library, now, undefined, permitted)[0]
  const sources = new Map(library.sources.map((source) => [source.id, source]))
  let reading: Extract<MixedTask, { kind: 'reading' }> | undefined
  for (let index = round.cursor; index < round.sources.length; index++) {
    const entry = round.sources[index]!,
      source = sources.get(entry.id)
    if (
      source?.mediaId === entry.mediaId &&
      sourceQueueState(source, studyDay(now, studySettings(library)), library.sources) === 'ready'
    ) {
      reading = { kind: 'reading', ...entry, index }
      break
    }
  }
  const priority = createPriorityResolver(library)
  if (card && priority.card(card).value === 0) return { kind: 'card', id: card.id }
  if (reading && priority.source(sources.get(reading.id)!).value === 0) return reading
  return card && (!reading || round.cardsSinceReading < round.cardsPerReading)
    ? { kind: 'card', id: card.id }
    : reading
}
export function finishMixedCard(round: MixedRound): MixedRound {
  return {
    ...round,
    cardsSinceReading: round.cardsSinceReading + 1,
    readingsInCycle: 0,
    completedCards: round.completedCards + 1,
  }
}
export function finishMixedReading(round: MixedRound, index: number): MixedRound {
  if (index < round.cursor || index >= round.sources.length)
    throw new RangeError('阅读轮次已变化。')
  return {
    ...round,
    cursor: index + 1,
    cardsSinceReading:
      round.readingsInCycle + 1 >= round.readingsPerCycle ? 0 : round.cardsSinceReading,
    readingsInCycle:
      round.readingsInCycle + 1 >= round.readingsPerCycle ? 0 : round.readingsInCycle + 1,
    completedReadings: round.completedReadings + 1,
  }
}
