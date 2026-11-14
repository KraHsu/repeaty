import type { Review } from '../core/model'

export type PluginReviewSummary = Readonly<Pick<Review, 'id' | 'cardId' | 'rating' | 'reviewedAt'>>

/** Library records are immutable; reuse their projections without exposing scheduling internals. */
export function createPluginReviewReader() {
  const summaries = new WeakMap<Review, PluginReviewSummary>()
  return (reviews: readonly Review[]): readonly PluginReviewSummary[] =>
    Object.freeze(
      reviews.map((review) => {
        let summary = summaries.get(review)
        if (!summary) {
          summary = Object.freeze({
            id: review.id,
            cardId: review.cardId,
            rating: review.rating,
            reviewedAt: review.reviewedAt,
          })
          summaries.set(review, summary)
        }
        return summary
      }),
    )
}
