import { cardViews, type Library, type CardView } from './model'
import { available, dueCards, isBuried, type CardEligibility } from './scheduler'

export interface DeckStudyStatus {
  total: number
  newTotal: number
  newReady: number
  learningReady: number
  reviewReady: number
  ready: number
  future: number
  limited: number
  suspended: number
  buried: number
}
export function deckStudyCounts(
  library: Library,
  now = new Date(),
  queue?: CardView[],
  views = cardViews(library),
  eligible: CardEligibility = () => true,
) {
  queue ??= dueCards(library, now, undefined, eligible, views)
  const ready = new Set(queue.map((card) => card.id))
  const result = new Map<string, DeckStudyStatus>(
    library.decks.map((deck) => [
      deck.id,
      {
        total: 0,
        newTotal: 0,
        newReady: 0,
        learningReady: 0,
        reviewReady: 0,
        ready: 0,
        future: 0,
        limited: 0,
        suspended: 0,
        buried: 0,
      },
    ]),
  )
  for (const card of views) {
    const status = result.get(card.deckId)!
    status.total++
    if (card.schedule.state === 0) status.newTotal++
    if (card.suspended) status.suspended++
    if (isBuried(card, now)) status.buried++
    if (ready.has(card.id)) {
      status.ready++
      if (card.schedule.state === 0) status.newReady++
      else if (card.schedule.state === 2) status.reviewReady++
      else status.learningReady++
    } else if (eligible(card) && available(card, now)) {
      if (new Date(card.schedule.due) > now) status.future++
      else status.limited++
    }
  }
  return result
}
