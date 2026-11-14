import { LocalizedError, msg, type MessageKey } from '../i18n'
import { recordSchemas, type Library } from './model'
import { hasAttemptBody, summarizeAttempt, type AttemptRecord } from './practice-data'

export type Store = keyof typeof recordSchemas
type RecordValue = Library[Store][number]
export interface OperationChange {
  store: Store
  id: string
  index: number
  before?: RecordValue
  after?: RecordValue
  keys: string[]
}
export interface Operation {
  id: string
  createdAt: string
  scope: string
  label: MessageKey
  kind: 'change' | 'reading' | 'review'
  changes: OperationChange[]
  cardId?: string
  noteIds: string[]
  reviewId?: string
}
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => same(value, right[index]))
    )
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>
  const keys = Object.keys(a).filter((key) => a[key] !== undefined)
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => same(a[key], b[key]))
  )
}
const fields = (value?: RecordValue) => value as unknown as Record<string, unknown> | undefined
const stale = () => new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))

/** Keep only touched records. Background reading positions never become undo steps. */
export function operationFor(
  before: Library,
  after: Library,
  scope: string,
  label: MessageKey,
  kind: Operation['kind'] = 'change',
): Operation | undefined {
  if (before === after) return
  const operation: Operation = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    scope,
    label,
    kind,
    changes: [],
    noteIds: [],
  }
  if (kind === 'review') {
    const review = after.reviews.at(-1)
    if (!review || before.reviews.at(-1)?.id === review.id) return
    operation.cardId = review.cardId
    operation.reviewId = review.id
  }
  for (const store of Object.keys(recordSchemas) as Store[]) {
    // A committed command receipt survives undo, so a delayed retry cannot recreate deleted data.
    if (store === 'materialReceipts' || store === 'automationReceipts') continue
    if (before[store] === after[store]) continue
    // A rating only appends one review. Never diff the complete persisted history.
    if (kind === 'review' && store === 'reviews') {
      const review = after.reviews.at(-1)!
      operation.changes.push({
        store,
        id: review.id,
        index: after.reviews.length - 1,
        after: review,
        keys: Object.keys(review),
      })
      continue
    }
    const next = new Map(after[store].map((value) => [value.id, value]))
    const old = new Set(before[store].map((value) => value.id))
    before[store].forEach((value, index) => {
      const replacement = next.get(value.id)
      const keys = [...new Set([...Object.keys(value), ...Object.keys(replacement ?? {})])].filter(
        (key) =>
          !(store === 'sources' && key === 'reading') &&
          !same(fields(value)?.[key], fields(replacement)?.[key]),
      )
      if (!replacement || keys.length)
        operation.changes.push({
          store,
          id: value.id,
          index,
          before: value,
          after: replacement,
          keys,
        })
    })
    after[store].forEach((value, index) => {
      if (!old.has(value.id))
        operation.changes.push({
          store,
          id: value.id,
          index,
          after: value,
          keys: Object.keys(value),
        })
    })
  }
  if (!operation.changes.length) return
  operation.noteIds = operation.changes
    .filter((change) => change.store === 'notes')
    .map((change) => change.id)
  operation.cardId ??=
    operation.changes.find((change) => change.store === 'cards' && change.before)?.id ??
    before.cards.find((card) => operation.noteIds.includes(card.noteId))?.id
  return operation
}

/** Revert touched fields atomically while retaining later autosaves and unrelated records. */
export function revertOperation(library: Library, operation: Operation): Library {
  const next = { ...library }
  for (const store of Object.keys(recordSchemas) as Store[]) {
    const changes = operation.changes.filter((change) => change.store === store)
    if (!changes.length) continue
    const rows = new Map<string, RecordValue>(library[store].map((value) => [value.id, value]))
    for (const change of changes) {
      const current = rows.get(change.id)
      if (!change.after) {
        if (current) throw stale()
        rows.set(change.id, change.before!)
      } else {
        const expected =
          change.store === 'attempts' && current && !hasAttemptBody(current as AttemptRecord)
            ? summarizeAttempt(change.after as AttemptRecord)
            : change.after
        if (
          !current ||
          change.keys.some((key) => !same(fields(current)?.[key], fields(expected)?.[key]))
        )
          throw stale()
        if (!change.before) rows.delete(change.id)
        else {
          const restored = { ...fields(current) }
          for (const key of change.keys)
            if (Object.hasOwn(change.before, key)) restored[key] = fields(change.before)![key]
            else delete restored[key]
          rows.set(change.id, restored as unknown as RecordValue)
        }
      }
    }
    const ordered = library[store]
      .filter((value) => rows.has(value.id))
      .map((value) => rows.get(value.id)!)
    for (const change of changes
      .filter((change) => change.before && !change.after)
      .sort((a, b) => a.index - b.index))
      ordered.splice(Math.min(change.index, ordered.length), 0, rows.get(change.id)!)
    ;(next[store] as RecordValue[]) = ordered
  }
  return next
}

/** Replay stored results. IDs, rating timestamps and schedules are never recomputed. */
export function replayOperation(library: Library, operation: Operation): Library {
  return revertOperation(library, {
    ...operation,
    changes: operation.changes.map((change) => ({
      ...change,
      before: change.after,
      after: change.before,
    })),
  })
}
