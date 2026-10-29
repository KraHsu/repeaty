import { msg, LocalizedError } from '../i18n'
import type { Assessment } from '../plugins/data'
import { type Grade } from '../core/model'
import { changeCards, reviewCard, type CardAction } from '../core/scheduler'
import { recordAttempt, finishPractice, revealPracticeHistory } from '../core/practice'
import {
  hasAttemptBody,
  sameAttemptSummary,
  type Practice,
  type Attempt,
} from '../core/practice-data'
import type { LibraryContext } from './library-context'
export function createStudyCommands(context: LibraryContext) {
  return {
    changeCards(ids: Set<string>, action: CardAction) {
      return context.commit((current) => changeCards(current, ids, action), {
        undoLabel: action === 'bury' ? '今天暂缓' : action === 'suspend' ? '暂停此卡' : '修改',
      })
    },
    async recordAttempt(practice: Practice, attempt: Attempt, expectedScope: string) {
      if (expectedScope !== context.scope.value || !expectedScope)
        throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
      await context.savingDone
      if (expectedScope !== context.scope.value)
        throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
      const previous = context.library.value.attempts.find((entry) => entry.id === attempt.id)
      const expectedRevision = context.revision
      const full =
        previous && !hasAttemptBody(previous) ? await context.getAttempt(previous.id) : undefined
      if (expectedScope !== context.scope.value || (full && expectedRevision !== context.revision))
        throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
      await context.commit(
        (current) => {
          if (full) {
            const prior = current.attempts.find((entry) => entry.id === full.id)
            if (!prior || !sameAttemptSummary(prior, full))
              throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
          }
          return recordAttempt(
            full
              ? {
                  ...current,
                  attempts: current.attempts.map((entry) => (entry.id === full.id ? full : entry)),
                }
              : current,
            practice,
            attempt,
          )
        },
        { undoLabel: false, undoBarrier: !previous },
      )
    },
    revealPracticeHistory(practiceId: string, expectedScope: string) {
      if (expectedScope !== context.scope.value || !expectedScope)
        return Promise.reject(new Error('练习记录已变化，请重新打开题目后重试。'))
      if (revealPracticeHistory(context.library.value, practiceId) === context.library.value)
        return Promise.resolve()
      return context.commit((current) => revealPracticeHistory(current, practiceId), {
        undoLabel: false,
      })
    },
    finishPractice(id: string, cardId: string, assessment?: Assessment) {
      return context.commit((current) => finishPractice(current, id, cardId, assessment), {
        undoLabel: false,
      })
    },
    review(
      id: string,
      grade: Grade,
      filtered = false,
      assessment?: Assessment,
      practiceId?: string,
    ) {
      return context.commit(
        (current) =>
          reviewCard(
            current,
            id,
            grade,
            new Date(),
            filtered ? 'filtered' : 'normal',
            assessment,
            context.canReviewCard,
            practiceId,
          ),
        { backgroundMetadata: true, undoLabel: '评分', undoKind: 'review' },
      )
    },
    undo: context.undoRating,
  }
}
